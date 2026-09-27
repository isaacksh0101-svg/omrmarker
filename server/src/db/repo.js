// 데이터 접근 계층. 라우트 파일은 SQL을 직접 안 쓰고 여기 있는 이름 붙은 함수만 부른다.
import crypto from 'node:crypto';
import { db } from './index.js';
import { getStandardByCode } from '../services/curriculumStandards.js';
import { computeStandardTrendPatterns } from '../services/assessmentInsights.js';

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
    .prepare(
      'SELECT id, title, subject_id, grade_cluster, time_limit_sec, mode, status, memo, supervised_at, supervision_order, admission_code, started_at, ends_at, admission_closed, created_at FROM exams ORDER BY created_at DESC',
    )
    .all();
}

function createAdmissionCode() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const code = String(crypto.randomInt(100000, 1000000));
    const duplicate = db
      .prepare('SELECT 1 FROM exams WHERE admission_code = ? AND supervised_at IS NOT NULL AND ends_at IS NULL')
      .get(code);
    if (!duplicate) return code;
  }
  throw new Error('입장 코드를 생성하지 못했습니다. 다시 시도해주세요.');
}

export async function superviseExam(id) {
  const nextOrder = db.prepare('SELECT COALESCE(MAX(supervision_order), 0) + 1 AS value FROM exams').get().value;
  const admissionCode = createAdmissionCode();
  await db
    .prepare('UPDATE exams SET supervised_at = ?, supervision_order = ?, admission_code = ?, started_at = NULL, ends_at = NULL, admission_closed = 0, updated_at = ? WHERE id = ?')
    .run(now(), nextOrder, admissionCode, now(), id);
  return admissionCode;
}

export async function unsuperviseExam(id) {
  await db.prepare('UPDATE exams SET supervised_at = NULL, admission_code = NULL, updated_at = ? WHERE id = ?').run(now(), id);
}

export async function regenerateAdmissionCode(id) {
  const admissionCode = createAdmissionCode();
  await db.prepare('UPDATE exams SET admission_code = ?, updated_at = ? WHERE id = ?').run(admissionCode, now(), id);
  return admissionCode;
}

export async function getSupervisedExamByAdmissionCode(code) {
  return db
    .prepare("SELECT * FROM exams WHERE admission_code = ? AND status = 'finalized' AND supervised_at IS NOT NULL AND ends_at IS NULL")
    .get(code);
}

export async function listSupervisedExams() {
  return db
    .prepare("SELECT id, title, subject_id, grade_cluster, time_limit_sec, mode, status, supervised_at, supervision_order, started_at, ends_at FROM exams WHERE status = 'finalized' AND supervised_at IS NOT NULL AND ends_at IS NULL ORDER BY supervision_order, supervised_at")
    .all();
}

export async function getNextSupervisedExam(examId) {
  const current = db.prepare('SELECT supervision_order FROM exams WHERE id = ?').get(examId);
  if (!current?.supervision_order) return null;
  return db
    .prepare("SELECT id, title, subject_id, grade_cluster, time_limit_sec, mode FROM exams WHERE status = 'finalized' AND supervised_at IS NOT NULL AND ends_at IS NULL AND supervision_order > ? ORDER BY supervision_order LIMIT 1")
    .get(current.supervision_order);
}

