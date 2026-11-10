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

const mainKeyboard = {
  keyboard: [
    [{ text: "🏠 Home" }, { text: "📂 Second menu" }],
    [{ text: "🎓 Select Questions" }],
    [{ text: "▶️ Next" }, { text: "◀️ Previous" }],
    [{ text: "👁 Show Answer" }, { text: "🙈 Hide Answer" }]
  ],
  resize_keyboard: true,
  is_persistent: true,
  input_field_placeholder: "Choose a classroom action…"
};

const secondKeyboard = {
  keyboard: [
    [{ text: "💾 Backup" }, { text: "♻️ Restore" }],
    [{ text: "📝 Start Quiz" }, { text: "⏹ Stop Quiz" }],
    [{ text: "📄 CSV Help" }, { text: "📥 CSV Template" }],
    [{ text: "⬅️ Main menu" }]
  ],
  resize_keyboard: true,
  is_persistent: true,
  input_field_placeholder: "Choose a question bank action…"
};

async function reply(chatId, text, keyboard = mainKeyboard) {
  return telegram("sendMessage", {
    chat_id: chatId, text, parse_mode: "HTML",
    disable_web_page_preview: true,
    reply_markup: keyboard
  });
}

const selectionSessions = new Map();
const pendingCsvImports = new Map();
const pendingRestores = new Map();

const activeQuizRuns = new Map();
const QUIZ_QUESTION_SECONDS = 30;

async function sendQuizQuestion(chatId, room, run) {
  const q = run.questions[run.index];
  const quizId = "qz_" + Date.now() + "_" + Math.floor(Math.random() * 1000000);
  const questionText = q.hi || q.en;
  const quiz = await db.startTelegramQuiz({
    id: quizId, room, chat_id: String(chatId), message_id: null,
    question_id: String(q.id), question_text: questionText,
    options: q.opts, correct_answer: Number(q.answer), active: true
  });
  run.quizIds.push(quiz.id);
  const keyboard = q.opts.map((option, index) => [{
    text: String.fromCharCode(65 + index) + ". " + String(option).slice(0, 55),
    callback_data: "qz:" + quiz.id + ":" + index
  }]);
  await telegram("sendMessage", {
    chat_id: chatId,
    text: "📝 <b>SMART CLASSROOM LIVE QUIZ</b>\n\n" +
      "🎓 " + escapeHtml(q.cls) + " • " + escapeHtml(q.subject) + "\n" +
      "📖 " + escapeHtml(q.chapter) + "\n" +
      "🔢 प्रश्न " + (run.index + 1) + "/" + run.questions.length + "\n" +
      "⏱️ समय: <b>" + QUIZ_QUESTION_SECONDS + " सेकंड</b>\n\n" +
      "<b>" + escapeHtml(questionText) + "</b>\n\n" +
      "नीचे दिए गए विकल्पों में से एक चुनें। हर विद्यार्थी का केवल पहला उत्तर स्वीकार होगा।",
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: keyboard }
  });
  run.timer = setTimeout(async () => {
    try {
      if (activeQuizRuns.get(String(chatId)) !== run) return;
      run.index += 1;
      if (run.index >= run.questions.length) await finishQuizRun(chatId, room, run, false);
      else await sendQuizQuestion(chatId, room, run);
    } catch (error) {
      console.error("Automatic quiz progression:", error.message);
      activeQuizRuns.delete(String(chatId));
      await telegram("sendMessage", { chat_id: chatId, text: "⚠️ अगला प्रश्न भेजने में समस्या हुई: " + escapeHtml(error.message) });
    }
  }, QUIZ_QUESTION_SECONDS * 1000);
}

