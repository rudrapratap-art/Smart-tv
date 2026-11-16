function toDisplayState(state) {
  const safe = { ...state };
  const questions = Array.isArray(state?.questions) ? state.questions : [];
  const visibleIndex = Number.isInteger(Number(state?.index)) ? Number(state.index) : 0;
  safe.questions = questions.map((question, index) => {
    if (state?.showAnswer && index === visibleIndex) return { ...question };
    const { answer, explain, explanation, ...publicQuestion } = question || {};
    return publicQuestion;
  });
  return safe;
}

async function broadcastClassroomState(io, room, state) {
  io.to(room).emit("class-state", toDisplayState(state));
  const sockets = await io.in(room).fetchSockets();
  for (const socket of sockets) {
    if (socket.data?.isAdmin) socket.emit("admin-class-state", state);
  }
}

module.exports = { toDisplayState, broadcastClassroomState };
