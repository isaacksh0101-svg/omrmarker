import { Router } from 'express';
import { db } from '../db/index.js';
import { getExamRow, getExamFull } from './exams.js';
import { getStandardByCode } from '../services/curriculumStandards.js';

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

export function finalizeSession(sessionId) {
  const session = db.prepare('SELECT * FROM exam_sessions WHERE id = ?').get(sessionId);
  if (!session || session.status === 'submitted') return;

  const totals = db
    .prepare(
      `SELECT
         COALESCE(SUM(a.awarded_points), 0) AS score,
         COALESCE((SELECT SUM(points) FROM questions WHERE exam_id = ?), 0) AS max_score
       FROM answers a
       WHERE a.session_id = ?`,
    )
    .get(session.exam_id, sessionId);

  db.prepare(
    "UPDATE exam_sessions SET status = 'submitted', submitted_at = ?, score = ?, max_score = ? WHERE id = ?",
  ).run(now(), totals.score, totals.max_score, sessionId);
}

export function computeStandardsAccuracy({ examId, rollNumber, from, to } = {}) {
  const conditions = ["es.status = 'submitted'", 'a.answered_at IS NOT NULL'];
  const params = [];
  if (examId) {
    conditions.push('q.exam_id = ?');
    params.push(examId);
  }
  if (rollNumber) {
    conditions.push('es.roll_number = ?');
    params.push(rollNumber);
  }
  if (from) {
    conditions.push('date(es.submitted_at) >= date(?)');
    params.push(from);
  }
  if (to) {
    conditions.push('date(es.submitted_at) <= date(?)');
    params.push(to);
  }

  const rows = db
    .prepare(
      `SELECT qs.standard_code AS code,
              COUNT(*) AS attempted_count,
              COALESCE(SUM(a.is_correct), 0) AS correct_count
       FROM answers a
       JOIN questions q ON q.id = a.question_id
       JOIN question_standards qs ON qs.question_id = q.id
       JOIN exam_sessions es ON es.id = a.session_id
       WHERE ${conditions.join(' AND ')}
       GROUP BY qs.standard_code`,
    )
    .all(...params);

  return rows
    .map((r) => {
      const std = getStandardByCode(r.code);
      if (!std) return null;
      return {
        code: r.code,
        statement: std.statement,
        subject_id: std.subject_id,
        subject_name: std.subject_name,
        grade_cluster: std.grade_cluster,
        attempted_count: r.attempted_count,
        correct_count: r.correct_count,
        accuracy: r.attempted_count > 0 ? r.correct_count / r.attempted_count : 0,
      };
    })
    .filter(Boolean);
}

// ---- 학생용: 시험 메타 (정답 정보 없음) ----

sessionsRouter.get('/:id/for-student', (req, res) => {
  const exam = getExamRow(Number(req.params.id));
  if (!exam || exam.status !== 'finalized') {
    return res.status(404).json({ error: '응시할 수 있는 시험을 찾을 수 없습니다.' });
  }
  const { count } = db
    .prepare('SELECT COUNT(*) AS count FROM questions WHERE exam_id = ?')
    .get(exam.id);
  res.json({
    id: exam.id,
    title: exam.title,
    subject_id: exam.subject_id,
    grade_cluster: exam.grade_cluster,
    time_limit_sec: exam.time_limit_sec,
    mode: exam.mode,
    question_count: count,
  });
});

// ---- 세션 참가/조회 ----