async function finishQuizRun(chatId, room, run, stopped = false) {
  if (run.timer) clearTimeout(run.timer);
  await db.stopTelegramQuiz(room);
  activeQuizRuns.delete(String(chatId));
  const totals = new Map();
  let totalAnswers = 0, correctAnswers = 0;
  for (const quizId of run.quizIds) {
    const responses = await db.getTelegramQuizResponses(quizId);
    for (const response of responses) {
      totalAnswers += 1;
      if (response.is_correct) correctAnswers += 1;
      const score = totals.get(response.user_id) || { name: response.display_name || "Student", correct: 0, answered: 0 };
      score.answered += 1;
      if (response.is_correct) score.correct += 1;
      totals.set(response.user_id, score);
    }
  }
  const leaderboard = [...totals.values()]
    .sort((a,b) => b.correct-a.correct || b.answered-a.answered)
    .slice(0,10);
  const rankingText = leaderboard.length
    ? "\n\n🏆 <b>Top Students</b>\n" + leaderboard.map((x,i) =>
        (i+1) + ". " + escapeHtml(x.name) + " — <b>" + x.correct + "/" + run.questions.length + "</b>"
      ).join("\n")
    : "\n\nअभी किसी विद्यार्थी ने उत्तर नहीं दिया।";
  await telegram("sendMessage", {
    chat_id: chatId,
    text: (stopped ? "⏹ <b>Quiz रोक दिया गया!</b>" : "🎉 <b>Quiz पूरा हुआ!</b>") +
      "\n📚 कुल प्रश्न: <b>" + run.questions.length + "</b>" +
      "\n👥 कुल उत्तर: <b>" + totalAnswers + "</b>" +
      "\n✅ सही उत्तर: <b>" + correctAnswers + "</b>" +
      "\n❌ गलत उत्तर: <b>" + (totalAnswers-correctAnswers) + "</b>" + rankingText,
    parse_mode: "HTML"
  });
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

function questionsToCsv(questions) {
  const headers = ["cls","subject","chapter","hi","en","A","B","C","D","answer","explain"];
  const lines = [headers.join(",")];
  for (const q of questions) {
    const opts = Array.isArray(q.opts) ? q.opts : [];
    lines.push([
      q.cls, q.subject, q.chapter, q.hi, q.en,
      opts[0], opts[1], opts[2], opts[3],
      ["A","B","C","D"][Number(q.answer)] || "A", q.explain
    ].map(csvCell).join(","));
  }
  return "\uFEFF" + lines.join("\r\n") + "\r\n";
}

async function sendDocument(chatId, filename, content, contentType) {
  const form = new FormData();
  form.append("chat_id", String(chatId));
  form.append("document", new Blob([content], { type: contentType }), filename);
  const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendDocument`, { method: "POST", body: form });
  const result = await response.json();
  if (!result.ok) throw new Error(result.description || "Telegram पर backup भेजने में समस्या हुई।");
}

async function backupCommand(chatId) {
  const questions = await db.getQuestions();
  const backup = {
    app: "Smart Classroom",
    formatVersion: 1,
    exportedAt: new Date().toISOString(),
    totalQuestions: questions.length,
    questions
  };
  const stamp = new Date().toISOString().slice(0,10);
  await sendDocument(chatId, `smart-classroom-backup-${stamp}.json`, JSON.stringify(backup, null, 2), "application/json");
  await sendDocument(chatId, `smart-classroom-questions-${stamp}.csv`, questionsToCsv(questions), "text/csv;charset=utf-8");
  await reply(chatId, `✅ Backup तैयार है। कुल ${questions.length} questions का JSON और CSV दोनों backup भेज दिया गया है।`);
}

function parseRestoreBackup(raw) {
  let data;
  try { data = JSON.parse(raw.replace(/^\uFEFF/, "")); }
  catch { throw new Error("यह valid JSON backup नहीं है। /backup से बनाया गया JSON file भेजें।"); }
  const source = Array.isArray(data) ? data : data?.questions;
  if (!Array.isArray(source) || source.length > 10000) throw new Error("Backup format गलत है या 10,000 से अधिक questions हैं।");
  if (!source.length) throw new Error("Backup में कोई question नहीं है।");
  const questions = source.map((q, i) => {
    const opts = Array.isArray(q.opts) ? q.opts : Array.isArray(q.options) ? q.options : [];
    const answer = Number(q.answer);
    if (!q || !String(q.cls || "").trim() || !String(q.subject || "").trim() ||
        !String(q.chapter || "").trim() || (!String(q.hi || "").trim() && !String(q.en || "").trim()) ||
        opts.length !== 4 || !opts.every(v => String(v ?? "").trim()) ||
        !Number.isInteger(answer) || answer < 0 || answer > 3) {
      throw new Error(`Backup में question ${i + 1} का data invalid है। कोई data restore नहीं किया गया।`);
    }
    return {
      id: String(q.id || `restore_${Date.now()}_${i}_${Math.floor(Math.random()*100000)}`),
      cls: String(q.cls), subject: String(q.subject), chapter: String(q.chapter),
      hi: String(q.hi || ""), en: String(q.en || ""), opts: opts.map(String),
      answer, explain: String(q.explain || q.explanation || "")
    };
  });
  return questions;
}

async function previewRestoreDocument(message) {
  const doc = message.document;
  const filename = String(doc.file_name || "").toLowerCase();
  if (!filename.endsWith(".json")) throw new Error("Restore के लिए /backup से मिला .json file भेजें। CSV के लिए /csv workflow इस्तेमाल करें।");
  if (Number(doc.file_size || 0) > 10 * 1024 * 1024) throw new Error("JSON backup अधिकतम 10 MB की हो सकती है।");
  const info = await telegram("getFile", { file_id: doc.file_id });
  const response = await fetch("https://api.telegram.org/file/bot" + BOT_TOKEN + "/" + info.file_path);
  if (!response.ok) throw new Error("Backup download failed (" + response.status + ")");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 10 * 1024 * 1024) throw new Error("JSON backup अधिकतम 10 MB की हो सकती है।");
  const questions = parseRestoreBackup(bytes.toString("utf8"));
  const chatId = String(message.chat.id);
  pendingRestores.set(chatId, { questions, createdAt: Date.now() });
  await telegram("sendMessage", {
    chat_id: message.chat.id,
    text: "♻️ <b>Backup Restore Preview</b>\n\n" +
      "📄 File: " + escapeHtml(doc.file_name || "backup.json") + "\n" +
      "📚 Backup questions: <b>" + questions.length + "</b>\n" +
      "Restore करने पर backup के questions मौजूदा question bank में जोड़े जाएँगे। Existing questions delete/overwrite नहीं होंगे और duplicate questions skip होंगे।\n\n" +
      "क्या restore करना है?",
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: [[
      { text: "✅ Confirm Restore", callback_data: "restore_confirm" },
      { text: "❌ Cancel", callback_data: "restore_cancel" }
    ]] }
  });
}

async function commitRestore(chatId, incoming, io, room) {
  const existing = await db.getQuestions();
  const seen = new Set(existing.map(questionFingerprint));
  const existingIds = new Set(existing.map(q => String(q.id)));
  const additions = incoming.filter(q => {
    const key = questionFingerprint(q);
    if (seen.has(key)) return false;
    seen.add(key);
    if (existingIds.has(String(q.id))) q.id = `restore_${Date.now()}_${Math.floor(Math.random()*1000000)}`;
    existingIds.add(String(q.id));
    return true;
  });
  if (!additions.length) {
    await reply(chatId, "ℹ️ Backup के सभी questions पहले से मौजूद हैं। कोई बदलाव नहीं किया गया।");
    return;
  }
  const combined = [...existing, ...additions];
  await db.saveQuestions(combined);
  const state = await getState(room, combined);
  state.questions = combined;
  if (!Number.isInteger(state.index) || state.index < 0 || state.index >= combined.length) state.index = 0;
  await publish(io, room, state);
  await reply(chatId, `✅ Restore पूरा हुआ!\nBackup questions: ${incoming.length}\nनए questions restore: ${additions.length}\nDuplicate skip: ${incoming.length-additions.length}\nTotal question bank: ${combined.length}\nपुराने questions सुरक्षित हैं।`);
}


async function sendCsvTemplate(chatId) {
  const csv = "\uFEFFcls,subject,chapter,hi,en,A,B,C,D,answer,explain\r\n" +
    'Class 8,Science,Light,"प्रकाश क्या है?","What is light?",Energy,Wave,Particle,All of these,D,"प्रकाश ऊर्जा का एक रूप है।"\r\n';
  const form = new FormData();
  form.append("chat_id", String(chatId));
  form.append("document", new Blob([csv], { type: "text/csv;charset=utf-8" }), "smart-classroom-template.csv");
  const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendDocument`, { method: "POST", body: form });
  const result = await response.json();
  if (!result.ok) throw new Error(result.description || "CSV template भेजने में समस्या हुई।");
}

