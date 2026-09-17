import { Router } from 'express';
import * as repo from '../db/repo.js';
import { config } from '../config.js';
import { emitExamMonitorUpdate } from '../lib/realtime.js';

export const sessionsRouter = Router();

function now() {
  return new Date().toISOString();
}

function sanitizeQuestionForStudent(q, examMode) {
  return {
    id: q.id,
    order_index: q.order_index,
    type: q.type,
    prompt: examMode === 'paper_marking' ? '' : q.prompt,
    prompt_image_path: examMode === 'paper_marking' ? null : q.prompt_image_path,
    points: q.points,
    choices: q.choices.map((c) => ({ id: c.id, order_index: c.order_index, text: c.text })),
  };
}

// ---- 학생용: 시험 메타 (정답 정보 없음) ----

sessionsRouter.get('/:id/for-student', async (req, res) => {
  const exam = await repo.getExamFull(Number(req.params.id));
  if (!exam || exam.status !== 'finalized') {
    return res.status(404).json({ error: '응시할 수 있는 시험을 찾을 수 없습니다.' });
  }
  res.json({
    id: exam.id,
    title: exam.title,
    subject_id: exam.subject_id,
    grade_cluster: exam.grade_cluster,
    time_limit_sec: exam.time_limit_sec,
    mode: exam.mode,
    question_count: exam.questions.length,
  });
});

// ---- 세션 참가/조회 ----

sessionsRouter.post('/:id/sessions', async (req, res) => {
  const examId = Number(req.params.id);
  const exam = await repo.getExam(examId);
  if (!exam || exam.status !== 'finalized') {
    return res.status(400).json({ error: '응시할 수 있는 시험이 아닙니다.' });
  }

  const rollNumber = Number(req.body.roll_number);
  if (!Number.isInteger(rollNumber)) {
    return res.status(400).json({ error: '출석번호를 입력해주세요.' });
  }
  const student = await repo.getRosterEntry(rollNumber);
  if (!student) {
    return res.status(400).json({ error: '등록되지 않은 번호입니다.' });
  }

  let session = await repo.getSessionByExamAndRoll(examId, rollNumber);

  // 같은 번호로 이미 참여/응시 중인 세션이 있는데 또 참여하려는 경우 - 다른 기기가
  // 끼어들면 답 제출/이탈 경고가 뒤섞이므로 기본적으로 막는다. 원래 기기가 고장나서
  // 다른 기기로 이어가야 하는 등 정당한 상황엔 교사가 "실시간 감독"에서 재참여를 허용해줘야
  // 하고, 그러면 이번 한 번만 통과된다(allow_rejoin은 바로 소진).
  if (session && (session.status === 'joined' || session.status === 'in_progress')) {
    if (!session.allow_rejoin) {
      return res.status(409).json({
        error: '이미 이 번호로 참여 중인 기기가 있습니다. 다른 기기에서 이어서 하려면 선생님께 "재참여 허용"을 요청하세요.',
      });
    }
    await repo.setAllowRejoin(session.id, false);
  }

  if (!session) {
    session = await repo.createSession(examId, rollNumber);
    emitExamMonitorUpdate(examId);
  }

  // 교사가 이미 '시험 시작'을 눌러 시험이 진행 중이면, 뒤늦게 들어오는 학생도 대기
  // 화면 없이 바로 응시로 들어간다.
  if (exam.started_at && session.status === 'joined') {
    await repo.startSession(session.id);
    session = await repo.getSession(session.id);
    emitExamMonitorUpdate(examId);
  }

  res.status(201).json(session);
});

async function getSessionOr404(examId, sessionId, res) {
  const session = await repo.getSession(sessionId);
  if (!session || session.exam_id !== examId) {
    res.status(404).json({ error: '응시 세션을 찾을 수 없습니다.' });
    return undefined;
  }
  return session;
}

sessionsRouter.get('/:id/sessions/:sessionId', async (req, res) => {
  const examId = Number(req.params.id);
  const sessionId = Number(req.params.sessionId);
  const session = await getSessionOr404(examId, sessionId, res);
  if (!session) return;

  const payload = { ...session };
  if (session.status === 'submitted' || session.status === 'force_submitted') {
    payload.answers = await repo.getSessionAnswerSummary(sessionId);
  }
  res.json(payload);
});

