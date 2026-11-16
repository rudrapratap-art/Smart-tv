const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || "";

function isConfigured() {
  return Boolean(SUPABASE_URL && SUPABASE_KEY);
}

async function dbRequest(path, options = {}) {
  if (!isConfigured()) throw new Error("Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  const { returnMeta = false, ...fetchOptions } = options;
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...fetchOptions,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      ...(fetchOptions.headers || {})
    }
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Supabase ${response.status}: ${body.slice(0, 500)}`);
  const data = body ? JSON.parse(body) : null;
  return returnMeta ? { data, headers: response.headers } : data;
}

async function getAllRows(path, pageSize = 500) {
  const all = [];
  let offset = 0;
  for (let page = 0; page < 10000; page += 1) {
    const result = await dbRequest(path, {
      returnMeta: true,
      headers: {
        Range: `${offset}-${offset + pageSize - 1}`,
        "Range-Unit": "items",
        Prefer: "count=exact"
      }
    });
    const rows = Array.isArray(result.data) ? result.data : [];
    if (!rows.length) break;
    all.push(...rows);
    const range = result.headers.get("content-range") || "";
    const match = range.match(/\/(\d+|\*)$/);
    const total = match && match[1] !== "*" ? Number(match[1]) : null;
    if (total !== null && offset + rows.length >= total) break;
    if (total === null && rows.length < pageSize) break;
    offset += rows.length;
  }
  return all;
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
    explain: row.explain || "",
    created_at: row.created_at || null,
    updated_at: row.updated_at || null
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
  const rows = await getAllRows("questions?select=*&order=created_at.asc");
  return rows.map(fromRow);
}

async function saveQuestions(questions) {
  const rows = (questions || []).map(toRow);
  if (!rows.length) return [];
  await dbRequest("questions?on_conflict=id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(rows)
  });
  return questions;
}

async function deleteQuestions(ids) {
  const uniqueIds = [...new Set((ids || []).map(id => String(id || "").trim()).filter(Boolean))];
  let deletedCount = 0;
  for (let offset = 0; offset < uniqueIds.length; offset += 100) {
    const chunk = uniqueIds.slice(offset, offset + 100);
    const filter = chunk.map(id => `"${id.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`).join(",");
    const deleted = await dbRequest("questions?id=in.(" + encodeURIComponent(filter) + ")", {
      method: "DELETE",
      headers: { Prefer: "return=representation" }
    });
    deletedCount += Array.isArray(deleted) ? deleted.length : 0;
  }
  return deletedCount;
}

async function appendQuestions(questions) {
  const rows = (questions || []).map(toRow);
  if (!rows.length) return [];
  const saved = await dbRequest("questions?on_conflict=id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify(rows)
  });
  const savedIds = new Set((saved || []).map(row => String(row.id)));
  const missing = rows.filter(row => !savedIds.has(String(row.id)));
  if (missing.length) {
    // Fallback verification uses individual equality filters to avoid long or
    // unsupported IN-filter parsing by intermediate PostgREST proxies.
    const verified = [];
    for (const row of missing) {
      const found = await dbRequest("questions?select=id&id=eq." + encodeURIComponent(row.id) + "&limit=1");
      if (found?.length) verified.push(String(found[0].id));
    }
    verified.forEach(id => savedIds.add(id));
  }
  const stillMissing = rows.filter(row => !savedIds.has(String(row.id)));
  if (stillMissing.length) {
    throw new Error("Supabase में " + stillMissing.length + "/" + rows.length + " प्रश्न save होने की पुष्टि नहीं हुई।");
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

module.exports = { isConfigured, getQuestions, saveQuestions, deleteQuestions, appendQuestions, getClassroomState, saveClassroomState, startTelegramQuiz, getActiveTelegramQuiz, addTelegramQuizResponse, getTelegramQuizResponses, stopTelegramQuiz, saveTelegramQuizSession, getActiveTelegramQuizSessions, stopTelegramQuizSession };
