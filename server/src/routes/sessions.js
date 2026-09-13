import { Router } from 'express';
import * as repo from '../db/repo.js';
import { config } from '../config.js';

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
  if (!session) {
    session = await repo.createSession(examId, rollNumber);
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

sessionsRouter.post('/:id/sessions/:sessionId/start', async (req, res) => {
  const examId = Number(req.params.id);
  const sessionId = Number(req.params.sessionId);
  const session = await getSessionOr404(examId, sessionId, res);
  if (!session) return;

  if (session.status !== 'joined') {
    return res.json(session);
  }
  await repo.startSession(sessionId);
  res.json(await repo.getSession(sessionId));
});

function isTimedOut(session, exam) {
  if (!session.started_at) return false;
  const deadline = new Date(session.started_at).getTime() + exam.time_limit_sec * 1000;
  return Date.now() > deadline;
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
    return res.json({ done: true, timedOut: true });
  }

  const question = exam.questions[session.current_question_index];
  if (!question) {
    await repo.finalizeSession(sessionId);
    return res.json({ done: true });
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
    return res.json({ done: true, timedOut: true });
  }

  const question = exam.questions[session.current_question_index];
  const questionId = Number(req.body.question_id);
  if (!question || question.id !== questionId) {
    return res.status(400).json({ error: '현재 문항과 일치하지 않습니다.' });
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

  const nextIndex = session.current_question_index + 1;
  await repo.advanceSession(sessionId, nextIndex);

  if (nextIndex >= exam.questions.length) {
    await repo.finalizeSession(sessionId);
    return res.json({ done: true });
  }
  res.json({ done: false });
});

sessionsRouter.post('/:id/sessions/:sessionId/warning', async (req, res) => {
  const examId = Number(req.params.id);
  const sessionId = Number(req.params.sessionId);
  const session = await getSessionOr404(examId, sessionId, res);
  if (!session) return;

  if (session.status !== 'in_progress') {
    return res.json({
      warning_count: session.warning_count,
      counted: false,
      disqualified: false,
      max_warnings: config.anticheatMaxWarnings,
    });
  }

  const type = req.body.type === 'window_blur' ? 'window_blur' : 'visibility_hidden';
  const result = await repo.recordWarning(sessionId, type, config.anticheatDebounceMs, config.anticheatMaxWarnings);
  res.json({ ...result, max_warnings: config.anticheatMaxWarnings });
});

sessionsRouter.post('/:id/sessions/:sessionId/submit', async (req, res) => {
  const examId = Number(req.params.id);
  const sessionId = Number(req.params.sessionId);
  const session = await getSessionOr404(examId, sessionId, res);
  if (!session) return;

  await repo.finalizeSession(sessionId);
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