// 교사가 '시험 감독' 화면에서 누른다. 대기 중(joined)인 학생 전원을 한 번에 응시로
// 전환하고, 이후 들어오는 학생도 곧장 응시로 들어가도록 exam.started_at을 남긴다.
sessionsRouter.post('/:id/start', async (req, res) => {
  const examId = Number(req.params.id);
  const exam = await repo.getExam(examId);
  if (!exam || exam.status !== 'finalized') {
    return res.status(400).json({ error: '확정된 시험만 시작할 수 있습니다.' });
  }

  await repo.markExamStarted(examId);
  const started = await repo.startAllJoinedSessions(examId);
  emitExamMonitorUpdate(examId);
  res.json({ started });
});

// 교사가 '시험 감독' 화면에서 누른다. 아직 대기/응시 중인 학생 전원을 지금까지 낸 답만으로
// 한 번에 강제 제출 처리해 시험을 완전히 끝낸다.
sessionsRouter.post('/:id/end-all', async (req, res) => {
  const examId = Number(req.params.id);
  const exam = await repo.getExam(examId);
  if (!exam) return res.status(404).json({ error: '시험을 찾을 수 없습니다.' });

  const ended = await repo.endAllActiveSessions(examId);
  emitExamMonitorUpdate(examId);
  res.json({ ended });
});

// 교사가 '시험 감독' 화면에서 누른다. "시험 전체 종료"로 한 번에 강제 제출됐던 학생
// 전원을 한 번에 다시 응시 중으로 되돌린다(실수로 눌렀거나, 사정을 봐서 계속 풀게
// 해주고 싶을 때). 스스로 제출을 마친(submitted) 학생은 대상에서 제외된다.
sessionsRouter.post('/:id/revive-all', async (req, res) => {
  const examId = Number(req.params.id);
  const exam = await repo.getExam(examId);
  if (!exam) return res.status(404).json({ error: '시험을 찾을 수 없습니다.' });

  const revived = await repo.reviveAllForceSubmittedSessions(examId);
  emitExamMonitorUpdate(examId);
  res.json({ revived });
});

function isTimedOut(session, exam) {
  if (!session.started_at) return false;
  const deadline =
    new Date(session.started_at).getTime() + (exam.time_limit_sec + (session.extra_time_sec ?? 0)) * 1000;
  return Date.now() > deadline;
}

// 1차 진행(순서대로 문항을 보여주는 단계)이 끝났을 때 호출한다. 건너뛴(응답 안 한) 문항이
// 남아 있으면 그것부터 마저 처리하게 하고, 하나도 없으면 그제서야 실제로 제출 확정한다.
async function finishForwardPassOrReview(examId, sessionId) {
  const pending = await repo.countPendingAnswers(sessionId);
  if (pending > 0) {
    emitExamMonitorUpdate(examId);
    return { done: false, reviewMode: true, pendingCount: pending };
  }
  await repo.finalizeSession(sessionId);
  emitExamMonitorUpdate(examId);
  return { done: true };
}

sessionsRouter.get('/:id/sessions/:sessionId/current-question', async (req, res) => {
  const examId = Number(req.params.id);
  const sessionId = Number(req.params.sessionId);
  const session = await getSessionOr404(examId, sessionId, res);
  if (!session) return;
  const exam = await repo.getExamFull(examId);

  if (session.status === 'submitted' || session.status === 'force_submitted') {
    return res.json({ done: true });
  }
  if (session.status !== 'in_progress') {
    return res.status(400).json({ error: '아직 시작하지 않은 세션입니다.' });
  }

  if (isTimedOut(session, exam)) {
    await repo.finalizeSession(sessionId);
    emitExamMonitorUpdate(examId);
    return res.json({ done: true, timedOut: true });
  }

  const question = exam.questions[session.current_question_index];
  if (!question) {
    return res.json(await finishForwardPassOrReview(examId, sessionId));
  }

  const existingAnswer = await repo.getAnswer(sessionId, question.id);
  if (!existingAnswer) {
    await repo.createAnswerShown(sessionId, question.id, now());
  }

  res.json({
    done: false,
    index: session.current_question_index,
    total: exam.questions.length,
    question: sanitizeQuestionForStudent(question, exam.mode),
  });
});

