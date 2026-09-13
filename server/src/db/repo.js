// 데이터 접근 계층. 라우트 파일은 SQL을 직접 안 쓰고 여기 있는 이름 붙은 함수만 부른다.
import { db } from './index.js';
import { getStandardByCode } from '../services/curriculumStandards.js';

function now() {
  return new Date().toISOString();
}

// 원문자(①②③...)는 폰트/환경에 따라 깨져 보이는 경우가 있어 그냥 숫자를 쓴다.
const CHOICE_DIGITS = ['1', '2', '3', '4', '5', '6'];

// ---- exams ----

export async function getExam(id) {
  return db.prepare('SELECT * FROM exams WHERE id = ?').get(id);
}

export async function getExamFull(id) {
  const exam = await getExam(id);
  if (!exam) return null;

  const rows = await db.prepare('SELECT * FROM questions WHERE exam_id = ? ORDER BY order_index').all(id);
  const questions = await Promise.all(
    rows.map(async (q) => {
      const choiceRows = await db.prepare('SELECT * FROM choices WHERE question_id = ? ORDER BY order_index').all(q.id);
      const choices = choiceRows.map((c) => ({ ...c, is_correct: !!c.is_correct }));
      const standardRows = await db
        .prepare('SELECT standard_code, statement_snapshot, is_ai_suggested, confidence FROM question_standards WHERE question_id = ?')
        .all(q.id);
      const standards = standardRows.map((s) => ({ ...s, is_ai_suggested: !!s.is_ai_suggested }));
      return {
        ...q,
        ai_suggested: !!q.ai_suggested,
        correct_short_answers: q.correct_short_answers ? JSON.parse(q.correct_short_answers) : null,
        choices,
        standards,
      };
    }),
  );

  return { ...exam, questions };
}

export async function listExams() {
  return db
    .prepare('SELECT id, title, subject_id, grade_cluster, time_limit_sec, mode, status, started_at, created_at FROM exams ORDER BY created_at DESC')
    .all();
}

