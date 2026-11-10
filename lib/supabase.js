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

module.exports = { isConfigured, getQuestions, saveQuestions, getClassroomState, saveClassroomState };