// 건너뛴(응답 안 하고 지나간) 문항들 - 1차 진행을 다 돌고 나서 다시 보여줄 목록.
sessionsRouter.get('/:id/sessions/:sessionId/pending-questions', async (req, res) => {
  const examId = Number(req.params.id);
  const sessionId = Number(req.params.sessionId);
  const session = await getSessionOr404(examId, sessionId, res);
  if (!session) return;
  const exam = await repo.getExamFull(examId);

  const pendingIds = await repo.getPendingQuestionIds(sessionId);
  const questions = pendingIds
    .map((qid) => exam.questions.find((q) => q.id === qid))
    .filter(Boolean)
    .map((q) => sanitizeQuestionForStudent(q, exam.mode));

  res.json({ questions });
});

sessionsRouter.post('/:id/sessions/:sessionId/answers', async (req, res) => {
  const examId = Number(req.params.id);
  const sessionId = Number(req.params.sessionId);
  const session = await getSessionOr404(examId, sessionId, res);
  if (!session) return;
  const exam = await repo.getExamFull(examId);

  if (session.status !== 'in_progress') {
    return res.status(400).json({ error: '응시 중인 세션이 아닙니다.' });
  }
  if (isTimedOut(session, exam)) {
    await repo.finalizeSession(sessionId);
    emitExamMonitorUpdate(examId);
    return res.json({ done: true, timedOut: true });
  }

  const questionId = Number(req.body.question_id);
  const question = exam.questions.find((q) => q.id === questionId);
  if (!question) {
    return res.status(400).json({ error: '문항을 찾을 수 없습니다.' });
  }

  const answerRow = await repo.getAnswer(sessionId, questionId);
  if (!answerRow || answerRow.answered_at) {
    return res.status(400).json({ error: '이미 응답한 문항입니다.' });
  }

  let isCorrect = 0;
  let selectedChoiceId = null;
  let shortAnswerText = null;

  if (question.type === 'mc') {
    selectedChoiceId = Number.isInteger(req.body.selected_choice_id)
      ? req.body.selected_choice_id
      : null;
    const choice = question.choices.find((c) => c.id === selectedChoiceId);
    isCorrect = choice?.is_correct ? 1 : 0;
  } else {
    shortAnswerText = typeof req.body.short_answer_text === 'string' ? req.body.short_answer_text : '';
    const normalize = (s) => s.trim().toLowerCase();
    const accepted = (question.correct_short_answers ?? []).map(normalize);
    isCorrect = accepted.includes(normalize(shortAnswerText)) ? 1 : 0;
  }

  const awardedPoints = isCorrect ? question.points : 0;
  const answeredAt = now();
  const timeSpentMs = Date.now() - new Date(answerRow.shown_at).getTime();

  await repo.submitAnswer(sessionId, questionId, {
    selectedChoiceId,
    shortAnswerText,
    answeredAt,
    timeSpentMs,
    isCorrect,
    awardedPoints,
  });

  // 지금 답한 문항이 1차 진행 중인 "현재" 문항이면 다음으로 넘어간다. 건너뛰었다가 복습
  // 화면에서 뒤늦게 답한 거라면(1차 진행은 이미 끝난 상태) 진행 위치는 그대로 둔다.
  const isInSequence = questionId === exam.questions[session.current_question_index]?.id;
  if (isInSequence) {
    const nextIndex = session.current_question_index + 1;
    await repo.advanceSession(sessionId, nextIndex);
    if (nextIndex >= exam.questions.length) {
      return res.json(await finishForwardPassOrReview(examId, sessionId));
    }
    emitExamMonitorUpdate(examId);
    return res.json({ done: false });
  }

  const pending = await repo.countPendingAnswers(sessionId);
  if (pending === 0) {
    await repo.finalizeSession(sessionId);
    emitExamMonitorUpdate(examId);
    return res.json({ done: true });
  }
  emitExamMonitorUpdate(examId);
  res.json({ done: false, reviewMode: true, pendingCount: pending });
});

