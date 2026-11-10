const db = require("./lib/supabase");

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const ADMIN_ID = String(process.env.TELEGRAM_ADMIN_ID || "");
const DEFAULT_ROOM = String(process.env.CLASSROOM_ROOM || "CLASS10").toUpperCase();

async function telegram(method, payload = {}) {
  if (!BOT_TOKEN) throw new Error("TELEGRAM_BOT_TOKEN is not configured");
  const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const result = await response.json();
  if (!result.ok) throw new Error(result.description || "Telegram API request failed");
  return result.result;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

async function reply(chatId, text) {
  return telegram("sendMessage", { chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true });
}

async function getState(room, questions) {
  const saved = await db.getClassroomState(room);
  return saved || { questions, index: 0, showAnswer: false, room, language: "both", progress: true };
}

async function publish(io, room, state) {
  state.room = room;
  await db.saveClassroomState(room, state);
  io.to(room).emit("class-state", state);
}

function parseQuestionFields(raw, offset = 0) {
  const parts = raw.split("|").map(part => part.trim());
  const fields = parts.slice(offset);
  if (fields.length < 10) {
    throw new Error("सभी fields दें: Class | Subject | Chapter | Hindi | English | A | B | C | D | Answer(A-D) | Explanation");
  }
  const [cls, subject, chapter, hi, en, a, b, c, d, rawAnswer, ...explain] = fields;
  const answerLetter = String(rawAnswer || "").toUpperCase();
  const answer = ["A", "B", "C", "D"].indexOf(answerLetter);
  if (answer < 0) throw new Error("Answer केवल A, B, C या D होना चाहिए।");
  if (![a, b, c, d].every(Boolean) || (!hi && !en)) throw new Error("Question और चारों options भरना जरूरी है।");
  return { cls, subject, chapter, hi, en, opts: [a, b, c, d], answer, explain: explain.join(" | ") };
}

async function handleUpdate(update, io) {
  const message = update?.message;
  if (!message?.text) return;
  const chatId = message.chat.id;
  const senderId = String(message.from?.id || "");
  if (!ADMIN_ID || senderId !== ADMIN_ID) {
    await reply(chatId, "⛔ यह bot केवल authorized admin के लिए है।");
    return;
  }

  const [commandToken, ...rest] = message.text.trim().split(/\s+/);
  const command = commandToken.split("@")[0].toLowerCase();
  const arg = rest.join(" ").trim();
  const room = DEFAULT_ROOM;

  try {
    if (command === "/start" || command === "/help") {
      await reply(chatId,
        "🏫 <b>Smart Classroom Admin Bot</b>\n\n" +
        "/status — classroom status\n/next — अगला सवाल\n/prev — पिछला सवाल\n/answer — उत्तर दिखाएँ\n/hide — उत्तर छिपाएँ\n" +
        "/list — questions की सूची\n/add — नया question जोड़ें\n/edit — question बदलें\n/delete ID — question हटाएँ\n\n" +
        "<b>/add format:</b>\n<code>/add Class 8 | Science | Light | प्रकाश क्या है? | What is light? | A | B | C | D | B | Explanation</code>\n" +
        "<b>/edit format:</b>\n<code>/edit ID | Class 8 | Science | Light | ...same fields...</code>"
      );
      return;
    }

    const questions = await db.getQuestions();
    let state = await getState(room, questions);
    state.questions = questions;

    if (command === "/status") {
      const q = questions[state.index];
      await reply(chatId, `🟢 <b>Room:</b> ${escapeHtml(room)}\n<b>Questions:</b> ${questions.length}\n<b>Current:</b> ${questions.length ? state.index + 1 : 0}/${questions.length}\n<b>Answer:</b> ${state.showAnswer ? "Visible" : "Hidden"}\n${q ? escapeHtml(q.hi || q.en) : "No question selected"}`);
      return;
    }

    if (command === "/list") {
      const lines = questions.slice(0, 30).map((q, i) => `${i + 1}. <code>${escapeHtml(q.id)}</code> — ${escapeHtml(q.cls)} / ${escapeHtml(q.subject)} — ${escapeHtml(q.hi || q.en).slice(0, 90)}`);
      await reply(chatId, lines.length ? lines.join("\n") : "Question Bank खाली है। /add से सवाल जोड़ें।");
      return;
    }

    if (command === "/add") {
      const question = parseQuestionFields(arg);
      question.id = `tg_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
      questions.push(question);
      await db.saveQuestions(questions);
      state.questions = questions;
      state.index = questions.length - 1;
      state.showAnswer = false;
      await publish(io, room, state);
      await reply(chatId, `✅ Question add हो गया। ID: <code>${escapeHtml(question.id)}</code>`);
      return;
    }

    if (command === "/edit") {
      const separator = arg.indexOf("|");
      if (separator < 0) throw new Error("/edit ID | Class | Subject | Chapter | Hindi | English | A | B | C | D | Answer | Explanation");
      const id = arg.slice(0, separator).trim();
      const index = questions.findIndex(q => String(q.id) === id);
      if (index < 0) throw new Error("इस ID का question नहीं मिला। /list देखें।");
      questions[index] = { ...parseQuestionFields(arg, 0), id };
      // Remove the ID field before parsing the remaining question fields.
      questions[index] = { ...parseQuestionFields(arg.slice(separator + 1)), id };
      await db.saveQuestions(questions);
      state.questions = questions;
      await publish(io, room, state);
      await reply(chatId, "✅ Question update हो गया।");
      return;
    }

    if (command === "/delete") {
      if (!arg) throw new Error("Usage: /delete QUESTION_ID");
      const filtered = questions.filter(q => String(q.id) !== arg);
      if (filtered.length === questions.length) throw new Error("इस ID का question नहीं मिला।");
      await db.saveQuestions(filtered);
      state.questions = filtered;
      state.index = Math.max(0, Math.min(state.index, filtered.length - 1));
      state.showAnswer = false;
      await publish(io, room, state);
      await reply(chatId, "🗑️ Question delete हो गया।");
      return;
    }

    if (["/next", "/prev", "/answer", "/hide"].includes(command)) {
      if (!questions.length) throw new Error("Question Bank खाली है। पहले /add करें।");
      if (command === "/next") state.index = Math.min(questions.length - 1, state.index + 1);
      if (command === "/prev") state.index = Math.max(0, state.index - 1);
      if (command === "/answer") state.showAnswer = true;
      if (command === "/hide") state.showAnswer = false;
      state.questions = questions;
      await publish(io, room, state);
      const current = questions[state.index];
      await reply(chatId, `✅ TV updated: ${state.index + 1}/${questions.length}\n${escapeHtml(current.hi || current.en)}`);
      return;
    }

    await reply(chatId, "Command समझ नहीं आया। /help भेजें।");
  } catch (error) {
    console.error("Telegram bot:", error.message);
    await reply(chatId, `⚠️ ${escapeHtml(error.message)}`);
  }
}

async function configureWebhook() {
  if (!BOT_TOKEN) return;
  const base = (process.env.PUBLIC_BASE_URL || "").replace(/\/$/, "");
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET || "";
  if (!base || !secret) {
    console.warn("Telegram bot: set PUBLIC_BASE_URL and TELEGRAM_WEBHOOK_SECRET to register the webhook.");
    return;
  }
  await telegram("setWebhook", {
    url: `${base}/telegram/webhook`,
    secret_token: secret,
    allowed_updates: ["message"]
  });
  await telegram("setMyCommands", {
    commands: [
      { command: "start", description: "Open Smart Classroom bot" },
      { command: "status", description: "Show classroom status" },
      { command: "next", description: "Next question" },
      { command: "prev", description: "Previous question" },
      { command: "answer", description: "Show answer" },
      { command: "hide", description: "Hide answer" },
      { command: "list", description: "List questions" },
      { command: "add", description: "Add a question" },
      { command: "edit", description: "Edit a question" },
      { command: "delete", description: "Delete a question" }
    ]
  });
  console.log("Telegram webhook registered.");
}

module.exports = { handleUpdate, configureWebhook };
