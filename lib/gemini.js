const MODEL = process.env.GEMINI_MODEL || "gemini-3.8-flash";

function extractJson(text) {
  const cleaned = String(text || "").replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first < 0 || last <= first) throw new Error("Gemini ने valid JSON नहीं दिया।");
  return JSON.parse(cleaned.slice(first, last + 1));
}

async function generateQuestions({ cls, subject, chapter, count = 10, difficulty = "medium", language = "both" }) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY Render Environment में सेट नहीं है।");
  const n = Math.max(1, Math.min(50, Number(count) || 10));
  const lang = language === "hi" ? "Hindi only" : language === "en" ? "English only" : "Hindi and English";
  const prompt = "Create exactly " + n + " original school-level MCQs for Class " + cls + ", subject " + subject + ", chapter " + chapter + ". Difficulty: " + difficulty + ". Language: " + lang + ". Return an object with a questions array. Each item must contain hi (Hindi question or empty string), en (English question or empty string), opts (exactly four distinct options), answer (integer 0-3), and explain (short explanation). Ensure one unambiguous correct answer, avoid duplicates, and keep Hindi and English aligned when both are requested.";
  const schema = {
    type: "object",
    properties: {
      questions: { type: "array", items: {
        type: "object",
        properties: { hi: { type: "string" }, en: { type: "string" }, opts: { type: "array", items: { type: "string" }, minItems: 4, maxItems: 4 }, answer: { type: "integer", minimum: 0, maximum: 3 }, explain: { type: "string" } },
        required: ["hi", "en", "opts", "answer", "explain"]
      } }
    },
    required: ["questions"]
  };
  const response = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      model: MODEL, input: prompt, store: false,
      response_format: { type: "text", mime_type: "application/json", schema },
      generation_config: { temperature: 0.45, max_output_tokens: 12000 }
    })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error?.message || "Gemini Interactions API request failed");
  const raw = (data?.steps || []).filter(step => step.type === "model_output").flatMap(step => step.content || []).filter(item => item.type === "text").map(item => item.text || "").join("");
  if (!raw) throw new Error("Gemini response में text output नहीं मिला।");
  const parsed = extractJson(raw);
  if (!Array.isArray(parsed.questions)) throw new Error("Gemini response में questions नहीं मिले।");
  const questions = parsed.questions.slice(0, n).map((q, i) => {
    const opts = Array.isArray(q.opts) ? q.opts.map(v => String(v || "").trim()) : [];
    const answer = Number(q.answer);
    if ((!String(q.hi || "").trim() && !String(q.en || "").trim()) || opts.length !== 4 || opts.some(v => !v) || new Set(opts.map(v => v.toLowerCase())).size !== 4 || !Number.isInteger(answer) || answer < 0 || answer > 3) throw new Error("Generated question " + (i + 1) + " का format गलत है। फिर Generate करें।");
    return { id: "ai_" + Date.now() + "_" + i + "_" + Math.floor(Math.random()*10000), cls, subject, chapter, hi: String(q.hi || ""), en: String(q.en || ""), opts, answer, explain: String(q.explain || "") };
  });
  if (questions.length !== n) throw new Error("Gemini ने " + questions.length + "/" + n + " सवाल दिए। फिर कोशिश करें।");
  return questions;
}

module.exports = { generateQuestions };