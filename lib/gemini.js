const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

function extractJson(text) {
  const cleaned = String(text || "").replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first < 0 || last <= first) throw new Error("Gemini ने valid JSON नहीं दिया। दोबारा कोशिश करें।");
  return JSON.parse(cleaned.slice(first, last + 1));
}

async function generateQuestions({ cls, subject, chapter, count = 10, difficulty = "medium", language = "both" }) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY Render Environment में सेट नहीं है।");
  const n = Math.max(1, Math.min(50, Number(count) || 10));
  const lang = language === "hi" ? "Hindi only" : language === "en" ? "English only" : "Hindi and English";
  const prompt = "Create exactly " + n + " original school-level MCQs for Class " + cls + ", subject " + subject + ", chapter " + chapter + ". Difficulty: " + difficulty + ". Language: " + lang + ". Return ONLY JSON: {\"questions\":[{\"hi\":\"Hindi question or empty\",\"en\":\"English question or empty\",\"opts\":[\"A\",\"B\",\"C\",\"D\"],\"answer\":0,\"explain\":\"Short explanation\"}]}. answer is integer 0-3. Exactly four plausible distinct options and one unambiguous correct answer. Avoid duplicates. Keep Hindi and English aligned when both requested.";
  const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models/" + MODEL + ":generateContent?key=" + encodeURIComponent(key), {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { temperature: 0.45, responseMimeType: "application/json" } })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error?.message || "Gemini API request failed");
  const raw = data?.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("") || "";
  const parsed = extractJson(raw);
  if (!Array.isArray(parsed.questions)) throw new Error("Gemini response में questions नहीं मिले।");
  const questions = parsed.questions.slice(0, n).map((q, i) => {
    const opts = Array.isArray(q.opts) ? q.opts.map(v => String(v || "").trim()) : [];
    const answer = Number(q.answer);
    if ((!String(q.hi || "").trim() && !String(q.en || "").trim()) || opts.length !== 4 || opts.some(v => !v) || !Number.isInteger(answer) || answer < 0 || answer > 3) throw new Error("Generated question " + (i + 1) + " का format गलत है। फिर Generate करें।");
    return { id: "ai_" + Date.now() + "_" + i + "_" + Math.floor(Math.random()*10000), cls, subject, chapter, hi: String(q.hi || ""), en: String(q.en || ""), opts, answer, explain: String(q.explain || "") };
  });
  if (questions.length !== n) throw new Error("Gemini ने " + questions.length + "/" + n + " सवाल दिए। फिर कोशिश करें।");
  return questions;
}

module.exports = { generateQuestions };