async function commitCsvImport(chatId, incoming, io, room) {
  const existing = await db.getQuestions();
  const seen = new Set(existing.map(questionFingerprint));
  const additions = incoming.filter(q => {
    const key = questionFingerprint(q);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (!additions.length) {
    await reply(chatId, "ℹ️ सभी " + incoming.length + " questions पहले से मौजूद हैं। कोई duplicate add नहीं किया गया।");
    return;
  }
  const combined = [...existing, ...additions];
  await db.saveQuestions(combined);
  const state = await getState(room, combined);
  state.questions = combined;
  state.room = room;
  if (!Number.isInteger(state.index) || state.index < 0 || state.index >= combined.length) state.index = 0;
  await publish(io, room, state);
  await reply(chatId,
    "✅ <b>CSV Import पूरा हुआ!</b>\n" +
    "📥 Preview में जाँचे गए: " + incoming.length + "\n" +
    "➕ नए questions add: " + additions.length + "\n" +
    "⏭️ Duplicate skip: " + (incoming.length - additions.length) + "\n" +
    "📚 Total question bank: " + combined.length + "\n\n" +
    "पुराने questions सुरक्षित रखे गए हैं।"
  );
}

function filterQuestionBank(questions, filter = {}) {
  return (questions || []).filter(q =>
    (!filter.cls || String(q.cls) === String(filter.cls)) &&
    (!filter.subject || String(q.subject) === String(filter.subject)) &&
    (!filter.chapter || String(q.chapter) === String(filter.chapter))
  );
}

function optionKeyboard(prefix, values, backText = "⬅️ Back") {
  const buttons = values.map(value => ({ text: prefix + value }));
  const rows = [];
  for (let i = 0; i < buttons.length; i += 2) rows.push(buttons.slice(i, i + 2));
  rows.push([{ text: backText }, { text: "🏠 Home" }]);
  return { keyboard: rows, resize_keyboard: true, is_persistent: true, input_field_placeholder: "Choose an option…" };
}

async function showClassSelection(chatId, questions) {
  const classes = [...new Set(questions.map(q => String(q.cls || "").trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
  if (!classes.length) return reply(chatId, "Question Bank खाली है। पहले questions add करें।");
  selectionSessions.set(String(chatId), { stage: "class", filter: {} });
  await reply(chatId, "🎓 <b>Select Class</b>\nअपनी class चुनें:", optionKeyboard("🏫 ", classes));
}

async function showSubjectSelection(chatId, questions, filter) {
  const subjects = [...new Set(filterQuestionBank(questions, { cls: filter.cls }).map(q => String(q.subject || "").trim()).filter(Boolean))].sort();
  if (!subjects.length) return reply(chatId, "इस Class में कोई Subject नहीं मिला।", mainKeyboard);
  selectionSessions.set(String(chatId), { stage: "subject", filter });
  await reply(chatId, "📘 <b>Select Subject</b>\nClass: " + escapeHtml(filter.cls), optionKeyboard("📘 ", subjects));
}

async function showChapterSelection(chatId, questions, filter) {
  const chapters = [...new Set(filterQuestionBank(questions, { cls: filter.cls, subject: filter.subject }).map(q => String(q.chapter || "").trim()).filter(Boolean))].sort();
  if (!chapters.length) return reply(chatId, "इस Subject में कोई Chapter नहीं मिला।", mainKeyboard);
  selectionSessions.set(String(chatId), { stage: "chapter", filter });
  await reply(chatId, "📖 <b>Select Chapter</b>\n" + escapeHtml(filter.cls + " / " + filter.subject), optionKeyboard("📖 ", chapters));
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

async function previewCsvDocument(message) {
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
  const chatId = String(message.chat.id);
  pendingCsvImports.set(chatId, { questions: incoming, createdAt: Date.now() });
  const sample = incoming.slice(0, 5).map((q, i) =>
    (i + 1) + ". <b>" + escapeHtml(q.cls) + " / " + escapeHtml(q.subject) + "</b>\n" +
    escapeHtml(q.hi || q.en).slice(0, 180) + "\n" +
    "Answer: <b>" + ["A", "B", "C", "D"][q.answer] + "</b>"
  ).join("\n\n");
  await telegram("sendMessage", {
    chat_id: message.chat.id,
    text: "🔎 <b>CSV Preview</b>\n\n" +
      "📄 File: " + escapeHtml(doc.file_name || "questions.csv") + "\n" +
      "📚 कुल valid questions: <b>" + incoming.length + "</b>\n" +
      "नीचे शुरुआती " + Math.min(5, incoming.length) + " सवालों का preview है:\n\n" + sample +
      (incoming.length > 5 ? "\n\n…और " + (incoming.length - 5) + " questions" : "") +
      "\n\nImport करने से पहले preview जाँच लें। Confirm करने पर पुराने questions सुरक्षित रहेंगे और duplicates skip होंगे।",
    parse_mode: "HTML",
    disable_web_page_preview: true,
    reply_markup: { inline_keyboard: [[
      { text: "✅ Confirm Import", callback_data: "csv_confirm" },
      { text: "❌ Cancel", callback_data: "csv_cancel" }
    ]] }
  });
}

async function handleUpdate(update, io) {
  if (update?.callback_query) {
    const callback = update.callback_query;
    const chatId = callback.message?.chat?.id;
    const senderId = String(callback.from?.id || "");
    if (String(callback.data || "").startsWith("qz:")) {
      const parts = callback.data.split(":");
      const quizId = parts[1];
      const selected = Number(parts[2]);
      if (!quizId || !Number.isInteger(selected) || selected < 0 || selected > 3) {
        await telegram("answerCallbackQuery", { callback_query_id: callback.id, text: "Invalid option", show_alert: true });
        return;
      }
      try {
        const activeQuiz = await db.getActiveTelegramQuiz(chatId);
        if (!activeQuiz || activeQuiz.id !== quizId) {
          await telegram("answerCallbackQuery", { callback_query_id: callback.id, text: "यह Quiz बंद हो चुका है।", show_alert: true });
          return;
        }
        const user = callback.from || {};
        const displayName = [user.first_name, user.last_name].filter(Boolean).join(" ") || user.username || "Student";
        const inserted = await db.addTelegramQuizResponse({
          quiz_id: quizId, user_id: senderId, display_name: displayName,
          selected_option: selected, is_correct: selected === Number(activeQuiz.correct_answer)
        });
        if (!inserted) {
          await telegram("answerCallbackQuery", { callback_query_id: callback.id, text: "आपका उत्तर पहले ही दर्ज हो चुका है।", show_alert: true });
          return;
        }
        await telegram("answerCallbackQuery", {
          callback_query_id: callback.id,
          text: selected === Number(activeQuiz.correct_answer) ? "✅ सही उत्तर दर्ज हुआ!" : "उत्तर दर्ज हुआ।",
          show_alert: false
        });
        // Refresh the shared group message with a live response count.
        const responses = await db.getTelegramQuizResponses(quizId);
        const baseText = String(callback.message?.text || "").replace(/\n\n📊 जवाब मिले: \\d+$/, "");
        await telegram("editMessageText", {
          chat_id: chatId,
          message_id: callback.message.message_id,
          text: baseText + "\n\n📊 जवाब मिले: " + responses.length,
          parse_mode: "HTML",
          reply_markup: callback.message.reply_markup
        });
      } catch (error) {
        console.error("Quiz response:", error.message);
        await telegram("answerCallbackQuery", { callback_query_id: callback.id, text: "उत्तर सेव नहीं हुआ। फिर कोशिश करें।", show_alert: true });
      }
      return;
    }
    if (!ADMIN_ID || senderId !== ADMIN_ID) {
      await telegram("answerCallbackQuery", { callback_query_id: callback.id, text: "Unauthorized", show_alert: true });
      return;
    }
    const pending = pendingCsvImports.get(String(chatId));
    if (callback.data === "restore_cancel") {
      pendingRestores.delete(String(chatId));
      await telegram("answerCallbackQuery", { callback_query_id: callback.id, text: "Restore cancelled" });
      await telegram("editMessageReplyMarkup", { chat_id: chatId, message_id: callback.message.message_id, reply_markup: { inline_keyboard: [] } });
      await reply(chatId, "❌ Restore cancel कर दिया गया। कोई बदलाव नहीं हुआ।");
      return;
    }
    if (callback.data === "restore_confirm") {
      const restore = pendingRestores.get(String(chatId));
      if (!restore || Date.now() - restore.createdAt > 15 * 60 * 1000) {
        pendingRestores.delete(String(chatId));
        await telegram("answerCallbackQuery", { callback_query_id: callback.id, text: "Preview expired. Backup फिर से भेजें।", show_alert: true });
        return;
      }
      await telegram("answerCallbackQuery", { callback_query_id: callback.id, text: "Restore शुरू हो रहा है…" });
      pendingRestores.delete(String(chatId));
      await telegram("editMessageReplyMarkup", { chat_id: chatId, message_id: callback.message.message_id, reply_markup: { inline_keyboard: [] } });
      try { await commitRestore(chatId, restore.questions, io, DEFAULT_ROOM); }
      catch (error) { console.error("Backup restore:", error.message); await reply(chatId, "⚠️ Restore failed: " + escapeHtml(error.message)); }
      return;
    }
    if (callback.data === "csv_cancel") {
      pendingCsvImports.delete(String(chatId));
      await telegram("answerCallbackQuery", { callback_query_id: callback.id, text: "Import cancelled" });
      await telegram("editMessageReplyMarkup", { chat_id: chatId, message_id: callback.message.message_id, reply_markup: { inline_keyboard: [] } });
      await reply(chatId, "❌ CSV import cancel कर दिया गया। कोई question add नहीं हुआ।");
      return;
    }
    if (callback.data === "csv_confirm") {
      if (!pending || Date.now() - pending.createdAt > 15 * 60 * 1000) {
        pendingCsvImports.delete(String(chatId));
        await telegram("answerCallbackQuery", { callback_query_id: callback.id, text: "Preview expired. CSV फिर से भेजें।", show_alert: true });
        return;
      }
      await telegram("answerCallbackQuery", { callback_query_id: callback.id, text: "Import शुरू हो रहा है…" });
      pendingCsvImports.delete(String(chatId));
      await telegram("editMessageReplyMarkup", { chat_id: chatId, message_id: callback.message.message_id, reply_markup: { inline_keyboard: [] } });
      try { await commitCsvImport(chatId, pending.questions, io, DEFAULT_ROOM); }
      catch (error) { console.error("CSV import:", error.message); await reply(chatId, "⚠️ Import failed: " + escapeHtml(error.message)); }
    }
    return;
  }
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
      const name = String(message.document.file_name || "").toLowerCase();
      if (name.endsWith(".json")) await previewRestoreDocument(message);
      else await previewCsvDocument(message);
      return;
    }
    const buttonText = message.text.trim();
    const buttonCommands = {
      "🏠 Home": "/start",
      "▶️ Next": "/next",
      "◀️ Previous": "/prev",
      "👁 Show Answer": "/answer",
      "🙈 Hide Answer": "/hide",
      "💾 Backup": "/backup",
      "📝 Start Quiz": "/quiz",
      "⏹ Stop Quiz": "/quizstop",
      "♻️ Restore": "/restore",
      "📄 CSV Help": "/csv",
      "📥 CSV Template": "/csvtemplate",
      "⬅️ Main menu": "/mainmenu",
      "📂 Second menu": "/secondmenu",
      "🎓 Select Questions": "/select",
      "⬅️ Back": "/backselect"
    };
    const normalizedText = buttonCommands[buttonText] || buttonText;
    const [commandToken, ...rest] = normalizedText.split(/\s+/);
    const command = commandToken.split("@")[0].toLowerCase();
    const arg = rest.join(" ").trim();

    if (command === "/select") {
      selectionSessions.delete(String(chatId));
      await showClassSelection(chatId, await db.getQuestions());
      return;
    }
    if (command === "/backselect") {
      const session = selectionSessions.get(String(chatId));
      const bank = await db.getQuestions();
      if (!session || session.stage === "class") {
        await showClassSelection(chatId, bank);
      } else if (session.stage === "subject") {
        await showClassSelection(chatId, bank);
      } else {
        await showSubjectSelection(chatId, bank, { cls: session.filter.cls });
      }
      return;
    }
    if (command === "/secondmenu") {
      await reply(chatId, "📂 <b>Question Bank Menu</b>\nBackup, Restore और CSV tools चुनें।", secondKeyboard);
      return;
    }
    if (command === "/mainmenu") {
      await reply(chatId, "🏠 <b>Main Menu</b>\nClassroom controls चुनें।", mainKeyboard);
      return;
    }

    const selection = selectionSessions.get(String(chatId));
    if (selection && buttonText.startsWith("🏫 ")) {
      const cls = buttonText.slice(3);
      const bank = await db.getQuestions();
      if (!bank.some(q => String(q.cls) === cls)) throw new Error("यह Class अब Question Bank में नहीं है।");
      await showSubjectSelection(chatId, bank, { cls });
      return;
    }
    if (selection && buttonText.startsWith("📘 ")) {
      const subject = buttonText.slice(3);
      const bank = await db.getQuestions();
      if (!filterQuestionBank(bank, { cls: selection.filter.cls }).some(q => String(q.subject) === subject)) throw new Error("यह Subject चुनी गई Class में नहीं है।");
      await showChapterSelection(chatId, bank, { cls: selection.filter.cls, subject });
      return;
    }
    if (selection && buttonText.startsWith("📖 ")) {
      const chapter = buttonText.slice(3);
      const bank = await db.getQuestions();
      const filtered = filterQuestionBank(bank, { cls: selection.filter.cls, subject: selection.filter.subject, chapter });
      if (!filtered.length) throw new Error("इस Chapter में कोई question नहीं मिला।");
      const saved = await getState(room, bank);
      saved.questions = filtered;
      saved.filter = { ...selection.filter, chapter };
      saved.index = 0;
      saved.showAnswer = false;
      selectionSessions.delete(String(chatId));
      await publish(io, room, saved);
      await reply(chatId, "✅ <b>Chapter Selected!</b>\n" +
        "Class: " + escapeHtml(selection.filter.cls) + "\nSubject: " + escapeHtml(selection.filter.subject) +
        "\nChapter: " + escapeHtml(chapter) + "\nQuestions: <b>" + filtered.length +
        "</b>\nअब Next / Previous से सवाल चलाएँ।", mainKeyboard);
      return;
    }
    if (command === "/quiz") {
      if (!["group", "supergroup"].includes(message.chat.type)) {
        await reply(chatId, "📝 Quiz शुरू करने के लिए Bot को अपनी Class Telegram Group में Admin बनाकर उस Group में /quiz भेजें।");
        return;
      }
      if (!db.isConfigured()) throw new Error("Quiz के लिए Supabase configuration जरूरी है।");
      const bank = await db.getQuestions();
      const saved = await getState(room, bank);
      const candidates = filterQuestionBank(bank, saved.filter || {});
      if (!candidates.length) throw new Error("पहले 🎓 Select Questions से Chapter चुनें या Question Bank में सवाल जोड़ें।");
      const previousRun = activeQuizRuns.get(String(chatId));
      if (previousRun?.timer) clearTimeout(previousRun.timer);
      const run = { room, questions: candidates, index: 0, quizIds: [], timer: null };
      activeQuizRuns.set(String(chatId), run);
      await sendQuizQuestion(chatId, room, run);
      await telegram("sendMessage", { chat_id: chatId, text: "✅ Quiz शुरू हो गया। हर प्रश्न के लिए 30 सेकंड हैं; समय पूरा होते ही अगला प्रश्न अपने-आप आएगा।" });
      return;
    }

    if (command === "/quizstop") {
      if (!["group", "supergroup"].includes(message.chat.type)) {
        await reply(chatId, "Quiz बंद करने के लिए Class Group में /quizstop भेजें।", secondKeyboard);
        return;
      }
      const run = activeQuizRuns.get(String(chatId));
      const activeQuiz = await db.getActiveTelegramQuiz(chatId);
      if (!run && !activeQuiz) {
        await reply(chatId, "अभी कोई active Quiz नहीं है।", secondKeyboard);
        return;
      }
      if (run) await finishQuizRun(chatId, room, run, true);
      else await db.stopTelegramQuiz(room);
      return;
    }

    if (command === "/backup") {
      await backupCommand(chatId);
      return;
    }

    if (command === "/restore") {
      await reply(chatId, "♻️ Restore करने के लिए /backup से मिला JSON backup इसी chat में Document के रूप में भेजें। Preview देखकर Confirm/Cancel करें। Restore existing questions को delete नहीं करता।");
      return;
    }

    if (command === "/csvtemplate") {
      await sendCsvTemplate(chatId);
      return;
    }

    if (command === "/csv") {
      await reply(chatId,
        "📄 <b>CSV Import Format</b>\n\n" +
        "Excel में ये header रखें:\n" +
        "<code>cls,subject,chapter,hi,en,A,B,C,D,answer,explain</code>\n\n" +
        "हर row में एक question रखें। Answer में A/B/C/D या 0/1/2/3 लिखें। Hindi या English में से कम-से-कम एक question जरूरी है।\n\n" +
        "File को CSV UTF-8 (.csv) में save करके इसी chat में Document के रूप में भेजें। पहले preview आएगा, फिर Confirm/Cancel चुनें।\n" +
        "एक file में अधिकतम 1000 questions और 5 MB। पुराने questions सुरक्षित रहेंगे; exact duplicates skip होंगे।\n/csvtemplate से sample CSV डाउनलोड करें।"
      );
      return;
    }

    if (command === "/start" || command === "/help") {
      await reply(chatId,
        "🏫 <b>Smart Classroom Admin Bot</b>\n\n" +
        "/status — classroom status\n/select — Class → Subject → Chapter चुनें\n/next — अगला सवाल\n/prev — पिछला सवाल\n/answer — उत्तर दिखाएँ\n/hide — उत्तर छिपाएँ\n" +
        "/list — questions की सूची\n/add — नया question जोड़ें\n/csv — CSV import format\n/csvtemplate — sample CSV डाउनलोड करें\n/backup — JSON + CSV backup भेजें\n/restore — JSON backup restore करें\n/edit — question बदलें\n/delete ID — question हटाएँ\n\n" +
        "<b>/add format:</b>\n<code>/add Class 8 | Science | Light | प्रकाश क्या है? | What is light? | A | B | C | D | B | Explanation</code>\n" +
        "<b>/edit format:</b>\n<code>/edit ID | Class 8 | Science | Light | ...same fields...</code>"
      );
      return;
    }

    const questions = await db.getQuestions();
    let state = await getState(room, questions);
    const activeQuestions = filterQuestionBank(questions, state.filter || {});
    state.questions = activeQuestions;

    if (command === "/status") {
      const q = activeQuestions[state.index];
      await reply(chatId, `🟢 <b>Room:</b> ${escapeHtml(room)}\n<b>Questions:</b> ${activeQuestions.length}\n<b>Current:</b> ${activeQuestions.length ? state.index + 1 : 0}/${activeQuestions.length}\n<b>Answer:</b> ${state.showAnswer ? "Visible" : "Hidden"}\n${q ? escapeHtml(q.hi || q.en) : "No question selected"}`);
      return;
    }

    if (command === "/list") {
      const lines = activeQuestions.slice(0, 30).map((q, i) => `${i + 1}. <code>${escapeHtml(q.id)}</code> — ${escapeHtml(q.cls)} / ${escapeHtml(q.subject)} — ${escapeHtml(q.hi || q.en).slice(0, 90)}`);
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
      if (!activeQuestions.length) throw new Error("इस selection में कोई question नहीं है। 🎓 Select Questions से नया Chapter चुनें।");
      if (command === "/next") state.index = Math.min(activeQuestions.length - 1, state.index + 1);
      if (command === "/prev") state.index = Math.max(0, state.index - 1);
      if (command === "/answer") state.showAnswer = true;
      if (command === "/hide") state.showAnswer = false;
      state.questions = activeQuestions;
      await publish(io, room, state);
      const current = activeQuestions[state.index];
      await reply(chatId, `✅ TV updated: ${state.index + 1}/${activeQuestions.length}\n${escapeHtml(current.hi || current.en)}`);
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
    allowed_updates: ["message", "callback_query"]
  });
  await telegram("setMyCommands", {
    commands: [
      { command: "start", description: "Open Smart Classroom bot" },
      { command: "status", description: "Show classroom status" },
      { command: "select", description: "Select class, subject and chapter" },
      { command: "next", description: "Next question" },
      { command: "prev", description: "Previous question" },
      { command: "answer", description: "Show answer" },
      { command: "hide", description: "Hide answer" },
      { command: "list", description: "List questions" },
      { command: "add", description: "Add a question" },
      { command: "csv", description: "Preview and import CSV questions" },
      { command: "csvtemplate", description: "Download sample CSV template" },
      { command: "backup", description: "Export question bank JSON and CSV" },
      { command: "quiz", description: "Start current question quiz in class group" },
      { command: "quizstop", description: "Stop the active class quiz" },
      { command: "restore", description: "Restore questions from JSON backup" },
      { command: "edit", description: "Edit a question" },
      { command: "delete", description: "Delete a question" }
    ]
  });
  console.log("Telegram webhook registered.");
}

module.exports = { handleUpdate, configureWebhook };
