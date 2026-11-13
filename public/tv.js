const $ = id => document.getElementById(id);

let state = {
  questions: [],
  index: 0,
  showAnswer: false,
  language: "both",
  progress: true
};

const params = new URLSearchParams(location.search);
const room = (params.get("room") || "CLASS10").toUpperCase();
const socket = window.io ? io() : null;

function escHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[char]));
}

function render() {
  const list = Array.isArray(state.questions) ? state.questions : [];
  const index = Math.max(0, Math.min(Number(state.index) || 0, list.length - 1));
  const q = list[index];

  $("tvOptions").innerHTML = "";
  $("tvAnswer").classList.add("hidden");

  if (!q) {
    $("tvClass").textContent = "SMART CLASSROOM";
    $("tvChapter").textContent = "WAITING FOR QUESTION";
    $("tvCounter").textContent = "QUESTION 0 / 0";
    $("tvQuestion").textContent = "मोबाइल या Telegram Controller से सवाल चुनें";
    $("tvQuestionEn").textContent = "Choose a question from the mobile or Telegram controller";
    $("tvProgress").style.width = "0%";
    $("tvTimer").textContent = socket?.connected ? "REMOTE: CONNECTED" : "REMOTE: WAITING";
    return;
  }

  $("tvClass").textContent = (q.cls || "CLASS") + " • " + (q.subject || "");
  $("tvChapter").textContent = "CHAPTER • " + (q.chapter || "GENERAL");
  $("tvCounter").textContent = "QUESTION " + String(index + 1).padStart(2, "0") + " / " + list.length;
  $("tvProgress").style.width = state.progress === false ? "0%" : ((index + 1) / list.length * 100) + "%";

  const language = state.language || "both";
  $("tvQuestion").textContent = language === "en" ? (q.en || q.hi || "") : (q.hi || q.en || "");
  $("tvQuestionEn").textContent = language === "both" ? (q.en || "") : "";

  const options = Array.isArray(q.opts)
    ? q.opts
    : Array.isArray(q.options)
      ? q.options
      : [q.A, q.B, q.C, q.D].filter(value => value != null);

  $("tvOptions").innerHTML = options.map((option, i) =>
    '<div class="tv-option ' + (state.showAnswer && i === Number(q.answer) ? "is-correct" : "") + '">' +
      '<b>' + "ABCD"[i] + '.</b><span>' + escHtml(option) + '</span>' +
      (state.showAnswer && i === Number(q.answer) ? '<strong class="correct-mark">✓</strong>' : "") +
    '</div>'
  ).join("");

  $("tvAnswer").classList.toggle("hidden", !state.showAnswer);
  $("tvAnswer").textContent = state.showAnswer
    ? "✓ सही उत्तर / Correct Answer: " + ("ABCD"[Number(q.answer)] || "—") +
      (options[Number(q.answer)] ? ". " + options[Number(q.answer)] : "") +
      (q.explain ? " — " + q.explain : "")
    : "";
  $("tvTimer").textContent = socket?.connected ? "REMOTE: CONNECTED" : "REMOTE: OFFLINE";
}

function sendState() {
  if (socket?.connected) socket.emit("class-state", { room, state });
  render();
}

function toggleFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen?.().catch(() => {});
  } else {
    document.exitFullscreen?.();
  }
}

$("tvFullscreen")?.addEventListener("click", toggleFullscreen);

function updateClock() {
  const element = $("tvClock");
  if (element) {
    element.textContent = new Intl.DateTimeFormat(undefined, {
      hour: "2-digit",
      minute: "2-digit"
    }).format(new Date());
  }
}
updateClock();
setInterval(updateClock, 30000);

function handleRemote(event) {
  const key = event.key;
  const code = event.keyCode || event.which;

  if (key === "f" || key === "F") {
    event.preventDefault();
    toggleFullscreen();
    return;
  }

  const list = Array.isArray(state.questions) ? state.questions : [];
  const left = key === "ArrowLeft" || code === 37;
  const right = key === "ArrowRight" || code === 39;
  const ok = key === "Enter" || key === " " || code === 13;
  const up = key === "ArrowUp" || code === 38;
  const down = key === "ArrowDown" || code === 40;

  if (!left && !right && !ok && !up && !down) return;
  event.preventDefault();
  event.stopPropagation();

  if (left) {
    state.index = Math.max(0, (Number(state.index) || 0) - 1);
    state.showAnswer = false;
  } else if (right) {
    state.index = Math.min(Math.max(0, list.length - 1), (Number(state.index) || 0) + 1);
    state.showAnswer = false;
  } else if (ok || up) {
    state.showAnswer = !state.showAnswer;
  } else {
    state.showAnswer = false;
  }
  sendState();
}

if (socket) {
  socket.on("connect", () => {
    socket.emit("join-room", room);
    $("tvTimer").textContent = "REMOTE: CONNECTED";
  });
  socket.on("class-state", nextState => {
    if (!nextState || typeof nextState !== "object") return;
    state = { ...state, ...nextState };
    render();
  });
  socket.on("disconnect", () => {
    $("tvTimer").textContent = "REMOTE: OFFLINE";
  });
}

document.addEventListener("keydown", handleRemote, true);
window.addEventListener("load", () => {
  document.body.focus();
  render();
});
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) document.body.focus();
});
render();
