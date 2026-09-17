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
        ai_standard_candidates: q.ai_standard_candidates ? JSON.parse(q.ai_standard_candidates) : null,
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

// 시험지를 실제로 지우면 exam_sessions/answers까지 함께 사라져(FK ON DELETE CASCADE)
// 학생 응시 결과가 통째로 없어진다. "삭제"는 목록/감독 화면에서만 숨기는 보관 처리로
// 구현해 결과는 시험별 리포트에서 계속 조회할 수 있게 한다.
export async function archiveExam(id) {
  await db.prepare("UPDATE exams SET status = 'archived', updated_at = ? WHERE id = ?").run(now(), id);
}

export async function finalizeExam(id) {
  await db.prepare("UPDATE exams SET status = 'finalized', updated_at = ? WHERE id = ?").run(now(), id);
}

// 시험별 리포트 화면에서 쓰는 진짜 영구 삭제. exam_sessions/answers까지 FK로 함께
// 지워지므로(ON DELETE CASCADE) 되돌릴 수 없다 - archiveExam(목록에서만 숨김)과는 다르다.
export async function hardDeleteExam(id) {
  await db.prepare('DELETE FROM exams WHERE id = ?').run(id);
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

export async function setPromptImage(qid, promptImagePath) {
  await db.prepare('UPDATE questions SET prompt_image_path = ?, updated_at = ? WHERE id = ?').run(
    promptImagePath,
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
    'INSERT INTO questions (exam_id, order_index, type, prompt, prompt_image_path, points, ai_suggested, ai_standard_candidates, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, 1, ?, ?, ?)',
  );
  const insertChoice = db.prepare(
    'INSERT INTO choices (question_id, order_index, text, is_correct) VALUES (?, ?, ?, 0)',
  );
  const insertStandard = db.prepare(
    'INSERT INTO question_standards (question_id, standard_code, statement_snapshot, is_ai_suggested, confidence) VALUES (?, ?, ?, 1, ?)',
  );

  for (const [i, q] of extractedQuestions.entries()) {
    // AI가 관련도 순으로 나열해 준 후보들 중 실제 목록에 있는 코드만 남긴다 - 모델이
    // 스키마를 어기고 목록 밖 코드를 내놓는 경우에 대한 방어(서비스 계층에서 한 번 걸렀지만
    // 한 번 더 확인).
    const validCandidates = q.suggested_standards.filter((s) => getStandardByCode(s.code));

    const result = await insertQuestion.run(
      examId,
      maxOrder + 1 + i,
      q.type,
      q.prompt,
      q.prompt_image_path ?? null,
      validCandidates.length > 0 ? JSON.stringify(validCandidates) : null,
      now(),
      now(),
    );
    const questionId = result.lastInsertRowid;

    if (q.type === 'mc') {
      // 이제 AI는 보기 내용을 텍스트로 옮기지 않는다(이미지에 이미 보기가 포함됨) - 그래서
      // 개수를 알려주지도 않으므로 일단 5개로 만들어두고, 실제 보기 개수가 다르면 교사가
      // 문항 편집 화면에서 개수만 +/- 조정한다.
      for (const [ci, label] of CHOICE_DIGITS.slice(0, 5).entries()) {
        await insertChoice.run(questionId, ci, label);
      }
    }

    // 후보 중 1순위(가장 관련 있다고 판단한 것)만 자동으로 태그해둔다 - 나머지는
    // ai_standard_candidates로만 남겨서 교사가 검토용으로 참고하게 한다. 교사가 다른 후보가
    // 더 맞다고 판단하면 성취기준 편집 UI에서 자유롭게 바꿀 수 있다.
    const top = validCandidates[0];
    if (top) {
      const std = getStandardByCode(top.code);
      await insertStandard.run(questionId, top.code, std.statement, top.confidence ?? null);
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

// 교사가 "실시간 감독"에서 재참여를 허용해줬을 때(true)/그 허용을 한 번 소진했을 때(false) 쓴다.
export async function setAllowRejoin(sessionId, allow) {
  await db.prepare('UPDATE exam_sessions SET allow_rejoin = ? WHERE id = ?').run(allow ? 1 : 0, sessionId);
}

export async function startSession(sessionId) {
  await db
    .prepare("UPDATE exam_sessions SET status = 'in_progress', started_at = ? WHERE id = ?")
    .run(now(), sessionId);
}

// 교사가 '시험 감독' 화면에서 시험을 시작한 시각. 이미 시작된 시험이면 그대로 둔다
// (COALESCE) - 다시 눌러도 이미 응시 중인 학생들의 제한시간이 리셋되지 않는다.
export async function markExamStarted(examId) {
  await db
    .prepare("UPDATE exams SET started_at = COALESCE(started_at, ?), updated_at = ? WHERE id = ?")
    .run(now(), now(), examId);
}

// 교사가 감독 화면에서 "시험 전체 종료"를 누른 시각 - 감독 화면이 대기중/감독중/종료됨을
// 구분하는 기준이 된다. "시험 재시작"을 누르면 clearExamEnded로 다시 NULL로 돌아간다.
export async function markExamEnded(examId) {
  await db.prepare('UPDATE exams SET ends_at = ?, updated_at = ? WHERE id = ?').run(now(), now(), examId);
}

export async function clearExamEnded(examId) {
  await db.prepare('UPDATE exams SET ends_at = NULL, updated_at = ? WHERE id = ?').run(now(), examId);
}

// 아직 대기 중(joined)인 학생 전원을 한 번에 응시 상태로 바꾼다. 새로 입장하는 학생은
// 이 함수를 부르지 않아도 sessions.js의 join 라우트가 exam.started_at을 보고 즉시 시작시킨다.
export async function startAllJoinedSessions(examId) {
  const rows = await db
    .prepare("SELECT id FROM exam_sessions WHERE exam_id = ? AND status = 'joined'")
    .all(examId);
  for (const row of rows) {
    await startSession(row.id);
  }
  return rows.length;
}

// 교사가 '시험 감독' 화면에서 시험 전체를 지금 끝낸다. 아직 대기/응시 중인 학생 전원을
// 지금까지 낸 답만으로 강제 제출 처리한다.
export async function endAllActiveSessions(examId) {
  const rows = await db
    .prepare("SELECT id FROM exam_sessions WHERE exam_id = ? AND status IN ('joined', 'in_progress')")
    .all(examId);
  for (const row of rows) {
    await finalizeSession(row.id, 'force_submitted', 'teacher_manual');
  }
  return rows.length;
}

// "시험 전체 종료"로 한 번에 강제 제출된 학생들을 다시 응시 중으로 한 번에 되돌린다.
// 개별 revive와 동일하게, 이미 정상적으로 스스로 제출한(submitted) 학생은 건드리지 않는다.
export async function reviveAllForceSubmittedSessions(examId) {
  const rows = await db
    .prepare("SELECT id FROM exam_sessions WHERE exam_id = ? AND status = 'force_submitted'")
    .all(examId);
  for (const row of rows) {
    await reviveSession(row.id);
  }
  return rows.length;
}

// 제한시간이 지났는데도 응시 중(in_progress)으로 남아있는 세션을 주기적으로 정리하기
// 위한 조회. 학생 기기가 꺼지거나 끊겨서 자동 제출 요청이 서버에 끝내 도달하지 못하면
// 이 상태로 무한정 남으므로(감독 화면엔 "응시중"으로 계속 보임), 서버가 스스로 훑어서
// 정리해야 한다 - index.js의 주기 작업(sweep)에서 사용.
export async function getTimedOutInProgressSessions() {
  const rows = await db
    .prepare(
      `SELECT es.id AS session_id, es.exam_id, es.started_at, es.extra_time_sec, e.time_limit_sec
       FROM exam_sessions es
       JOIN exams e ON e.id = es.exam_id
       WHERE es.status = 'in_progress' AND es.started_at IS NOT NULL`,
    )
    .all();
  const nowMs = Date.now();
  return rows.filter((row) => {
    const deadline = new Date(row.started_at).getTime() + (row.time_limit_sec + (row.extra_time_sec ?? 0)) * 1000;
    return nowMs > deadline;
  });
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

// 교사가 시험 감독 화면에서 학생 한 명에게만 시간을 더 준다. 음수로는 못 깎게(0 밑으로는
// 안 내려가게) 해서 실수로 시간을 줄여 학생이 강제 종료되는 사고를 막는다.
export async function addExtraTime(sessionId, seconds) {
  await db
    .prepare('UPDATE exam_sessions SET extra_time_sec = MAX(0, extra_time_sec + ?) WHERE id = ?')
    .run(seconds, sessionId);
  return getSession(sessionId);
}

// "건너뛰기": 보여줬지만(shown) 아직 답하지 않은(answered_at IS NULL) 문항 - 1차 진행을
// 다 돌고 나면 이것들을 모아 학생에게 다시 보여준다.
export async function countPendingAnswers(sessionId) {
  const row = await db
    .prepare('SELECT COUNT(*) AS n FROM answers WHERE session_id = ? AND answered_at IS NULL')
    .get(sessionId);
  return row.n;
}

export async function getPendingQuestionIds(sessionId) {
  const rows = await db
    .prepare(
      `SELECT q.id FROM answers a
       JOIN questions q ON q.id = a.question_id
       WHERE a.session_id = ? AND a.answered_at IS NULL
       ORDER BY q.order_index`,
    )
    .all(sessionId);
  return rows.map((r) => r.id);
}

// 건너뛴 문항을 "포기"로 마감 - 빈 답으로 채점(오답 처리)해 더 이상 미응답 상태로 남지 않게 한다.
export async function giveUpAnswer(sessionId, questionId, answeredAt) {
  const answerRow = await getAnswer(sessionId, questionId);
  if (!answerRow || answerRow.answered_at) return false;
  const timeSpentMs = Date.now() - new Date(answerRow.shown_at).getTime();
  await submitAnswer(sessionId, questionId, {
    selectedChoiceId: null,
    shortAnswerText: '',
    answeredAt,
    timeSpentMs,
    isCorrect: 0,
    awardedPoints: 0,
  });
  return true;
}

// 화면 이탈/포커스 아웃이 감지되면 그 즉시 시험을 강제 제출 처리한다("경고 3회" 같은
// 유예 없이 첫 이탈부터 바로 종료 - 나가서 답을 찾아보고 돌아오면 그만인 허점을 막기
// 위함). blur/visibilitychange/fullscreenchange가 같은 탭 전환 한 번에 거의 동시에 여러
// 번 발동할 수 있어, debounceMs 안에 또 들어오면 로그만 남기고 중복 종료 처리는 하지 않는다.
export async function recordScreenLeave(sessionId, type, debounceMs) {
  const session = db.prepare('SELECT * FROM exam_sessions WHERE id = ?').get(sessionId);
  if (!session || session.status !== 'in_progress') return { disqualified: false };

  const last = db
    .prepare('SELECT occurred_at FROM warning_events WHERE session_id = ? ORDER BY id DESC LIMIT 1')
    .get(sessionId);
  const nowIso = now();
  const withinDebounce = !!last && new Date(nowIso).getTime() - new Date(last.occurred_at).getTime() < debounceMs;

  const resultingCount = session.warning_count + 1;
  db.prepare(
    'INSERT INTO warning_events (session_id, type, occurred_at, counted, resulting_warning_count) VALUES (?, ?, ?, 1, ?)',
  ).run(sessionId, type, nowIso, resultingCount);
  db.prepare('UPDATE exam_sessions SET warning_count = ? WHERE id = ?').run(resultingCount, sessionId);

  if (withinDebounce) return { disqualified: false };

  await finalizeSession(sessionId, 'force_submitted', 'screen_leave');
  return { disqualified: true };
}

export async function finalizeSession(sessionId, status = 'submitted', reason = null) {
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
    .prepare(
      `UPDATE exam_sessions
       SET status = ?, submitted_at = ?, score = ?, max_score = ?, disqualify_reason = ?
       WHERE id = ?`,
    )
    .run(status, now(), totals.score, totals.max_score, reason, sessionId);
}

// 강제 종료된 세션을 다시 응시 중으로 되돌린다("소명"을 받아들여 이어서 풀게 해주는
// 절차). started_at을 지금 시각으로 다시 잡아서(이미 지난 시간 때문에 되살리자마자 바로
// 시간 초과되는 일이 없게) 처음 제한시간만큼 새로 준다 - 그전에 받은 추가시간
// (extra_time_sec)은 그대로 유지된다. 경고 횟수도 0으로 되돌려서, 되살리자마자 사소한
// 이탈 한 번에 다시 강제 종료되지 않게 한다.
export async function reviveSession(sessionId) {
  await db
    .prepare(
      `UPDATE exam_sessions
       SET status = 'in_progress', started_at = ?, submitted_at = NULL, score = NULL, max_score = NULL,
           warning_count = 0, disqualify_reason = NULL
       WHERE id = ?`,
    )
    .run(now(), sessionId);
}

// ---- 교사용 시험 감독(실시간 모니터링) ----

// 명단에 있는 학생 전원을 기준으로, 이 시험에 아직 입장하지 않은 학생도 함께 보여준다
// (교사가 "누가 아직 안 들어왔는지"를 바로 확인할 수 있어야 하므로 LEFT JOIN).
export async function getMonitorStudents(examId) {
  return db
    .prepare(
      `SELECT r.roll_number, r.name, es.id AS session_id, es.status,
              es.current_question_index, es.warning_count, es.started_at, es.submitted_at,
              es.score, es.max_score, es.extra_time_sec, es.disqualify_reason
       FROM roster r
       LEFT JOIN exam_sessions es ON es.roll_number = r.roll_number AND es.exam_id = ?
       ORDER BY r.roll_number`,
    )
    .all(examId);
}

// 학생이 지금까지 답한 문항 이력(문제 내용 포함) - 감독 화면에서 "화면 확인"용.
export async function getSessionAnswerHistory(sessionId) {
  return db
    .prepare(
      `SELECT q.order_index, q.type, q.prompt, a.selected_choice_id, c.text AS selected_choice_text,
              a.short_answer_text, a.is_correct, a.awarded_points, a.time_spent_ms, a.answered_at
       FROM answers a
       JOIN questions q ON q.id = a.question_id
       LEFT JOIN choices c ON c.id = a.selected_choice_id
       WHERE a.session_id = ? AND a.answered_at IS NOT NULL
       ORDER BY q.order_index`,
    )
    .all(sessionId);
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

// 문항별 정답률에서 특정 문항 번호를 눌렀을 때 보여주는 "학생별 소요시간" 상세.
export async function getQuestionStudentBreakdown(questionId) {
  return db
    .prepare(
      `SELECT es.roll_number, r.name, a.is_correct, a.time_spent_ms,
              a.selected_choice_id, c.text AS selected_choice_text, a.short_answer_text
       FROM answers a
       JOIN exam_sessions es ON es.id = a.session_id
       LEFT JOIN roster r ON r.roll_number = es.roll_number
       LEFT JOIN choices c ON c.id = a.selected_choice_id
       WHERE a.question_id = ? AND a.answered_at IS NOT NULL
       ORDER BY a.time_spent_ms IS NULL, a.time_spent_ms DESC`,
    )
    .all(questionId);
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
