// Socket.IO 인스턴스를 라우트 파일에서도 쓸 수 있게 보관하는 아주 얇은 레이어.
// index.js에서 setIO()로 등록하고, 세션 상태가 바뀌는 라우트(sessions.js)에서
// emitExamMonitorUpdate()를 불러 '시험 감독' 화면에 실시간으로 반영한다.
let ioInstance = null;

export function setIO(io) {
  ioInstance = io;
}

export function monitorRoom(examId) {
  return `monitor:${examId}`;
}

export function emitExamMonitorUpdate(examId) {
  if (!ioInstance) return;
  ioInstance.to(monitorRoom(examId)).emit('monitor:update', { examId });
}
