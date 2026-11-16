const test = require("node:test");
const assert = require("node:assert/strict");

process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "unit-test-key";
const db = require("../lib/supabase");
const { toDisplayState, broadcastClassroomState } = require("../lib/classroom-state");

test("question reads continue through a server-side five-row cap", async () => {
  const originalFetch = global.fetch;
  const rows = Array.from({ length: 1045 }, (_, index) => ({
    id: String(index + 1), cls: "Class 10", subject: "Science",
    chapter: "Electricity", hi: "Q" + index, en: "", opts: ["A", "B", "C", "D"],
    answer: 0, explain: "", created_at: new Date(index * 1000).toISOString()
  }));
  const ranges = [];
  global.fetch = async (_url, options) => {
    const range = options.headers.Range;
    ranges.push(range);
    const start = Number(range.split("-")[0]);
    const page = rows.slice(start, start + 5);
    const end = page.length ? start + page.length - 1 : start;
    return new Response(JSON.stringify(page), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Content-Range": page.length ? `${start}-${end}/${rows.length}` : `*/${rows.length}`
      }
    });
  };
  try {
    const questions = await db.getQuestions();
    assert.equal(questions.length, 1045);
    assert.equal(questions[0].id, "1");
    assert.equal(questions.at(-1).id, "1045");
    assert.equal(ranges.length, 209);
    assert.equal(ranges[0], "0-499");
    assert.equal(ranges[1], "5-504");
  } finally {
    global.fetch = originalFetch;
  }
});

test("public classroom state hides every answer until reveal", () => {
  const state = {
    index: 1, showAnswer: false,
    questions: [
      { id: "a", answer: 0, explain: "first" },
      { id: "b", answer: 2, explain: "second" }
    ]
  };
  const hidden = toDisplayState(state);
  assert.equal("answer" in hidden.questions[0], false);
  assert.equal("answer" in hidden.questions[1], false);
  assert.equal("explain" in hidden.questions[1], false);

  const revealed = toDisplayState({ ...state, showAnswer: true });
  assert.equal("answer" in revealed.questions[0], false);
  assert.equal(revealed.questions[1].answer, 2);
  assert.equal(revealed.questions[1].explain, "second");
});

test("broadcast sends redacted state publicly and full state only to admin sockets", async () => {
  const publicEvents = [];
  const adminEvents = [];
  const io = {
    to: () => ({ emit: (event, payload) => publicEvents.push({ event, payload }) }),
    in: () => ({ fetchSockets: async () => [
      { data: { isAdmin: true }, emit: (event, payload) => adminEvents.push({ event, payload }) },
      { data: { isAdmin: false }, emit: (event, payload) => adminEvents.push({ event, payload }) }
    ] })
  };
  const state = { index: 0, showAnswer: false, questions: [{ id: "x", answer: 3, explain: "secret" }] };
  await broadcastClassroomState(io, "CLASS10", state);
  assert.equal("answer" in publicEvents[0].payload.questions[0], false);
  assert.equal(adminEvents.length, 1);
  assert.equal(adminEvents[0].event, "admin-class-state");
  assert.equal(adminEvents[0].payload.questions[0].answer, 3);
});

test("question saves are append-only and never delete unseen rows", async () => {
  const originalFetch = global.fetch;
  const requests = [];
  global.fetch = async (url, options) => {
    requests.push({ url: String(url), method: options.method || "GET" });
    return new Response(null, { status: 204 });
  };
  try {
    await db.saveQuestions([{
      id: "new-question", cls: "Class 10", subject: "Science",
      chapter: "Electricity", hi: "Question", en: "",
      opts: ["A", "B", "C", "D"], answer: 1, explain: ""
    }]);
    assert.deepEqual(requests.map(request => request.method), ["POST"]);
    assert.equal(requests.some(request => request.method === "DELETE"), false);
  } finally {
    global.fetch = originalFetch;
  }
});

test("bulk deletion is limited to explicit unique IDs", async () => {
  const originalFetch = global.fetch;
  const requests = [];
  global.fetch = async (url, options) => {
    requests.push({ url: String(url), method: options.method });
    return new Response(JSON.stringify([{ id: "q-1" }, { id: "q-2" }]), {
      status: 200, headers: { "Content-Type": "application/json" }
    });
  };
  try {
    const count = await db.deleteQuestions(["q-1", "q-2", "q-1"]);
    assert.equal(count, 2);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].method, "DELETE");
    assert.match(requests[0].url, /id=in\./);
    assert.match(requests[0].url, /q-1/);
    assert.match(requests[0].url, /q-2/);
  } finally {
    global.fetch = originalFetch;
  }
});

test("pagination does not stop early when Content-Range total is unknown", async () => {
  const originalFetch = global.fetch;
  const rows = Array.from({ length: 23 }, (_, index) => ({
    id: String(index + 1), cls: "Class 10", subject: "Science",
    chapter: "Electricity", hi: "Q" + index, en: "", opts: ["A", "B", "C", "D"],
    answer: 0, explain: ""
  }));
  const ranges = [];
  global.fetch = async (_url, options) => {
    const start = Number(options.headers.Range.split("-")[0]);
    ranges.push(options.headers.Range);
    const page = rows.slice(start, start + 5);
    const end = page.length ? start + page.length - 1 : start;
    return new Response(JSON.stringify(page), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Content-Range": page.length ? `${start}-${end}/*` : "*/*"
      }
    });
  };
  try {
    const questions = await db.getQuestions();
    assert.equal(questions.length, 23);
    assert.equal(ranges.length, 5);
  } finally {
    global.fetch = originalFetch;
  }
});
