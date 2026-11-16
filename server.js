const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");
const db = require("./lib/supabase");
const bot = require("./bot");
const gemini = require("./lib/gemini");
const { toDisplayState, broadcastClassroomState } = require("./lib/classroom-state");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: false } });
app.use(express.json({ limit: "10mb" }));
app.use(express.static(path.join(__dirname, "public")));

const DEFAULT_ROOM = String(process.env.CLASSROOM_ROOM || "CLASS10").toUpperCase();
const ADMIN_KEY = process.env.CLASSROOM_ADMIN_KEY || "";
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || "";

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}

function requireAdmin(req, res, next) {
  if (!safeEqual(req.get("x-admin-key"), ADMIN_KEY)) {
    return res.status(401).json({ error: "Unauthorized. Configure the classroom admin key." });
  }
  next();
}

async function broadcastQuestionBank() {
  const questions = await db.getQuestions();
  const sockets = await io.fetchSockets();
  for (const socket of sockets) {
    if (socket.data?.isAdmin) socket.emit("question-bank", questions);
  }
}

io.use((socket, next) => {
  socket.data.isAdmin = safeEqual(socket.handshake.auth?.adminKey, ADMIN_KEY);
  next();
});

app.get("/health", (req, res) => res.json({
  ok: true,
  app: "Smart Classroom",
  databaseConfigured: db.isConfigured(),
  telegramConfigured: Boolean(process.env.TELEGRAM_BOT_TOKEN)
}));

app.get("/api/questions", requireAdmin, async (req, res) => {
  try {
    if (!db.isConfigured()) return res.status(503).json({ error: "Database is not configured" });
    res.set("Cache-Control", "no-store");
    res.json({ questions: await db.getQuestions() });
  } catch (error) {
    console.error("Questions API:", error.message);
    res.status(500).json({ error: "Unable to load questions" });
  }
});

app.post("/api/ai/generate", requireAdmin, async (req, res) => {
  try {
    const { cls, subject, chapter, count, difficulty, language } = req.body || {};
    if (!String(cls || "").trim() || !String(subject || "").trim() || !String(chapter || "").trim()) {
      return res.status(400).json({ error: "Class, Subject और Chapter जरूरी हैं।" });
    }
    const questions = await gemini.generateQuestions({ cls: String(cls).slice(0,40), subject: String(subject).slice(0,60), chapter: String(chapter).slice(0,100), count, difficulty, language });
    res.set("Cache-Control", "no-store");
    res.json({ ok: true, questions });
  } catch (error) {
    console.error("Gemini generation:", error.message);
    res.status(502).json({ error: error.message || "Question generation failed" });
  }
});

app.put("/api/questions", requireAdmin, async (req, res) => {
  try {
    if (!db.isConfigured()) return res.status(503).json({ error: "Database is not configured" });
    if (!Array.isArray(req.body?.questions)) return res.status(400).json({ error: "questions must be an array" });
    if (req.body.questions.length > 5000) return res.status(413).json({ error: "Question limit exceeded" });
    const questions = await db.saveQuestions(req.body.questions);
    await broadcastQuestionBank();
    res.json({ ok: true, count: questions.length });
  } catch (error) {
    console.error("Save questions API:", error.message);
    res.status(500).json({ error: "Unable to save questions" });
  }
});

app.delete("/api/questions", requireAdmin, async (req, res) => {
  try {
    if (!db.isConfigured()) return res.status(503).json({ error: "Database is not configured" });
    const ids = req.body?.ids;
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > 5000) {
      return res.status(400).json({ error: "ids must be an array containing 1–5000 question IDs" });
    }
    const count = await db.deleteQuestions(ids);
    await broadcastQuestionBank();
    res.json({ ok: true, count });
  } catch (error) {
    console.error("Delete questions API:", error.message);
    res.status(500).json({ error: "Unable to delete questions" });
  }
});

app.post("/telegram/webhook", async (req, res) => {
  if (!WEBHOOK_SECRET || req.get("x-telegram-bot-api-secret-token") !== WEBHOOK_SECRET) {
    return res.sendStatus(401);
  }
  res.sendStatus(200);
  try {
    await bot.handleUpdate(req.body, io);
  } catch (error) {
    console.error("Telegram update failed:", error.message);
  }
});

io.on("connection", socket => {
  socket.on("join-room", async roomValue => {
    const room = String(roomValue || DEFAULT_ROOM).toUpperCase().slice(0, 24);
    for (const joinedRoom of socket.rooms) {
      if (joinedRoom !== socket.id) socket.leave(joinedRoom);
    }
    socket.join(room);
    socket.emit("joined", room);
    try {
      const questions = db.isConfigured() ? await db.getQuestions() : [];
      const saved = db.isConfigured() ? await db.getClassroomState(room) : null;
      let state;
      if (saved) {
        const filter = saved.filter || {};
        state = {
          ...saved,
          room,
          questions: questions.filter(q =>
            (!filter.cls || filter.cls === "all" || String(q.cls) === String(filter.cls)) &&
            (!filter.subject || String(q.subject) === String(filter.subject)) &&
            (!filter.chapter || String(q.chapter) === String(filter.chapter)) &&
            (!Array.isArray(filter.subjects) || !filter.subjects.length || filter.subjects.includes(String(q.subject))) &&
            (!Array.isArray(filter.chapters) || !filter.chapters.length || filter.chapters.includes(String(q.chapter)))
          )
        };
        if (!Number.isInteger(state.index) || state.index < 0 || state.index >= state.questions.length) state.index = 0;
      } else {
        state = { questions, index: 0, showAnswer: false, room, language: "both", progress: true };
      }
      socket.emit("class-state", toDisplayState(state));
      if (socket.data.isAdmin) socket.emit("admin-class-state", state);
    } catch (error) {
      console.error("Room initialization:", error.message);
    }
  });

  socket.on("class-state", async payload => {
    if (!socket.data.isAdmin) {
      socket.emit("write-denied", { error: "Teacher admin key required for classroom controls." });
      return;
    }
    if (!payload || typeof payload !== "object" || !payload.state || typeof payload.state !== "object") return;
    const room = String(payload.room || payload.state.room || DEFAULT_ROOM).toUpperCase().slice(0, 24);
    if (!socket.rooms.has(room)) return;
    const state = { ...payload.state, room };
    if (!Array.isArray(state.questions)) return;
    state.index = Math.max(0, Math.min(Number(state.index) || 0, Math.max(0, state.questions.length - 1)));
    try {
      if (db.isConfigured()) await db.saveClassroomState(room, state);
      await broadcastClassroomState(io, room, state);
    } catch (error) {
      console.error("Class state sync:", error.message);
      socket.emit("sync-error", { error: "Classroom state could not be saved." });
    }
  });
});

const port = process.env.PORT || 3000;
server.listen(port, "0.0.0.0", async () => {
  console.log(`Smart Classroom running on ${port}`);
  if (!db.isConfigured()) console.warn("Supabase is not configured; set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  try { await bot.configureWebhook(); }
  catch (error) { console.error("Telegram webhook setup failed:", error.message); }
  try { await bot.recoverActiveQuizRuns(); }
  catch (error) { console.error("Telegram quiz recovery failed:", error.message); }
});