// 지금 문항에 답하지 않고 건너뛴다 - 1차 진행 중인 "현재" 문항에만 쓸 수 있다(복습 화면에서
// 다시 보여준 문항은 답하거나 포기하거나 둘 중 하나만 가능).
sessionsRouter.post('/:id/sessions/:sessionId/skip', async (req, res) => {
  const examId = Number(req.params.id);
  const sessionId = Number(req.params.sessionId);
  const session = await getSessionOr404(examId, sessionId, res);
  if (!session) return;
  const exam = await repo.getExamFull(examId);

  if (session.status !== 'in_progress') {
    return res.status(400).json({ error: '응시 중인 세션이 아닙니다.' });
  }
  if (isTimedOut(session, exam)) {
    await repo.finalizeSession(sessionId);
    emitExamMonitorUpdate(examId);
    return res.json({ done: true, timedOut: true });
  }

  const question = exam.questions[session.current_question_index];
  const questionId = Number(req.body.question_id);
  if (!question || question.id !== questionId) {
    return res.status(400).json({ error: '현재 문항과 일치하지 않습니다.' });
  }

  const nextIndex = session.current_question_index + 1;
  await repo.advanceSession(sessionId, nextIndex);
  if (nextIndex >= exam.questions.length) {
    return res.json(await finishForwardPassOrReview(examId, sessionId));
  }
  emitExamMonitorUpdate(examId);
  res.json({ done: false });
});

// 복습 화면에서 건너뛴 문항을 "포기"로 마감 - 빈 답(오답 처리)으로 채점하고 목록에서 뺀다.
sessionsRouter.post('/:id/sessions/:sessionId/give-up', async (req, res) => {
  const examId = Number(req.params.id);
  const sessionId = Number(req.params.sessionId);
  const session = await getSessionOr404(examId, sessionId, res);
  if (!session) return;

  if (session.status !== 'in_progress') {
    return res.status(400).json({ error: '응시 중인 세션이 아닙니다.' });
  }

  const questionId = Number(req.body.question_id);
  const ok = await repo.giveUpAnswer(sessionId, questionId, now());
  if (!ok) {
    return res.status(400).json({ error: '포기할 수 없는 문항입니다.' });
  }

  const pending = await repo.countPendingAnswers(sessionId);
  if (pending === 0) {
    await repo.finalizeSession(sessionId);
    emitExamMonitorUpdate(examId);
    return res.json({ done: true });
  }
  emitExamMonitorUpdate(examId);
  res.json({ done: false, reviewMode: true, pendingCount: pending });
});

// 다른 화면으로 이탈(탭 전환, 창 최소화, 전체화면 해제)이 감지되면 그 즉시 강제 제출
// 처리한다 - 경고를 몇 번 봐주는 방식은 "나가서 답을 찾아보고 돌아오면 그만"인 허점이
// 있어 첫 이탈부터 바로 종료시킨다. 억울하게 종료된 경우엔 교사가 감독 화면에서
// "되살리기"로 이어서 풀게 해줄 수 있다.
sessionsRouter.post('/:id/sessions/:sessionId/warning', async (req, res) => {
  const examId = Number(req.params.id);
  const sessionId = Number(req.params.sessionId);
  const session = await getSessionOr404(examId, sessionId, res);
  if (!session) return;

  if (session.status !== 'in_progress') {
    return res.json({ disqualified: false });
  }

  const type = req.body.type === 'window_blur' ? 'window_blur' : 'visibility_hidden';
  const result = await repo.recordScreenLeave(sessionId, type, config.anticheatDebounceMs);
  emitExamMonitorUpdate(examId);
  res.json(result);
});

sessionsRouter.post('/:id/sessions/:sessionId/submit', async (req, res) => {
  const examId = Number(req.params.id);
  const sessionId = Number(req.params.sessionId);
  const session = await getSessionOr404(examId, sessionId, res);
  if (!session) return;

  await repo.finalizeSession(sessionId);
  emitExamMonitorUpdate(examId);
  res.json(await repo.getSession(sessionId));
});

// ---- 교사용: 시험 감독(실시간 모니터링) ----

sessionsRouter.get('/:id/monitor', async (req, res) => {
  const examId = Number(req.params.id);
  const exam = await repo.getExamFull(examId);
  if (!exam) return res.status(404).json({ error: '시험을 찾을 수 없습니다.' });

  const students = await repo.getMonitorStudents(examId);
  res.json({
    exam: {
      id: exam.id,
      title: exam.title,
      status: exam.status,
      question_count: exam.questions.length,
      time_limit_sec: exam.time_limit_sec,
      started_at: exam.started_at,
    },
    students,
  });
});

