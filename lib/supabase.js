const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || "";

function isConfigured() {
  return Boolean(SUPABASE_URL && SUPABASE_KEY);
}

async function dbRequest(path, options = {}) {
  if (!isConfigured()) throw new Error("Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Supabase ${response.status}: ${body.slice(0, 500)}`);
  return body ? JSON.parse(body) : null;
}

function fromRow(row) {
  return {
    id: row.id,
    cls: row.cls || "",
    subject: row.subject || "",
    chapter: row.chapter || "",
    hi: row.hi || "",
    en: row.en || "",
    opts: Array.isArray(row.opts) ? row.opts : [],
    answer: Number(row.answer || 0),
    explain: row.explain || ""
  };
}

function toRow(question) {
  return {
    id: String(question.id),
    cls: String(question.cls || ""),
    subject: String(question.subject || ""),
    chapter: String(question.chapter || ""),
    hi: String(question.hi || ""),
    en: String(question.en || ""),
    opts: Array.isArray(question.opts) ? question.opts : Array.isArray(question.options) ? question.options : [question.A, question.B, question.C, question.D].filter(v => v != null),
    answer: Math.max(0, Math.min(3, Number(question.answer) || 0)),
    explain: String(question.explain || question.explanation || "")
  };
}

async function getQuestions() {
  const rows = await dbRequest("questions?select=*&order=created_at.asc");
  return (rows || []).map(fromRow);
}

async function saveQuestions(questions) {
  const rows = (questions || []).map(toRow);
  if (!rows.length) {
    await dbRequest("questions?id=not.is.null", { method: "DELETE", headers: { Prefer: "return=minimal" } });
    return [];
  }
  await dbRequest("questions?on_conflict=id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(rows)
  });
  const keep = rows.map(row => row.id);
  const existing = await dbRequest("questions?select=id");
  const stale = (existing || []).filter(row => !keep.includes(row.id)).map(row => row.id);
  for (const id of stale) {
    await dbRequest(`questions?id=eq.${encodeURIComponent(id)}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
  }
  return questions;
}

async function appendQuestions(questions) {
  const rows = (questions || []).map(toRow);
  if (!rows.length) return [];
  await dbRequest("questions?on_conflict=id", {
    method: "POST",
    headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
    body: JSON.stringify(rows)
  });
  const ids = rows.map(row => row.id);
  const found = await dbRequest("questions?select=id&id=in.(" + ids.map(encodeURIComponent).join(",") + ")");
  const savedIds = new Set((found || []).map(row => String(row.id)));
  const missing = ids.filter(id => !savedIds.has(String(id)));
  if (missing.length) {
    throw new Error("Supabase में " + missing.length + " generated questions verify नहीं हुए।");
  }
  return rows;
}

async function getClassroomState(room = "CLASS10") {
  const rows = await dbRequest(`classroom_state?select=state&room=eq.${encodeURIComponent(room)}&limit=1`);
  return rows?.[0]?.state || null;
}

async function saveClassroomState(room, state) {
  await dbRequest("classroom_state?on_conflict=room", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify([{ room, state, updated_at: new Date().toISOString() }])
  });
  return state;
}


async function startTelegramQuiz(quiz) {
  await dbRequest(`telegram_quizzes?room=eq.${encodeURIComponent(quiz.room)}&active=eq.true`, {
    method: "PATCH", headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ active: false })
  });
  const rows = await dbRequest("telegram_quizzes", {
    method: "POST", headers: { Prefer: "return=representation" },
    body: JSON.stringify([quiz])
  });
  return rows?.[0] || quiz;
}

async function getActiveTelegramQuiz(chatId) {
  const rows = await dbRequest(`telegram_quizzes?select=*&chat_id=eq.${encodeURIComponent(String(chatId))}&active=eq.true&order=created_at.desc&limit=1`);
  return rows?.[0] || null;
}

async function addTelegramQuizResponse(response) {
  const rows = await dbRequest("telegram_quiz_responses?on_conflict=quiz_id,user_id", {
    method: "POST",
    headers: { Prefer: "resolution=ignore-duplicates,return=representation" },
    body: JSON.stringify([response])
  });
  return (rows || []).length > 0;
}

async function getTelegramQuizResponses(quizId) {
  return dbRequest(`telegram_quiz_responses?select=user_id,display_name,selected_option,is_correct&quiz_id=eq.${encodeURIComponent(quizId)}`);
}

async function saveTelegramQuizSession(session) {
  await dbRequest("telegram_quiz_sessions?on_conflict=chat_id", {
    method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify([{ ...session, updated_at: new Date().toISOString() }])
  });
}
async function getActiveTelegramQuizSessions() {
  return dbRequest("telegram_quiz_sessions?select=*&active=eq.true&order=updated_at.asc");
}
async function stopTelegramQuizSession(chatId) {
  await dbRequest("telegram_quiz_sessions?chat_id=eq." + encodeURIComponent(String(chatId)) + "&active=eq.true", {
    method: "PATCH", headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ active: false, status: "stopped", updated_at: new Date().toISOString() })
  });
}
async function stopTelegramQuiz(room) {
  await dbRequest(`telegram_quizzes?room=eq.${encodeURIComponent(room)}&active=eq.true`, {
    method: "PATCH", headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ active: false })
  });
}

module.exports = { isConfigured, getQuestions, saveQuestions, appendQuestions, getClassroomState, saveClassroomState, startTelegramQuiz, getActiveTelegramQuiz, addTelegramQuizResponse, getTelegramQuizResponses, stopTelegramQuiz, saveTelegramQuizSession, getActiveTelegramQuizSessions, stopTelegramQuizSession };
