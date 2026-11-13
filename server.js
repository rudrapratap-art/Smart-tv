const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");
const db = require("./lib/supabase");
const bot = require("./bot");
const gemini = require("./lib/gemini");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: false } });
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

const DEFAULT_ROOM = String(process.env.CLASSROOM_ROOM || "CLASS10").toUpperCase();
const ADMIN_KEY = process.env.CLASSROOM_ADMIN_KEY || "";
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || "";

function requireAdmin(req, res, next) {
  if (!ADMIN_KEY || req.get("x-admin-key") !== ADMIN_KEY) {
    return res.status(401).json({ error: "Unauthorized. Configure the classroom admin key." });
  }
  next();
}

app.get("/health", (req, res) => res.json({
  ok: true,
  app: "Smart Classroom",
  databaseConfigured: db.isConfigured(),
  telegramConfigured: Boolean(process.env.TELEGRAM_BOT_TOKEN)
}));

app.get("/api/questions", async (req, res) => {
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
    res.json({ ok: true, count: questions.length });
  } catch (error) {
    console.error("Save questions API:", error.message);
    res.status(500).json({ error: "Unable to save questions" });
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
    socket.join(room);
    socket.emit("joined", room);
    try {
      const questions = db.isConfigured() ? await db.getQuestions() : [];
      const saved = db.isConfigured() ? await db.getClassroomState(room) : null;
      if (saved) {
        const filter = saved.filter || {};
        saved.questions = questions.filter(q =>
          (!filter.cls || String(q.cls) === String(filter.cls)) &&
          (!filter.subject || String(q.subject) === String(filter.subject)) &&
          (!filter.chapter || String(q.chapter) === String(filter.chapter)) &&
          (!Array.isArray(filter.subjects) || !filter.subjects.length || filter.subjects.includes(String(q.subject))) &&
          (!Array.isArray(filter.chapters) || !filter.chapters.length || filter.chapters.includes(String(q.chapter)))
        );
        if (!Number.isInteger(saved.index) || saved.index < 0 || saved.index >= saved.questions.length) saved.index = 0;
        socket.emit("class-state", saved);
      } else if (questions.length) {
        socket.emit("class-state", { questions, index: 0, showAnswer: false, room, language: "both", progress: true });
      }
    } catch (error) {
      console.error("Room initialization:", error.message);
    }
  });

  socket.on("class-state", async payload => {
    if (!payload || typeof payload !== "object" || !payload.state || typeof payload.state !== "object") return;
    const room = String(payload.room || payload.state.room || DEFAULT_ROOM).toUpperCase().slice(0, 24);
    const state = { ...payload.state, room };
    if (!Array.isArray(state.questions)) return;
    state.index = Math.max(0, Math.min(Number(state.index) || 0, Math.max(0, state.questions.length - 1)));
    try {
      if (db.isConfigured()) await db.saveClassroomState(room, state);
      io.to(room).emit("class-state", state);
    } catch (error) {
      console.error("Class state sync:", error.message);
      socket.to(room).emit("class-state", state);
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