export async function createExam({ title, subject_id, grade_cluster, time_limit_sec, mode }) {
  const result = await db
    .prepare(
      'INSERT INTO exams (title, subject_id, grade_cluster, time_limit_sec, mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .run(title, subject_id, grade_cluster, time_limit_sec, mode, now(), now());
  return result.lastInsertRowid;
}

export async function setExamMemo(id, memo) {
  await db.prepare('UPDATE exams SET memo = ?, updated_at = ? WHERE id = ?').run(memo, now(), id);
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
  const exam = await db.prepare('SELECT status FROM exams WHERE id = ?').get(id);
  await db
    .prepare("UPDATE exams SET status = 'archived', archived_from_status = ?, updated_at = ? WHERE id = ?")
    .run(exam?.status ?? 'finalized', now(), id);
}

// "다시 보이기" - 숨기기 전 상태로 복원한다. archived_from_status가 없는(이 컬럼이
// 생기기 전에 숨겨진) 시험은 대부분 이미 확정되어 있었을 가능성이 높으므로 finalized로 되돌린다.
export async function unarchiveExam(id) {
  const exam = await db.prepare('SELECT archived_from_status FROM exams WHERE id = ?').get(id);
  await db
    .prepare("UPDATE exams SET status = ?, archived_from_status = NULL, updated_at = ? WHERE id = ?")
    .run(exam?.archived_from_status ?? 'finalized', now(), id);
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
    'INSERT INTO questions (exam_id, order_index, type, prompt, prompt_image_path, source_image_path, points, ai_suggested, ai_standard_candidates, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, 1, ?, ?, ?)',
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
      q.source_image_path ?? null,
      validCandidates.length > 0 ? JSON.stringify(validCandidates) : null,
      now(),
      now(),
    );
    const questionId = result.lastInsertRowid;

    if (q.type === 'mc') {
      // 이제 AI는 보기 내용을 텍스트로 옮기지 않는다(이미지에 이미 보기가 포함됨) - 그래서
      // 개수를 알려주지도 않으므로 일단 5개로 만들어두고, 실제 보기 개수가 다르면 교사가
      // 문항 편집 화면에서 개수만 +/- 조정한다.
      const extractedChoices = Array.isArray(q.choices) && q.choices.length >= 2
        ? q.choices.slice(0, 10)
        : CHOICE_DIGITS.slice(0, 5);
      for (const [ci, label] of extractedChoices.entries()) {
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

// 한 학생의 학습 기록만 완전히 지운다. 명단(roster)은 유지하고, 해당 번호로 쌓인
// 모든 시험 세션을 삭제한다. answers와 warning_events는 exam_sessions를 부모로 둔
// ON DELETE CASCADE 관계라 답안·점수·문항별 소요시간·필기 획·화면 이탈 기록까지 함께
// 삭제된다. 학기 말 일괄 파기와 정보주체 삭제 요청 처리에 공통으로 사용할 수 있다.
export async function deleteLearningDataForRollNumber(rollNumber) {
  return deleteLearningDataForRollNumbers([rollNumber]);
}

export async function deleteLearningDataForRollNumbers(rollNumbers) {
  const uniqueRolls = [...new Set(rollNumbers)].filter((roll) => Number.isInteger(roll) && roll > 0);
  if (uniqueRolls.length === 0) return 0;
  const placeholders = uniqueRolls.map(() => '?').join(', ');
  db.exec('BEGIN IMMEDIATE');
  try {
    const affectedExamIds = db
      .prepare(`SELECT DISTINCT exam_id FROM exam_sessions WHERE roll_number IN (${placeholders})`)
      .all(...uniqueRolls)
      .map((row) => row.exam_id);
    const result = db
      .prepare(`DELETE FROM exam_sessions WHERE roll_number IN (${placeholders})`)
      .run(...uniqueRolls);
    const resetExam = db.prepare(
      'UPDATE exams SET started_at = NULL, ends_at = NULL, admission_closed = 0, updated_at = ? WHERE id = ? AND NOT EXISTS (SELECT 1 FROM exam_sessions WHERE exam_id = exams.id)',
    );
    for (const examId of affectedExamIds) resetExam.run(now(), examId);
    db.exec('COMMIT');
    return Number(result.changes);
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function academicYearForDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const koreaDate = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return koreaDate.getUTCMonth() >= 2 ? koreaDate.getUTCFullYear() : koreaDate.getUTCFullYear() - 1;
}

export async function getLearningDataRetentionStatus() {
  const rows = db
    .prepare("SELECT id, COALESCE(submitted_at, started_at) AS activity_at FROM exam_sessions WHERE submitted_at IS NOT NULL OR started_at IS NOT NULL")
    .all();
  const byAcademicYear = new Map();
  for (const row of rows) {
    const academicYear = academicYearForDate(row.activity_at);
    if (academicYear == null) continue;
    byAcademicYear.set(academicYear, (byAcademicYear.get(academicYear) || 0) + 1);
  }
  const nowDate = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const currentAcademicYear = nowDate.getUTCMonth() >= 2 ? nowDate.getUTCFullYear() : nowDate.getUTCFullYear() - 1;
  const years = [...byAcademicYear.entries()]
    .map(([academicYear, sessionCount]) => ({ academicYear, sessionCount }))
    .sort((a, b) => b.academicYear - a.academicYear);
  return {
    currentAcademicYear,
    previousSessionCount: years
      .filter((item) => item.academicYear < currentAcademicYear)
      .reduce((sum, item) => sum + item.sessionCount, 0),
    years,
  };
}

export async function deleteLearningDataForAcademicYear(academicYear) {
  const koreaOffsetMs = 9 * 60 * 60 * 1000;
  const start = new Date(Date.UTC(academicYear, 2, 1) - koreaOffsetMs).toISOString();
  const end = new Date(Date.UTC(academicYear + 1, 2, 1) - koreaOffsetMs).toISOString();
  db.exec('BEGIN IMMEDIATE');
  try {
    const affectedExamIds = db
      .prepare("SELECT DISTINCT exam_id FROM exam_sessions WHERE COALESCE(submitted_at, started_at) >= ? AND COALESCE(submitted_at, started_at) < ?")
      .all(start, end)
      .map((row) => row.exam_id);
    const result = db
      .prepare("DELETE FROM exam_sessions WHERE COALESCE(submitted_at, started_at) >= ? AND COALESCE(submitted_at, started_at) < ?")
      .run(start, end);
    const resetExam = db.prepare(
      'UPDATE exams SET started_at = NULL, ends_at = NULL, admission_closed = 0, updated_at = ? WHERE id = ? AND NOT EXISTS (SELECT 1 FROM exam_sessions WHERE exam_id = exams.id)',
    );
    for (const examId of affectedExamIds) resetExam.run(now(), examId);
    db.exec('COMMIT');
    return Number(result.changes);
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

// ---- sessions ----

export async function getSession(sessionId) {
  return db.prepare('SELECT * FROM exam_sessions WHERE id = ?').get(sessionId);
}

// 학생용 화면(로그인 없음)은 순차 정수 id 대신 이걸로만 자기 세션을 조회한다 - 다른 학생의
// 세션 id를 추측해서 답안/현재 문항을 들여다볼 수 없게 하기 위함.
export async function getSessionByToken(token) {
  if (!token) return undefined;
  return db.prepare('SELECT * FROM exam_sessions WHERE access_token = ?').get(token);
}

export async function getSessionByExamAndRoll(examId, rollNumber) {
  return db.prepare('SELECT * FROM exam_sessions WHERE exam_id = ? AND roll_number = ?').get(examId, rollNumber);
}

export async function createSession(examId, rollNumber) {
  const accessToken = crypto.randomBytes(24).toString('base64url');
  const result = await db
    .prepare('INSERT INTO exam_sessions (exam_id, roll_number, status, access_token) VALUES (?, ?, ?, ?)')
    .run(examId, rollNumber, 'joined', accessToken);
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
    // 시험 시작 뒤에도 올바른 입장 코드를 가진 지각 학생은 들어올 수 있다. 과거 버전에서
    // 시작과 함께 닫혀 있던 시험도 다시 시작 버튼을 누르면 열리도록 값을 0으로 맞춘다.
    .prepare("UPDATE exams SET started_at = COALESCE(started_at, ?), admission_closed = 0, updated_at = ? WHERE id = ?")
    .run(now(), now(), examId);
}

// 교사가 감독 화면에서 "시험 전체 종료"를 누른 시각 - 감독 화면이 대기중/감독중/종료됨을
// 구분하는 기준이 된다. "시험 다시 열기"를 누르면 clearExamEnded로 다시 NULL로 돌아간다.
export async function markExamEnded(examId) {
  await db.prepare('UPDATE exams SET ends_at = ?, updated_at = ? WHERE id = ?').run(now(), now(), examId);
}

export async function clearExamEnded(examId) {
  await db.prepare('UPDATE exams SET ends_at = NULL, admission_closed = 0, updated_at = ? WHERE id = ?').run(now(), examId);
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

// 오답 복습 모드에서 "이 세션이 틀렸던 문항"만 골라내는 데 쓴다 - 응답을 안 하고
// 건너뛴(포기한) 문항은 정답을 몰라서라기보단 시간이 부족했을 수도 있어 오답 복습
// 대상에서는 제외하고, 실제로 답을 냈다가 틀린 문항만 대상으로 한다.
export async function getWrongAnswerQuestionIds(sessionId) {
  const rows = db
    .prepare('SELECT question_id FROM answers WHERE session_id = ? AND answered_at IS NOT NULL AND is_correct = 0')
    .all(sessionId);
  return rows.map((row) => row.question_id);
}

export async function assignWrongAnswerReview(sessionId) {
  const wrongIds = await getWrongAnswerQuestionIds(sessionId);
  if (wrongIds.length === 0) return null;
  const existing = db.prepare('SELECT id FROM review_assignments WHERE session_id = ?').get(sessionId);
  let assignmentId = existing?.id;
  if (assignmentId) {
    db.prepare('DELETE FROM review_answers WHERE assignment_id = ?').run(assignmentId);
    db.prepare('DELETE FROM review_assignment_questions WHERE assignment_id = ?').run(assignmentId);
    db.prepare("UPDATE review_assignments SET status = 'assigned', current_index = 0, created_at = ?, started_at = NULL, completed_at = NULL WHERE id = ?")
      .run(now(), assignmentId);
  } else {
    assignmentId = db.prepare('INSERT INTO review_assignments (session_id, created_at) VALUES (?, ?)')
      .run(sessionId, now()).lastInsertRowid;
  }
  const insert = db.prepare('INSERT INTO review_assignment_questions (assignment_id, question_id, order_index) SELECT ?, id, order_index FROM questions WHERE id = ?');
  for (const questionId of wrongIds) insert.run(assignmentId, questionId);
  return getReviewAssignmentBySession(sessionId);
}

export async function getReviewAssignmentBySession(sessionId) {
  return db.prepare('SELECT * FROM review_assignments WHERE session_id = ?').get(sessionId);
}

export async function getReviewAssignmentQuestions(assignmentId) {
  return db.prepare('SELECT question_id, order_index FROM review_assignment_questions WHERE assignment_id = ? ORDER BY order_index').all(assignmentId);
}

export async function startReviewAssignment(assignmentId) {
  db.prepare("UPDATE review_assignments SET status = 'in_progress', started_at = COALESCE(started_at, ?) WHERE id = ? AND status = 'assigned'")
    .run(now(), assignmentId);
}

export async function saveReviewAnswer(assignmentId, questionId, { selectedChoiceId, shortAnswerText, isCorrect }) {
  db.prepare(`INSERT INTO review_answers
    (assignment_id, question_id, selected_choice_id, short_answer_text, is_correct, answered_at, attempts)
    VALUES (?, ?, ?, ?, ?, ?, 1)
    ON CONFLICT(assignment_id, question_id) DO UPDATE SET
      selected_choice_id = excluded.selected_choice_id, short_answer_text = excluded.short_answer_text,
      is_correct = excluded.is_correct, answered_at = excluded.answered_at,
      attempts = review_answers.attempts + 1`)
    .run(assignmentId, questionId, selectedChoiceId ?? null, shortAnswerText ?? null, isCorrect ? 1 : 0, now());
  // 오답이면 그 문항은 다음으로 안 넘어가고 맞을 때까지 다시 시도하게 하므로(학생 화면에서
  // 강제), "완료"는 답을 낸 개수가 아니라 "정답을 맞힌" 개수로 판단한다 - 같은 문항을 계속
  // 다시 제출해도 UPSERT라 행은 하나뿐이고, 그 행의 is_correct가 최종적으로 맞았는지만 본다.
  const total = db.prepare('SELECT COUNT(*) AS count FROM review_assignment_questions WHERE assignment_id = ?').get(assignmentId).count;
  const correct = db.prepare('SELECT COUNT(*) AS count FROM review_answers WHERE assignment_id = ? AND is_correct = 1').get(assignmentId).count;
  if (correct >= total) {
    db.prepare("UPDATE review_assignments SET status = 'completed', current_index = ?, completed_at = ? WHERE id = ?")
      .run(total, now(), assignmentId);
  } else {
    db.prepare("UPDATE review_assignments SET status = 'in_progress', current_index = ? WHERE id = ?")
      .run(correct, assignmentId);
  }
  return getReviewAssignmentBySession(
    db.prepare('SELECT session_id FROM review_assignments WHERE id = ?').get(assignmentId).session_id,
  );
}

export async function getReviewAnswerSummary(assignmentId) {
  return db.prepare(`SELECT ra.question_id, ra.is_correct, q.order_index
    FROM review_answers ra JOIN questions q ON q.id = ra.question_id
    WHERE ra.assignment_id = ? ORDER BY q.order_index`).all(assignmentId);
}

export async function getReviewAssignmentDetail(assignmentId) {
  return db.prepare(`SELECT q.id AS question_id, q.order_index, q.prompt, q.prompt_image_path,
      original.selected_choice_id AS original_choice_id, original.short_answer_text AS original_short_answer,
      original.is_correct AS original_is_correct,
      review.selected_choice_id AS review_choice_id, review.short_answer_text AS review_short_answer,
      review.is_correct AS review_is_correct, review.answered_at AS review_answered_at,
      review.attempts AS review_attempts,
      original_choice.text AS original_choice_text, review_choice.text AS review_choice_text
    FROM review_assignment_questions assigned
    JOIN questions q ON q.id = assigned.question_id
    JOIN review_assignments assignment ON assignment.id = assigned.assignment_id
    LEFT JOIN answers original ON original.session_id = assignment.session_id AND original.question_id = q.id
    LEFT JOIN review_answers review ON review.assignment_id = assigned.assignment_id AND review.question_id = q.id
    LEFT JOIN choices original_choice ON original_choice.id = original.selected_choice_id
    LEFT JOIN choices review_choice ON review_choice.id = review.selected_choice_id
    WHERE assigned.assignment_id = ? ORDER BY q.order_index`).all(assignmentId);
}

export async function getIncompleteReviewsForRollNumber(rollNumber) {
  return db.prepare(`SELECT assignment.id AS assignment_id, assignment.status, assignment.created_at,
      session.id AS session_id, session.exam_id, exam.title AS exam_title,
      (SELECT COUNT(*) FROM review_assignment_questions q WHERE q.assignment_id = assignment.id) AS total,
      (SELECT COUNT(*) FROM review_answers a WHERE a.assignment_id = assignment.id) AS answered
    FROM review_assignments assignment
    JOIN exam_sessions session ON session.id = assignment.session_id
    JOIN exams exam ON exam.id = session.exam_id
    WHERE session.roll_number = ? AND assignment.status != 'completed'
    ORDER BY assignment.created_at DESC`).all(rollNumber);
}

function recoveryCodeHash(code) {
  return crypto.createHash('sha256').update(code).digest('hex');
}

export async function issueReviewRecoveryCode(assignmentId, rollNumber) {
  const assignment = db.prepare(`SELECT assignment.id, assignment.status
    FROM review_assignments assignment
    JOIN exam_sessions session ON session.id = assignment.session_id
    WHERE assignment.id = ? AND session.roll_number = ?`).get(assignmentId, rollNumber);
  if (!assignment || assignment.status === 'completed') return null;
  const code = String(crypto.randomInt(100000, 1000000));
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  db.prepare('UPDATE review_assignments SET recovery_code_hash = ?, recovery_code_expires_at = ? WHERE id = ?')
    .run(recoveryCodeHash(code), expiresAt, assignmentId);
  return { code, expires_at: expiresAt };
}

export async function issueAllReviewRecoveryCode(rollNumber) {
  const assignments = db.prepare(`SELECT assignment.id FROM review_assignments assignment
    JOIN exam_sessions session ON session.id = assignment.session_id
    WHERE session.roll_number = ? AND assignment.status != 'completed'`).all(rollNumber);
  if (assignments.length === 0) return null;
  const code = String(crypto.randomInt(100000, 1000000));
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const update = db.prepare('UPDATE review_assignments SET recovery_code_hash = ?, recovery_code_expires_at = ? WHERE id = ?');
  for (const assignment of assignments) update.run(recoveryCodeHash(code), expiresAt, assignment.id);
  return { code, expires_at: expiresAt, count: assignments.length };
}

export async function redeemReviewRecoveryCode(rollNumber, code) {
  const rows = db.prepare(`SELECT assignment.id AS assignment_id, assignment.status,
      assignment.recovery_code_expires_at, session.exam_id, session.access_token
    FROM review_assignments assignment
    JOIN exam_sessions session ON session.id = assignment.session_id
    WHERE session.roll_number = ? AND assignment.recovery_code_hash = ? AND assignment.status != 'completed'`)
    .all(rollNumber, recoveryCodeHash(code));
  const valid = rows.filter((row) => row.recovery_code_expires_at && new Date(row.recovery_code_expires_at).getTime() >= Date.now());
  if (valid.length === 0) return null;
  const clear = db.prepare('UPDATE review_assignments SET recovery_code_hash = NULL, recovery_code_expires_at = NULL WHERE id = ?');
  for (const row of valid) clear.run(row.assignment_id);
  return { sessions: valid.map((row) => ({ exam_id: row.exam_id, access_token: row.access_token })) };
}

export async function getAnswer(sessionId, questionId) {
  return db.prepare('SELECT * FROM answers WHERE session_id = ? AND question_id = ?').get(sessionId, questionId);
}

export async function createAnswerShown(sessionId, questionId, shownAt) {
  await db
    .prepare('INSERT INTO answers (session_id, question_id, shown_at) VALUES (?, ?, ?)')
    .run(sessionId, questionId, shownAt);
}

export async function submitAnswer(
  sessionId,
  questionId,
  { selectedChoiceId, shortAnswerText, answeredAt, timeSpentMs, isCorrect, awardedPoints, strokesJson },
) {
  await db
    .prepare(
      `UPDATE answers
       SET selected_choice_id = ?, short_answer_text = ?, answered_at = ?, time_spent_ms = ?,
           is_correct = ?, awarded_points = ?, strokes_json = ?
       WHERE session_id = ? AND question_id = ?`,
    )
    .run(
      selectedChoiceId,
      shortAnswerText,
      answeredAt,
      timeSpentMs,
      isCorrect,
      awardedPoints,
      strokesJson ?? null,
      sessionId,
      questionId,
    );
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

  // 최초 점수와 답안은 그대로 둔 채, 실제로 답했다가 틀린 문항이 있으면 제출 직후 바로
  // 시작할 수 있는 별도 오답 재풀이 세션을 자동 생성한다.
  await assignWrongAnswerReview(sessionId);
}

// 강제 종료된 세션을 다시 응시 중으로 되돌린다("소명"을 받아들여 이어서 풀게 해주는
// 절차). started_at을 지금 시각으로 다시 잡아서(이미 지난 시간 때문에 되살리자마자 바로
// 시간 초과되는 일이 없게) 처음 제한시간만큼 새로 준다. 추가시간(extra_time_sec)은 그때
// 그 응시에 한해 일시적으로 준 것이라 0으로 되돌린다 - 되살릴 때마다 이전에 받은 보너스가
// 계속 쌓여 매번 다시 얹히는 걸 막기 위함. 경고 횟수도 0으로 되돌려서, 되살리자마자 사소한
// 이탈 한 번에 다시 강제 종료되지 않게 한다. 학생이 종료 화면을 벗어난 뒤 입장 코드를
// 다시 입력해 이어갈 수도 있으므로 재입장 허용값도 한 번 켠다.
export async function reviveSession(sessionId) {
  await db
    .prepare(
      `UPDATE exam_sessions
       SET status = 'in_progress', started_at = ?, submitted_at = NULL, score = NULL, max_score = NULL,
           warning_count = 0, disqualify_reason = NULL, extra_time_sec = 0, allow_rejoin = 1
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
  const rows = await db
    .prepare(
      `SELECT q.order_index, q.type, q.prompt, a.selected_choice_id, c.text AS selected_choice_text,
              a.short_answer_text, a.is_correct, a.awarded_points, a.time_spent_ms, a.answered_at, a.strokes_json
       FROM answers a
       JOIN questions q ON q.id = a.question_id
       LEFT JOIN choices c ON c.id = a.selected_choice_id
       WHERE a.session_id = ? AND a.answered_at IS NOT NULL
       ORDER BY q.order_index`,
    )
    .all(sessionId);
  return rows.map(({ strokes_json, ...rest }) => ({
    ...rest,
    strokes: strokes_json ? JSON.parse(strokes_json) : null,
  }));
}

// 학생별 리포트에서 "이 학생이 응시한 시험들" 목록을 보여주기 위한 조회 - 실제로 제출까지
// 된 것만(참여만 하고 안 푼 건 리포트로서 의미가 없음) 최신순으로.
export async function getExamsForRollNumber(rollNumber) {
  return db
    .prepare(
      `SELECT e.id AS exam_id, e.title, e.subject_id, e.grade_cluster, es.id AS session_id, es.status,
              es.score, es.max_score, es.submitted_at,
              (SELECT COUNT(*) FROM questions WHERE exam_id = e.id) AS question_count
       FROM exam_sessions es
       JOIN exams e ON e.id = es.exam_id
       WHERE es.roll_number = ? AND es.status IN ('submitted', 'force_submitted')
       ORDER BY es.submitted_at DESC`,
    )
    .all(rollNumber);
}

// ---- 교사용 결과 집계 ----

export async function getResultsForExam(examId) {
  const sessions = await db
    .prepare(
      `SELECT es.id AS session_id, es.roll_number, r.name, es.status, es.score, es.max_score, es.submitted_at,
              (SELECT COALESCE(SUM(a.time_spent_ms), 0) FROM answers a WHERE a.session_id = es.id) AS total_time_ms,
              review.status AS review_status, review.completed_at AS review_completed_at,
              (SELECT COUNT(*) FROM review_assignment_questions raq WHERE raq.assignment_id = review.id) AS review_total,
              (SELECT COUNT(*) FROM review_answers ra WHERE ra.assignment_id = review.id) AS review_answered,
              (SELECT COUNT(*) FROM review_answers ra WHERE ra.assignment_id = review.id AND ra.is_correct = 1) AS review_correct,
              (SELECT MAX(ra.attempts) FROM review_answers ra WHERE ra.assignment_id = review.id) AS review_max_attempts
       FROM exam_sessions es
       LEFT JOIN roster r ON r.roll_number = es.roll_number
       LEFT JOIN review_assignments review ON review.session_id = es.id
       WHERE es.exam_id = ?
       ORDER BY es.roll_number`,
    )
    .all(examId);

  // 문항 변별도·오답 선택지 분포 계산용 - 제출 완료한 응시만 기준으로 삼는다(강제 제출은
  // 중단 시점 때문에 총점이 왜곡될 수 있어 attachSessionInsights와 같은 이유로 제외).
  // 문항마다 따로 질의하지 않고 시험 전체를 한 번에 불러와 question_id로 묶는다.
  const analyticsRows = await db
    .prepare(
      `SELECT a.question_id, a.selected_choice_id, a.is_correct, a.awarded_points,
              a.time_spent_ms, es.score, es.max_score, q.points
       FROM answers a
       JOIN exam_sessions es ON es.id = a.session_id
       JOIN questions q ON q.id = a.question_id
       WHERE es.exam_id = ? AND es.status = 'submitted' AND a.answered_at IS NOT NULL AND es.max_score > 0`,
    )
    .all(examId);
  const analyticsByQuestion = new Map();
  for (const row of analyticsRows) {
    if (!analyticsByQuestion.has(row.question_id)) analyticsByQuestion.set(row.question_id, []);
    const remainingMaxScore = row.max_score - row.points;
    analyticsByQuestion.get(row.question_id).push({
      isCorrect: Boolean(row.is_correct),
      scorePct: row.score / row.max_score,
      restScorePct:
        remainingMaxScore > 0 ? (row.score - (row.awarded_points ?? 0)) / remainingMaxScore : null,
      selectedChoiceId: row.selected_choice_id,
      timeSpentMs: row.time_spent_ms,
    });
  }

  const questionStats = await Promise.all(
    (await db.prepare('SELECT id, order_index, prompt, type FROM questions WHERE exam_id = ? ORDER BY order_index').all(examId)).map(
      async (q) => {
        const questionAnalytics = analyticsByQuestion.get(q.id) ?? [];
        const timeValues = questionAnalytics.map((row) => row.timeSpentMs).filter((value) => value != null);
        const choices =
          q.type === 'mc'
            ? await db.prepare('SELECT id, is_correct FROM choices WHERE question_id = ? ORDER BY order_index').all(q.id)
            : [];
        return {
          question_id: q.id,
          order_index: q.order_index,
          prompt: q.prompt,
          answered_count: questionAnalytics.length,
          correct_count: questionAnalytics.filter((row) => row.isCorrect).length,
          avg_time_spent_ms:
            timeValues.length > 0 ? timeValues.reduce((sum, value) => sum + value, 0) / timeValues.length : null,
          time_values_ms: timeValues,
          analytics_rows: questionAnalytics,
          choice_ids: choices.map((c) => c.id),
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
      `SELECT es.id AS session_id, es.roll_number, r.name, a.is_correct, a.time_spent_ms,
              a.selected_choice_id, c.text AS selected_choice_text, a.short_answer_text
       FROM answers a
       JOIN exam_sessions es ON es.id = a.session_id
       LEFT JOIN roster r ON r.roll_number = es.roll_number
       LEFT JOIN choices c ON c.id = a.selected_choice_id
       WHERE a.question_id = ? AND es.status = 'submitted' AND a.answered_at IS NOT NULL
       ORDER BY a.time_spent_ms IS NULL, a.time_spent_ms DESC`,
    )
    .all(questionId);
}

// 위와 같은 모양의 행을, 문항 하나가 아니라 시험 전체 문항에 대해 한 번에 가져온다.
// SessionReview에서 학생 한 명의 세션 전체에 시간 기반 이상치 배지를 붙일 때, 문항마다
// 따로 질의하지 않고 이 한 번의 쿼리 결과를 question_id로 묶어서 쓴다.
export async function getExamQuestionStudentBreakdown(examId) {
  return db
    .prepare(
      `SELECT a.question_id, q.order_index, es.roll_number, r.name, a.is_correct, a.time_spent_ms,
              a.selected_choice_id, c.text AS selected_choice_text, a.short_answer_text
       FROM answers a
       JOIN exam_sessions es ON es.id = a.session_id
       JOIN questions q ON q.id = a.question_id
       LEFT JOIN roster r ON r.roll_number = es.roll_number
       LEFT JOIN choices c ON c.id = a.selected_choice_id
       WHERE q.exam_id = ? AND es.status = 'submitted' AND a.answered_at IS NOT NULL
       ORDER BY a.question_id, a.time_spent_ms IS NULL, a.time_spent_ms DESC`,
    )
    .all(examId);
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
              AVG(a.time_spent_ms) AS avg_time_spent_ms,
              MAX(es.submitted_at) AS latest_attempted_at
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
        latest_attempted_at: r.latest_attempted_at ?? null,
      };
    })
    .filter(Boolean);
}

// 시험(응시) 단위로 정답률 추이를 낸다. code가 없으면 해당 교과(subjectId)의 모든 문항을
// 대상으로 한 전체 평균("이 과목 전체 성적이 어떻게 변해왔는지")이고, code가 있으면
// question_standards로 좁혀 그 성취기준 하나만의 추이("이 성취기준만 따로 보면")가 된다.
export async function computeStandardsTrend({ subjectId, code, rollNumber, from, to } = {}) {
  const conditions = ["es.status = 'submitted'", 'a.answered_at IS NOT NULL'];
  const params = [];
  let standardJoin = '';
  if (code) {
    standardJoin = 'JOIN question_standards qs ON qs.question_id = q.id';
    conditions.push('qs.standard_code = ?');
    params.push(code);
  }
  if (subjectId) {
    conditions.push('e.subject_id = ?');
    params.push(subjectId);
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
      `SELECT e.id AS exam_id,
              e.title AS title,
              MIN(date(es.submitted_at)) AS date,
              COUNT(*) AS attempted_count,
              COALESCE(SUM(a.is_correct), 0) AS correct_count,
              AVG(a.time_spent_ms) AS avg_time_spent_ms
       FROM answers a
       JOIN questions q ON q.id = a.question_id
       JOIN exams e ON e.id = q.exam_id
       JOIN exam_sessions es ON es.id = a.session_id
       ${standardJoin}
       WHERE ${conditions.join(' AND ')}
       GROUP BY e.id
       ORDER BY date ASC, e.id ASC`,
    )
    .all(...params);

  return rows.map((r) => ({
    exam_id: r.exam_id,
    title: r.title,
    date: r.date,
    attempted_count: r.attempted_count,
    correct_count: r.correct_count,
    accuracy: r.attempted_count > 0 ? r.correct_count / r.attempted_count : 0,
    avg_time_spent_ms: r.avg_time_spent_ms ?? null,
  }));
}

// computeStandardsTrend와 달리 성취기준 코드를 하나로 좁히지 않고, 응시한 모든 성취기준을
// 시험별 x 코드별로 한 번에 묶어서 낸다("반복 약점"/"최근 개선" 판정용 원자재).
async function queryStandardCodeTrendRows({ rollNumber, subjectId, from, to }) {
  const conditions = ["es.status = 'submitted'", 'a.answered_at IS NOT NULL'];
  const params = [];
  if (rollNumber) {
    conditions.push('es.roll_number = ?');
    params.push(rollNumber);
  }
  if (subjectId) {
    conditions.push('e.subject_id = ?');
    params.push(subjectId);
  }
  if (from) {
    conditions.push('date(es.submitted_at) >= date(?)');
    params.push(from);
  }
  if (to) {
    conditions.push('date(es.submitted_at) <= date(?)');
    params.push(to);
  }

  return db
    .prepare(
      `SELECT e.id AS exam_id,
              MIN(date(es.submitted_at)) AS date,
              qs.standard_code AS code,
              COUNT(*) AS attempted_count,
              COALESCE(SUM(a.is_correct), 0) AS correct_count
       FROM answers a
       JOIN questions q ON q.id = a.question_id
       JOIN question_standards qs ON qs.question_id = q.id
       JOIN exams e ON e.id = q.exam_id
       JOIN exam_sessions es ON es.id = a.session_id
       WHERE ${conditions.join(' AND ')}
       GROUP BY e.id, qs.standard_code
       ORDER BY date ASC, e.id ASC`,
    )
    .all(...params);
}

// 학생별 리포트 전용 - 그 학생의 성취기준별 정답률이 여러 시험에 걸쳐 학급 평균보다
// 계속 낮은지("반복 약점"), 혹은 최근 뚜렷하게 좋아졌는지("최근 개선")를 판정한다.
export async function computeStandardWeaknessCandidates({ rollNumber, subjectId, from, to } = {}) {
  if (!rollNumber) return [];
  const [mineRows, classRows] = await Promise.all([
    queryStandardCodeTrendRows({ rollNumber, subjectId, from, to }),
    queryStandardCodeTrendRows({ subjectId, from, to }),
  ]);
  return computeStandardTrendPatterns(mineRows, classRows)
    .map((p) => {
      const std = getStandardByCode(p.code);
      if (!std) return null;
      return { ...p, statement: std.statement, subject_id: std.subject_id, subject_name: std.subject_name };
    })
    .filter(Boolean);
}