sessionsRouter.get('/:id/sessions/:sessionId/monitor', async (req, res) => {
  const examId = Number(req.params.id);
  const sessionId = Number(req.params.sessionId);
  const session = await getSessionOr404(examId, sessionId, res);
  if (!session) return;

  const exam = await repo.getExamFull(examId);
  const student = await repo.getRosterEntry(session.roll_number);
  const history = await repo.getSessionAnswerHistory(sessionId);

  let currentQuestion = null;
  if (session.status === 'in_progress') {
    const q = exam.questions[session.current_question_index];
    if (q) {
      currentQuestion = {
        index: session.current_question_index,
        total: exam.questions.length,
        type: q.type,
        prompt: q.prompt,
        prompt_image_path: q.prompt_image_path,
        choices: q.choices.map((c) => ({
          id: c.id,
          order_index: c.order_index,
          text: c.text,
          is_correct: c.is_correct,
        })),
      };
    }
  }

  res.json({
    session,
    student: student ? { roll_number: student.roll_number, name: student.name } : null,
    currentQuestion,
    history,
  });
});

// 교사가 응시 중(또는 아직 시작 전)인 학생의 시험을 강제로 끝낸다. 이미 끝난 세션은
// 다시 종료할 수 없으므로 상태를 먼저 확인한다.
sessionsRouter.post('/:id/sessions/:sessionId/force-submit', async (req, res) => {
  const examId = Number(req.params.id);
  const sessionId = Number(req.params.sessionId);
  const session = await getSessionOr404(examId, sessionId, res);
  if (!session) return;

  if (session.status !== 'joined' && session.status !== 'in_progress') {
    return res.status(400).json({ error: '이미 종료된 세션입니다.' });
  }

  await repo.finalizeSession(sessionId, 'force_submitted', 'teacher_manual');
  emitExamMonitorUpdate(examId);
  res.json(await repo.getSession(sessionId));
});

// 강제 종료(경고 누적 또는 교사가 직접 종료)된 학생을 다시 응시 중 상태로 되살린다 -
// 오탐(인터넷 끊김 등)으로 억울하게 종료됐거나, 사정을 봐서 계속 풀게 해주고 싶을 때 쓴다.
// 시간이 이미 다 지나있으면 되살려도 바로 다시 시간 초과로 제출돼버리므로, 지금 시각을
// 새 시작 시각으로 삼아 처음 시험 시간만큼 다시 준다(기존에 받은 추가시간은 그대로 유지).
// 경고 횟수도 0으로 초기화한다 - 안 그러면 이미 최대치라 조그만 이탈 한 번에 바로 재종료된다.
sessionsRouter.post('/:id/sessions/:sessionId/revive', async (req, res) => {
  const examId = Number(req.params.id);
  const sessionId = Number(req.params.sessionId);
  const session = await getSessionOr404(examId, sessionId, res);
  if (!session) return;

  if (session.status !== 'force_submitted') {
    return res.status(400).json({ error: '강제 종료된 세션만 되살릴 수 있습니다.' });
  }

  await repo.reviveSession(sessionId);
  emitExamMonitorUpdate(examId);
  res.json(await repo.getSession(sessionId));
});

// 교사가 시험 감독 화면에서 특정 학생에게만 시간을 더 준다(+1/+5/+10분 등). 이미 끝난
// 세션은 더 줘도 의미가 없으므로 응시 중일 때만 허용한다.
sessionsRouter.post('/:id/sessions/:sessionId/extend-time', async (req, res) => {
  const examId = Number(req.params.id);
  const sessionId = Number(req.params.sessionId);
  const session = await getSessionOr404(examId, sessionId, res);
  if (!session) return;

  if (session.status !== 'in_progress') {
    return res.status(400).json({ error: '응시 중인 학생에게만 시간을 추가할 수 있습니다.' });
  }
  const seconds = Number(req.body.seconds);
  if (!Number.isInteger(seconds) || seconds === 0) {
    return res.status(400).json({ error: 'seconds가 필요합니다.' });
  }

  const updated = await repo.addExtraTime(sessionId, seconds);
  emitExamMonitorUpdate(examId);
  res.json(updated);
});