export async function createExam({ title, subject_id, grade_cluster, time_limit_sec, mode }) {
  const result = await db
    .prepare(
      'INSERT INTO exams (title, subject_id, grade_cluster, time_limit_sec, mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .run(title, subject_id, grade_cluster, time_limit_sec, mode, now(), now());
  return result.lastInsertRowid;
}

export async function updateExam(id, { title, subject_id, grade_cluster, time_limit_sec, mode }) {
  await db
    .prepare(
      'UPDATE exams SET title = ?, subject_id = ?, grade_cluster = ?, time_limit_sec = ?, mode = ?, updated_at = ? WHERE id = ?',
    )
    .run(title, subject_id, grade_cluster, time_limit_sec, mode, now(), id);
}

export async function deleteExam(id) {
  await db.prepare('DELETE FROM exams WHERE id = ?').run(id);
}

export async function finalizeExam(id) {
  await db.prepare("UPDATE exams SET status = 'finalized', updated_at = ? WHERE id = ?").run(now(), id);
}

// ---- questions ----

export async function addQuestion(examId, { type, prompt, points }) {
  const { maxOrder } = await db
    .prepare('SELECT COALESCE(MAX(order_index), -1) AS maxOrder FROM questions WHERE exam_id = ?')
    .get(examId);

  const result = await db
    .prepare(
      'INSERT INTO questions (exam_id, order_index, type, prompt, points, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .run(examId, maxOrder + 1, type, prompt ?? '', points ?? 1, now(), now());
  return result.lastInsertRowid;
}

export async function batchCreateQuestions(examId, { mc4, mc5, short }) {
  const { maxOrder } = await db
    .prepare('SELECT COALESCE(MAX(order_index), -1) AS maxOrder FROM questions WHERE exam_id = ?')
    .get(examId);

  const insertQuestion = db.prepare(
    "INSERT INTO questions (exam_id, order_index, type, prompt, points, created_at, updated_at) VALUES (?, ?, 'mc', '', 1, ?, ?)",
  );
  const insertShortQuestion = db.prepare(
    "INSERT INTO questions (exam_id, order_index, type, prompt, points, created_at, updated_at) VALUES (?, ?, 'short', '', 1, ?, ?)",
  );
  const insertChoice = db.prepare(
    'INSERT INTO choices (question_id, order_index, text, is_correct) VALUES (?, ?, ?, 0)',
  );

  let order = maxOrder + 1;
  for (let i = 0; i < mc4; i++, order++) {
    const { lastInsertRowid } = await insertQuestion.run(examId, order, now(), now());
    for (const [ci, label] of CHOICE_DIGITS.slice(0, 4).entries()) {
      await insertChoice.run(lastInsertRowid, ci, label);
    }
  }
  for (let i = 0; i < mc5; i++, order++) {
    const { lastInsertRowid } = await insertQuestion.run(examId, order, now(), now());
    for (const [ci, label] of CHOICE_DIGITS.slice(0, 5).entries()) {
      await insertChoice.run(lastInsertRowid, ci, label);
    }
  }
  for (let i = 0; i < short; i++, order++) {
    await insertShortQuestion.run(examId, order, now(), now());
  }
}

export async function reorderQuestions(examId, order) {
  const update = db.prepare('UPDATE questions SET order_index = ? WHERE id = ?');
  for (const [i, id] of order.entries()) {
    await update.run(i, id);
  }
}

export async function getQuestionIds(examId) {
  const rows = await db.prepare('SELECT id FROM questions WHERE exam_id = ?').all(examId);
  return rows.map((q) => q.id);
}

export async function getQuestion(examId, questionId) {
  return db.prepare('SELECT * FROM questions WHERE id = ? AND exam_id = ?').get(questionId, examId);
}

export async function updateQuestion(examId, qid, { prompt, points, type }) {
  await db.prepare('UPDATE questions SET prompt = ?, points = ?, type = ?, updated_at = ? WHERE id = ?').run(
    prompt,
    points,
    type,
    now(),
    qid,
  );
}

export async function deleteQuestion(examId, qid) {
  await db.prepare('DELETE FROM questions WHERE id = ? AND exam_id = ?').run(qid, examId);

  // order_index 재정렬 (구멍 없이 유지)
  const remaining = await db
    .prepare('SELECT id FROM questions WHERE exam_id = ? ORDER BY order_index')
    .all(examId);
  for (const [i, q] of remaining.entries()) {
    await db.prepare('UPDATE questions SET order_index = ? WHERE id = ?').run(i, q.id);
  }
}

export async function setChoices(qid, choices) {
  await db.prepare('DELETE FROM choices WHERE question_id = ?').run(qid);
  const insert = db.prepare(
    'INSERT INTO choices (question_id, order_index, text, is_correct) VALUES (?, ?, ?, ?)',
  );
  for (const [i, c] of choices.entries()) {
    await insert.run(qid, i, c.text, c.is_correct ? 1 : 0);
  }
}

export async function setShortAnswer(qid, correctShortAnswers) {
  await db.prepare('UPDATE questions SET correct_short_answers = ?, updated_at = ? WHERE id = ?').run(
    JSON.stringify(correctShortAnswers),
    now(),
    qid,
  );
}

export async function setStandards(qid, codes) {
  await db.prepare('DELETE FROM question_standards WHERE question_id = ?').run(qid);
  const insert = db.prepare(
    'INSERT INTO question_standards (question_id, standard_code, statement_snapshot, is_ai_suggested, confidence) VALUES (?, ?, ?, 0, NULL)',
  );
  for (const code of codes) {
    const std = getStandardByCode(code);
    await insert.run(qid, code, std.statement);
  }
}

// AI 추출 결과를 한 번에 문항/보기/성취기준으로 저장한다(ai.js 전용).
export async function addExtractedQuestions(examId, extractedQuestions) {
  const { maxOrder } = await db
    .prepare('SELECT COALESCE(MAX(order_index), -1) AS maxOrder FROM questions WHERE exam_id = ?')
    .get(examId);

  const insertQuestion = db.prepare(
    'INSERT INTO questions (exam_id, order_index, type, prompt, points, ai_suggested, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 1, ?, ?)',
  );
  const insertChoice = db.prepare(
    'INSERT INTO choices (question_id, order_index, text, is_correct) VALUES (?, ?, ?, 0)',
  );
  const insertStandard = db.prepare(
    'INSERT INTO question_standards (question_id, standard_code, statement_snapshot, is_ai_suggested, confidence) VALUES (?, ?, ?, 1, ?)',
  );

  for (const [i, q] of extractedQuestions.entries()) {
    const result = await insertQuestion.run(examId, maxOrder + 1 + i, q.type, q.prompt, now(), now());
    const questionId = result.lastInsertRowid;

    if (q.type === 'mc') {
      for (const [ci, c] of q.choices.entries()) {
        await insertChoice.run(questionId, ci, c.text);
      }
    }

    for (const s of q.suggested_standards) {
      const std = getStandardByCode(s.code);
      if (!std) continue; // 서비스 계층에서 이미 걸러지지만 한 번 더 방어
      await insertStandard.run(questionId, s.code, std.statement, s.confidence ?? null);
    }
  }
}

// ---- roster ----

export async function listRoster() {
  return db.prepare('SELECT * FROM roster ORDER BY roll_number').all();
}

export async function getRosterEntry(rollNumber) {
  return db.prepare('SELECT * FROM roster WHERE roll_number = ?').get(rollNumber);
}

export async function upsertRosterEntry(rollNumber, name) {
  await db
    .prepare(
      'INSERT INTO roster (roll_number, name) VALUES (?, ?) ' +
        'ON CONFLICT(roll_number) DO UPDATE SET name = excluded.name',
    )
    .run(rollNumber, name ?? null);
}

export async function deleteRosterEntry(rollNumber) {
  await db.prepare('DELETE FROM roster WHERE roll_number = ?').run(rollNumber);
}

// ---- sessions ----

export async function getSession(sessionId) {
  return db.prepare('SELECT * FROM exam_sessions WHERE id = ?').get(sessionId);
}

export async function getSessionByExamAndRoll(examId, rollNumber) {
  return db.prepare('SELECT * FROM exam_sessions WHERE exam_id = ? AND roll_number = ?').get(examId, rollNumber);
}

export async function createSession(examId, rollNumber) {
  const result = await db
    .prepare('INSERT INTO exam_sessions (exam_id, roll_number, status) VALUES (?, ?, ?)')
    .run(examId, rollNumber, 'joined');
  return getSession(result.lastInsertRowid);
}

export async function startSession(sessionId) {
  await db
    .prepare("UPDATE exam_sessions SET status = 'in_progress', started_at = ? WHERE id = ?")
    .run(now(), sessionId);
}

export async function getSessionAnswerSummary(sessionId) {
  return db
    .prepare(
      `SELECT q.order_index, a.is_correct, a.awarded_points
       FROM answers a
       JOIN questions q ON q.id = a.question_id
       WHERE a.session_id = ?
       ORDER BY q.order_index`,
    )
    .all(sessionId);
}

export async function getAnswer(sessionId, questionId) {
  return db.prepare('SELECT * FROM answers WHERE session_id = ? AND question_id = ?').get(sessionId, questionId);
}

export async function createAnswerShown(sessionId, questionId, shownAt) {
  await db
    .prepare('INSERT INTO answers (session_id, question_id, shown_at) VALUES (?, ?, ?)')
    .run(sessionId, questionId, shownAt);
}

export async function submitAnswer(sessionId, questionId, { selectedChoiceId, shortAnswerText, answeredAt, timeSpentMs, isCorrect, awardedPoints }) {
  await db
    .prepare(
      `UPDATE answers
       SET selected_choice_id = ?, short_answer_text = ?, answered_at = ?, time_spent_ms = ?,
           is_correct = ?, awarded_points = ?
       WHERE session_id = ? AND question_id = ?`,
    )
    .run(selectedChoiceId, shortAnswerText, answeredAt, timeSpentMs, isCorrect, awardedPoints, sessionId, questionId);
}

export async function advanceSession(sessionId, nextIndex) {
  await db.prepare('UPDATE exam_sessions SET current_question_index = ? WHERE id = ?').run(nextIndex, sessionId);
}

// 화면 이탈/포커스 아웃 이벤트를 기록한다. 짧은 시간 안에 연달아 들어오는 이벤트
// (예: 탭 전환 한 번에 visibility_hidden과 window_blur가 거의 동시에 발생)는 한 번의
// 부정행위 시도로 보고 debounceMs 안에 들어오면 카운트하지 않되, 로그 자체는 남긴다.
export async function recordWarning(sessionId, type, debounceMs, maxWarnings) {
  const session = await getSession(sessionId);
  if (!session) return null;

  const last = await db
    .prepare('SELECT occurred_at FROM warning_events WHERE session_id = ? AND counted = 1 ORDER BY id DESC LIMIT 1')
    .get(sessionId);

  const nowIso = now();
  const withinDebounce = !!last && new Date(nowIso).getTime() - new Date(last.occurred_at).getTime() < debounceMs;
  const counted = withinDebounce ? 0 : 1;
  const resultingCount = session.warning_count + counted;

  await db
    .prepare(
      'INSERT INTO warning_events (session_id, type, occurred_at, counted, resulting_warning_count) VALUES (?, ?, ?, ?, ?)',
    )
    .run(sessionId, type, nowIso, counted, resultingCount);

  let disqualified = false;
  if (counted) {
    await db.prepare('UPDATE exam_sessions SET warning_count = ? WHERE id = ?').run(resultingCount, sessionId);
    if (resultingCount >= maxWarnings && session.status === 'in_progress') {
      await finalizeSession(sessionId, 'force_submitted');
      disqualified = true;
    }
  }

  return { warning_count: resultingCount, counted: !!counted, disqualified };
}

export async function finalizeSession(sessionId, status = 'submitted') {
  const session = await getSession(sessionId);
  if (!session || session.status === 'submitted' || session.status === 'force_submitted') return;

  const totals = await db
    .prepare(
      `SELECT
         COALESCE(SUM(a.awarded_points), 0) AS score,
         COALESCE((SELECT SUM(points) FROM questions WHERE exam_id = ?), 0) AS max_score
       FROM answers a
       WHERE a.session_id = ?`,
    )
    .get(session.exam_id, sessionId);

  await db
    .prepare('UPDATE exam_sessions SET status = ?, submitted_at = ?, score = ?, max_score = ? WHERE id = ?')
    .run(status, now(), totals.score, totals.max_score, sessionId);
}

// ---- 교사용 결과 집계 ----

export async function getResultsForExam(examId) {
  const sessions = await db
    .prepare(
      `SELECT es.roll_number, r.name, es.status, es.score, es.max_score, es.submitted_at, es.warning_count,
              (SELECT COALESCE(SUM(a.time_spent_ms), 0) FROM answers a WHERE a.session_id = es.id) AS total_time_ms
       FROM exam_sessions es
       LEFT JOIN roster r ON r.roll_number = es.roll_number
       WHERE es.exam_id = ?
       ORDER BY es.roll_number`,
    )
    .all(examId);

  const questionStats = await Promise.all(
    (await db.prepare('SELECT id, order_index, prompt FROM questions WHERE exam_id = ? ORDER BY order_index').all(examId)).map(
      async (q) => {
        const stat = await db
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
      },
    ),
  );

  return { sessions, questionStats };
}

export async function computeStandardsAccuracy({ examId, rollNumber, from, to } = {}) {
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

  const rows = await db
    .prepare(
      `SELECT qs.standard_code AS code,
              COUNT(*) AS attempted_count,
              COALESCE(SUM(a.is_correct), 0) AS correct_count,
              AVG(a.time_spent_ms) AS avg_time_spent_ms
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
        avg_time_spent_ms: r.avg_time_spent_ms ?? null,
      };
    })
    .filter(Boolean);
}