sessionsRouter.post('/:id/sessions', (req, res) => {
  const examId = Number(req.params.id);
  const exam = getExamRow(examId);
  if (!exam || exam.status !== 'finalized') {
    return res.status(400).json({ error: '응시할 수 있는 시험이 아닙니다.' });
  }

  const rollNumber = Number(req.body.roll_number);
  if (!Number.isInteger(rollNumber)) {
    return res.status(400).json({ error: '출석번호를 입력해주세요.' });
  }
  const student = db.prepare('SELECT * FROM roster WHERE roll_number = ?').get(rollNumber);
  if (!student) {
    return res.status(400).json({ error: '등록되지 않은 번호입니다.' });
  }

  let session = db
    .prepare('SELECT * FROM exam_sessions WHERE exam_id = ? AND roll_number = ?')
    .get(examId, rollNumber);

  if (!session) {
    const result = db
      .prepare('INSERT INTO exam_sessions (exam_id, roll_number, status) VALUES (?, ?, ?)')
      .run(examId, rollNumber, 'joined');
    session = db.prepare('SELECT * FROM exam_sessions WHERE id = ?').get(result.lastInsertRowid);
  }

  res.status(201).json(session);
});

function getSessionOr404(examId, sessionId, res) {
  const session = db
    .prepare('SELECT * FROM exam_sessions WHERE id = ? AND exam_id = ?')
    .get(sessionId, examId);
  if (!session) res.status(404).json({ error: '응시 세션을 찾을 수 없습니다.' });
  return session;
}

sessionsRouter.get('/:id/sessions/:sessionId', (req, res) => {
  const examId = Number(req.params.id);
  const sessionId = Number(req.params.sessionId);
  const session = getSessionOr404(examId, sessionId, res);
  if (!session) return;

  const payload = { ...session };
  if (session.status === 'submitted') {
    payload.answers = db
      .prepare(
        `SELECT q.order_index, a.is_correct, a.awarded_points
         FROM answers a
         JOIN questions q ON q.id = a.question_id
         WHERE a.session_id = ?
         ORDER BY q.order_index`,
      )
      .all(sessionId);
  }
  res.json(payload);
});

sessionsRouter.post('/:id/sessions/:sessionId/start', (req, res) => {
  const examId = Number(req.params.id);
  const sessionId = Number(req.params.sessionId);
  const session = getSessionOr404(examId, sessionId, res);
  if (!session) return;

  if (session.status !== 'joined') {
    return res.json(session);
  }
  db.prepare("UPDATE exam_sessions SET status = 'in_progress', started_at = ? WHERE id = ?").run(
    now(),
    sessionId,
  );
  res.json(db.prepare('SELECT * FROM exam_sessions WHERE id = ?').get(sessionId));
});

function isTimedOut(session, exam) {
  if (!session.started_at) return false;
  const deadline = new Date(session.started_at).getTime() + exam.time_limit_sec * 1000;
  return Date.now() > deadline;
}

sessionsRouter.get('/:id/sessions/:sessionId/current-question', (req, res) => {
  const examId = Number(req.params.id);
  const sessionId = Number(req.params.sessionId);
  const session = getSessionOr404(examId, sessionId, res);
  if (!session) return;
  const exam = getExamFull(examId);

  if (session.status === 'submitted') {
    return res.json({ done: true });
  }
  if (session.status !== 'in_progress') {
    return res.status(400).json({ error: '아직 시작하지 않은 세션입니다.' });
  }

  if (isTimedOut(session, exam)) {
    finalizeSession(sessionId);
    return res.json({ done: true, timedOut: true });
  }

  const question = exam.questions[session.current_question_index];
  if (!question) {
    finalizeSession(sessionId);
    return res.json({ done: true });
  }

  const existingAnswer = db
    .prepare('SELECT * FROM answers WHERE session_id = ? AND question_id = ?')
    .get(sessionId, question.id);
  if (!existingAnswer) {
    db.prepare(
      'INSERT INTO answers (session_id, question_id, shown_at) VALUES (?, ?, ?)',
    ).run(sessionId, question.id, now());
  }

  res.json({
    done: false,
    index: session.current_question_index,
    total: exam.questions.length,
    question: sanitizeQuestionForStudent(question, exam.mode),
  });
});

