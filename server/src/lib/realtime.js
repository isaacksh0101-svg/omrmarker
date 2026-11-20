// Socket.IO 인스턴스를 라우트 파일에서도 쓸 수 있게 보관하는 아주 얇은 레이어.
// index.js에서 setIO()로 등록하고, 세션 상태가 바뀌는 라우트(sessions.js)에서
// emitExamMonitorUpdate()를 불러 '시험 감독' 화면에 실시간으로 반영한다.
import { scheduleMathLedgerExport } from '../services/mathStandardsLedger.js';

let ioInstance = null;

export function setIO(io) {
  ioInstance = io;
}

export function monitorRoom(examId) {
  return `monitor:${examId}`;
}

// 시험 결과가 바뀌는 모든 곳(제출, 시험 종료, 교사 채점, 문항 정정 등)이 이 함수를 부르므로,
// 수학 누적 성적 엑셀도 여기서 다시 저장을 예약한다(수학 시험일 때만, 몇 초 모아서 한 번).
export function emitExamMonitorUpdate(examId) {
  scheduleMathLedgerExport(examId);
  if (!ioInstance) return;
  ioInstance.to(monitorRoom(examId)).emit('monitor:update', { examId });
}
