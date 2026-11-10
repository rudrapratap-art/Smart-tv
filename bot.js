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


function parseCsv(text) {
  const rows = [];
  let row = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell.length === 0) quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n") { row.push(cell.replace(/\r$/, "")); rows.push(row); row = []; cell = ""; }
    else cell += ch;
  }
  if (quoted) throw new Error("CSV में closing quote नहीं मिला। Excel से दोबारा CSV UTF-8 में save करें।");
  if (cell.length || row.length) { row.push(cell.replace(/\r$/, "")); rows.push(row); }
  return rows.filter(r => r.some(v => String(v).trim() !== ""));
}

function normalizeHeader(value) {
  return String(value || "").replace(/^\uFEFF/, "").trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function parseQuestionsCsv(csvText) {
  const rows = parseCsv(csvText);
  if (rows.length < 2) throw new Error("CSV में header और कम-से-कम एक question होना चाहिए।");
  const headers = rows[0].map(normalizeHeader);
  const aliases = {
    cls: ["cls", "class", "class_name"],
    subject: ["subject"],
    chapter: ["chapter", "topic"],
    hi: ["hi", "hindi", "question_hi", "question_hindi"],
    en: ["en", "english", "question_en", "question_english"],
    a: ["a", "option_a", "option1"],
    b: ["b", "option_b", "option2"],
    c: ["c", "option_c", "option3"],
    d: ["d", "option_d", "option4"],
    answer: ["answer", "correct_answer", "correct"],
    explain: ["explain", "explanation", "solution"]
  };
  const index = {};
  for (const [key, names] of Object.entries(aliases)) index[key] = headers.findIndex(h => names.includes(h));
  const required = ["cls", "subject", "chapter", "a", "b", "c", "d", "answer"];
  const missing = required.filter(k => index[k] < 0);
  if (index.hi < 0 && index.en < 0) missing.push("hi या en");
  if (missing.length) throw new Error("CSV headers missing: " + missing.join(", ") + ". /csv से सही format देखें।");

  const questions = [];
  const errors = [];
  for (let i = 1; i < rows.length; i++) {
    const values = rows[i];
    const get = key => index[key] < 0 ? "" : String(values[index[key]] ?? "").trim();
    const answerRaw = get("answer").toUpperCase();
    const letters = ["A", "B", "C", "D"];
    const answer = letters.indexOf(answerRaw) >= 0 ? letters.indexOf(answerRaw) : (/^[0-3]$/.test(answerRaw) ? Number(answerRaw) : -1);
    if (!get("cls") || !get("subject") || !get("chapter") || (!get("hi") && !get("en")) ||
        ![get("a"), get("b"), get("c"), get("d")].every(Boolean) || answer < 0) {
      errors.push(i + 1);
      continue;
    }
    questions.push({
      id: "csv_" + Date.now() + "_" + i + "_" + Math.floor(Math.random() * 10000),
      cls: get("cls"), subject: get("subject"), chapter: get("chapter"),
      hi: get("hi"), en: get("en"),
      opts: [get("a"), get("b"), get("c"), get("d")],
      answer, explain: get("explain")
    });
  }
  if (errors.length) throw new Error("CSV row " + errors.slice(0, 12).join(", ") + " में जरूरी data/answer गलत है" + (errors.length > 12 ? " और " + (errors.length - 12) + " अन्य rows" : "") + "। कोई भी row import नहीं की गई।");
  if (!questions.length) throw new Error("CSV में import करने लायक question नहीं मिला।");
  if (questions.length > 1000) throw new Error("एक बार में अधिकतम 1000 questions import कर सकते हैं।");
  return questions;
}

function questionFingerprint(q) {
  return [q.cls, q.subject, q.chapter, q.hi, q.en, ...(q.opts || [])]
    .map(v => String(v || "").trim().toLowerCase()).join("|");
}

async function importCsvDocument(message, io, room) {
  const doc = message.document;
  const fileName = String(doc.file_name || "").toLowerCase();
  if (!fileName.endsWith(".csv")) throw new Error("कृपया केवल .csv file भेजें।");
  if (Number(doc.file_size || 0) > 5 * 1024 * 1024) throw new Error("CSV file अधिकतम 5 MB की हो सकती है।");
  const fileInfo = await telegram("getFile", { file_id: doc.file_id });
  if (!fileInfo.file_path) throw new Error("Telegram से file path नहीं मिला।");
  const response = await fetch("https://api.telegram.org/file/bot" + BOT_TOKEN + "/" + fileInfo.file_path);
  if (!response.ok) throw new Error("CSV download failed (" + response.status + ")");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 5 * 1024 * 1024) throw new Error("CSV file अधिकतम 5 MB की हो सकती है।");
  const incoming = parseQuestionsCsv(bytes.toString("utf8").replace(/^\uFEFF/, ""));
  const existing = await db.getQuestions();
  const seen = new Set(existing.map(questionFingerprint));
  const additions = incoming.filter(q => {
    const key = questionFingerprint(q);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (!additions.length) {
    await reply(message.chat.id, "ℹ️ CSV में " + incoming.length + " questions मिले, लेकिन सभी पहले से मौजूद हैं। कोई duplicate add नहीं किया गया।");
    return;
  }
  const combined = [...existing, ...additions];
  await db.saveQuestions(combined);
  const state = await getState(room, combined);
  state.questions = combined;
  state.room = room;
  if (!Number.isInteger(state.index) || state.index < 0 || state.index >= combined.length) state.index = 0;
  await publish(io, room, state);
  await reply(message.chat.id,
    "✅ <b>CSV Import पूरा हुआ!</b>\n" +
    "📥 CSV में मिले: " + incoming.length + "\n" +
    "➕ नए questions add: " + additions.length + "\n" +
    "⏭️ Duplicate skip: " + (incoming.length - additions.length) + "\n" +
    "📚 Total question bank: " + combined.length + "\n\n" +
    "पुराने questions सुरक्षित रखे गए हैं।"
  );
}

async function handleUpdate(update, io) {
  const message = update?.message;
  if (!message || (!message.text && !message.document)) return;
  const chatId = message.chat.id;
  const senderId = String(message.from?.id || "");
  if (!ADMIN_ID || senderId !== ADMIN_ID) {
    await reply(chatId, "⛔ यह bot केवल authorized admin के लिए है।");
    return;
  }

  const room = DEFAULT_ROOM;

  try {
    if (message.document) {
      await importCsvDocument(message, io, room);
      return;
    }
    const [commandToken, ...rest] = message.text.trim().split(/\s+/);
    const command = commandToken.split("@")[0].toLowerCase();
    const arg = rest.join(" ").trim();

    if (command === "/csv") {
      await reply(chatId,
        "📄 <b>CSV Import Format</b>\n\n" +
        "Excel में ये header रखें:\n" +
        "<code>cls,subject,chapter,hi,en,A,B,C,D,answer,explain</code>\n\n" +
        "हर row में एक question रखें। Answer में A/B/C/D या 0/1/2/3 लिखें। Hindi या English में से कम-से-कम एक question जरूरी है।\n\n" +
        "File को CSV UTF-8 (.csv) में save करके इसी chat में Document के रूप में भेजें।\n" +
        "एक file में अधिकतम 1000 questions और 5 MB। पुराने questions सुरक्षित रहेंगे; exact duplicates skip होंगे।"
      );
      return;
    }

    if (command === "/start" || command === "/help") {
      await reply(chatId,
        "🏫 <b>Smart Classroom Admin Bot</b>\n\n" +
        "/status — classroom status\n/next — अगला सवाल\n/prev — पिछला सवाल\n/answer — उत्तर दिखाएँ\n/hide — उत्तर छिपाएँ\n" +
        "/list — questions की सूची\n/add — नया question जोड़ें\n/csv — CSV import format\n/edit — question बदलें\n/delete ID — question हटाएँ\n\n" +
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