// 같은 번호로 다른 기기가 참여를 시도했다가 막힌 경우(위 join 라우트 참고), 교사가
// "실시간 감독"에서 이 버튼을 눌러 다음 참여 시도 한 번만 통과시켜준다 - 학생 기기가
// 고장나서 다른 기기로 이어가야 하는 등 정당한 상황을 위한 예외 통로.
sessionsRouter.post('/:id/sessions/:sessionId/allow-rejoin', async (req, res) => {
  const examId = Number(req.params.id);
  const sessionId = Number(req.params.sessionId);
  const session = await getSessionOr404(examId, sessionId, res);
  if (!session) return;

  await repo.setAllowRejoin(sessionId, true);
  emitExamMonitorUpdate(examId);
  res.json(await repo.getSession(sessionId));
});

// ---- 교사용 결과 집계 ----

sessionsRouter.get('/:id/results', async (req, res) => {
  const examId = Number(req.params.id);
  const exam = await repo.getExamFull(examId);
  if (!exam) return res.status(404).json({ error: '시험을 찾을 수 없습니다.' });

  const { sessions, questionStats } = await repo.getResultsForExam(examId);

  attachOutliers(sessions);

  const slowestQuestions = [...questionStats]
    .filter((q) => q.avg_time_spent_ms != null)
    .sort((a, b) => b.avg_time_spent_ms - a.avg_time_spent_ms)
    .slice(0, 3);
  const lowestAccuracyQuestions = [...questionStats]
    .filter((q) => q.answered_count > 0)
    .sort((a, b) => a.correct_count / a.answered_count - b.correct_count / b.answered_count)
    .slice(0, 3);

  const standardsAccuracy = await repo.computeStandardsAccuracy({ examId });

  res.json({ sessions, questionStats, slowestQuestions, lowestAccuracyQuestions, standardsAccuracy });
});

// 문항별 정답률에서 문항 번호를 누르면 보여주는 학생별 소요시간/정답 여부 상세.
sessionsRouter.get('/:id/questions/:qid/breakdown', async (req, res) => {
  const examId = Number(req.params.id);
  const qid = Number(req.params.qid);
  const question = await repo.getQuestion(examId, qid);
  if (!question) return res.status(404).json({ error: '문항을 찾을 수 없습니다.' });

  const rows = await repo.getQuestionStudentBreakdown(qid);
  const times = rows.map((r) => r.time_spent_ms).filter((t) => t != null);
  const avgTimeMs = times.length > 0 ? times.reduce((a, b) => a + b, 0) / times.length : null;

  res.json({ avgTimeMs, students: rows });
});

// 정답률/총 소요시간이 학급 평균에서 크게 벗어난 학생을 표시한다.
// 표본이 너무 적으면(4명 미만) 평균/표준편차가 의미 없으므로 계산을 건너뛴다.
function attachOutliers(sessions) {
  const submitted = sessions.filter((s) => s.status === 'submitted');
  sessions.forEach((s) => {
    s.isOutlier = false;
    s.outlierReasons = [];
  });
  if (submitted.length < 4) return;

  const scorePct = (s) => (s.max_score ? s.score / s.max_score : 0);
  const mean = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
  const stddev = (arr, m) => Math.sqrt(arr.reduce((a, b) => a + (b - m) ** 2, 0) / arr.length);

  const scores = submitted.map(scorePct);
  const times = submitted.map((s) => s.total_time_ms);
  const scoreMean = mean(scores);
  const scoreSd = stddev(scores, scoreMean);
  const timeMean = mean(times);
  const timeSd = stddev(times, timeMean);

  submitted.forEach((s) => {
    const reasons = [];
    if (scoreSd > 0 && scorePct(s) < scoreMean - 1.5 * scoreSd) reasons.push('정답률이 낮음');
    if (timeSd > 0 && s.total_time_ms > timeMean + 1.5 * timeSd) reasons.push('소요시간이 김');
    if (timeSd > 0 && s.total_time_ms < timeMean - 1.5 * timeSd) reasons.push('소요시간이 짧음');
    if (reasons.length > 0) {
      s.isOutlier = true;
      s.outlierReasons = reasons;
    }
  });
}