sessionsRouter.post('/:id/sessions/:sessionId/answers', (req, res) => {
  const examId = Number(req.params.id);
  const sessionId = Number(req.params.sessionId);
  const session = getSessionOr404(examId, sessionId, res);
  if (!session) return;
  const exam = getExamFull(examId);

  if (session.status !== 'in_progress') {
    return res.status(400).json({ error: '응시 중인 세션이 아닙니다.' });
  }
  if (isTimedOut(session, exam)) {
    finalizeSession(sessionId);
    return res.json({ done: true, timedOut: true });
  }

  const question = exam.questions[session.current_question_index];
  const questionId = Number(req.body.question_id);
  if (!question || question.id !== questionId) {
    return res.status(400).json({ error: '현재 문항과 일치하지 않습니다.' });
  }

  const answerRow = db
    .prepare('SELECT * FROM answers WHERE session_id = ? AND question_id = ?')
    .get(sessionId, questionId);
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

  db.prepare(
    `UPDATE answers
     SET selected_choice_id = ?, short_answer_text = ?, answered_at = ?, time_spent_ms = ?,
         is_correct = ?, awarded_points = ?
     WHERE id = ?`,
  ).run(selectedChoiceId, shortAnswerText, answeredAt, timeSpentMs, isCorrect, awardedPoints, answerRow.id);

  const nextIndex = session.current_question_index + 1;
  db.prepare('UPDATE exam_sessions SET current_question_index = ? WHERE id = ?').run(
    nextIndex,
    sessionId,
  );

  if (nextIndex >= exam.questions.length) {
    finalizeSession(sessionId);
    return res.json({ done: true });
  }
  res.json({ done: false });
});

sessionsRouter.post('/:id/sessions/:sessionId/submit', (req, res) => {
  const examId = Number(req.params.id);
  const sessionId = Number(req.params.sessionId);
  const session = getSessionOr404(examId, sessionId, res);
  if (!session) return;

  finalizeSession(sessionId);
  res.json(db.prepare('SELECT * FROM exam_sessions WHERE id = ?').get(sessionId));
});

// ---- 교사용 결과 집계 ----

sessionsRouter.get('/:id/results', (req, res) => {
  const examId = Number(req.params.id);
  const exam = getExamFull(examId);
  if (!exam) return res.status(404).json({ error: '시험을 찾을 수 없습니다.' });

  const sessions = db
    .prepare(
      `SELECT es.roll_number, r.name, es.status, es.score, es.max_score, es.submitted_at,
              (SELECT COALESCE(SUM(a.time_spent_ms), 0) FROM answers a WHERE a.session_id = es.id) AS total_time_ms
       FROM exam_sessions es
       LEFT JOIN roster r ON r.roll_number = es.roll_number
       WHERE es.exam_id = ?
       ORDER BY es.roll_number`,
    )
    .all(examId);

  attachOutliers(sessions);

  const questionStats = exam.questions.map((q) => {
    const stat = db
      .prepare(
        `SELECT COUNT(*) AS answered_count,
                COALESCE(SUM(is_correct), 0) AS correct_count,
                AVG(time_spent_ms) AS avg_time_spent_ms
         FROM answers
         WHERE question_id = ? AND answered_at IS NOT NULL`,
      )
      .get(q.id);
    return {
      question_id: q.id,
      order_index: q.order_index,
      prompt: q.prompt,
      answered_count: stat.answered_count,
      correct_count: stat.correct_count,
      avg_time_spent_ms: stat.avg_time_spent_ms ?? null,
    };
  });

  const slowestQuestions = [...questionStats]
    .filter((q) => q.avg_time_spent_ms != null)
    .sort((a, b) => b.avg_time_spent_ms - a.avg_time_spent_ms)
    .slice(0, 3);
  const lowestAccuracyQuestions = [...questionStats]
    .filter((q) => q.answered_count > 0)
    .sort((a, b) => a.correct_count / a.answered_count - b.correct_count / b.answered_count)
    .slice(0, 3);

  const standardsAccuracy = computeStandardsAccuracy({ examId });

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
