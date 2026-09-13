import { Router } from 'express';
import { db } from '../db/index.js';
import { getStandardByCode } from '../services/curriculumStandards.js';

export const examsRouter = Router();

function now() {
  return new Date().toISOString();
}

export function getExamRow(id) {
  return db.prepare('SELECT * FROM exams WHERE id = ?').get(id);
}

export function getExamFull(id) {
  const exam = getExamRow(id);
  if (!exam) return null;

  const questions = db
    .prepare('SELECT * FROM questions WHERE exam_id = ? ORDER BY order_index')
    .all(id)
    .map((q) => {
      const choices = db
        .prepare('SELECT * FROM choices WHERE question_id = ? ORDER BY order_index')
        .all(q.id)
        .map((c) => ({ ...c, is_correct: !!c.is_correct }));
      const standards = db
        .prepare('SELECT standard_code, statement_snapshot, is_ai_suggested, confidence FROM question_standards WHERE question_id = ?')
        .all(q.id)
        .map((s) => ({ ...s, is_ai_suggested: !!s.is_ai_suggested }));
      return {
        ...q,
        ai_suggested: !!q.ai_suggested,
        correct_short_answers: q.correct_short_answers ? JSON.parse(q.correct_short_answers) : null,
        choices,
        standards,
      };
    });

  return { ...exam, questions };
}

// ---- 시험 CRUD ----

examsRouter.get('/', (_req, res) => {
  const rows = db
    .prepare('SELECT id, title, subject_id, grade_cluster, time_limit_sec, status, started_at, created_at FROM exams ORDER BY created_at DESC')
    .all();
  res.json(rows);
});

examsRouter.post('/', (req, res) => {
  const { title, subject_id, grade_cluster, time_limit_sec } = req.body;
  const mode = req.body.mode === 'paper_marking' ? 'paper_marking' : 'online';
  if (!title || !subject_id || !grade_cluster || !Number.isInteger(time_limit_sec)) {
    return res.status(400).json({ error: 'title, subject_id, grade_cluster, time_limit_sec가 모두 필요합니다.' });
  }
  const result = db
    .prepare(
      'INSERT INTO exams (title, subject_id, grade_cluster, time_limit_sec, mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .run(title, subject_id, grade_cluster, time_limit_sec, mode, now(), now());
  res.status(201).json(getExamFull(result.lastInsertRowid));
});

examsRouter.get('/:id', (req, res) => {
  const exam = getExamFull(Number(req.params.id));
  if (!exam) return res.status(404).json({ error: '시험을 찾을 수 없습니다.' });
  res.json(exam);
});

examsRouter.put('/:id', (req, res) => {
  const id = Number(req.params.id);
  const exam = getExamRow(id);
  if (!exam) return res.status(404).json({ error: '시험을 찾을 수 없습니다.' });

  const title = req.body.title ?? exam.title;
  const subject_id = req.body.subject_id ?? exam.subject_id;
  const grade_cluster = req.body.grade_cluster ?? exam.grade_cluster;
  const time_limit_sec = req.body.time_limit_sec ?? exam.time_limit_sec;
  const mode = req.body.mode ?? exam.mode;

  db.prepare(
    'UPDATE exams SET title = ?, subject_id = ?, grade_cluster = ?, time_limit_sec = ?, mode = ?, updated_at = ? WHERE id = ?',
  ).run(title, subject_id, grade_cluster, time_limit_sec, mode, now(), id);
  res.json(getExamFull(id));
});

examsRouter.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM exams WHERE id = ?').run(Number(req.params.id));
  res.status(204).end();
});

// ---- 문항 CRUD ----

examsRouter.post('/:id/questions', (req, res) => {
  const examId = Number(req.params.id);
  const exam = getExamRow(examId);
  if (!exam) return res.status(404).json({ error: '시험을 찾을 수 없습니다.' });

  const { type, points } = req.body;
  const prompt = req.body.prompt ?? '';
  if (!['mc', 'short'].includes(type)) {
    return res.status(400).json({ error: "type은 'mc' 또는 'short'여야 합니다." });
  }

  const { maxOrder } = db
    .prepare('SELECT COALESCE(MAX(order_index), -1) AS maxOrder FROM questions WHERE exam_id = ?')
    .get(examId);

  const result = db
    .prepare(
      'INSERT INTO questions (exam_id, order_index, type, prompt, points, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .run(examId, maxOrder + 1, type, prompt, points ?? 1, now(), now());

  res.status(201).json(getExamFull(examId).questions.find((q) => q.id === result.lastInsertRowid));
});

const CIRCLED_DIGITS = ['①', '②', '③', '④', '⑤', '⑥'];

// 종이 시험지 "틀 만들기": 객관식(4/5지선다)·단답형 개수만 받아 한 번에 문항을 생성한다.
// 정답은 아직 정하지 않는다 - 이후 "정답 입력" 단계에서 채운다.
examsRouter.post('/:id/questions/batch', (req, res) => {
  const examId = Number(req.params.id);
  const exam = getExamRow(examId);
  if (!exam) return res.status(404).json({ error: '시험을 찾을 수 없습니다.' });

  const mc4 = Number.isInteger(req.body.mc4) ? req.body.mc4 : 0;
  const mc5 = Number.isInteger(req.body.mc5) ? req.body.mc5 : 0;
  const short = Number.isInteger(req.body.short) ? req.body.short : 0;
  if (mc4 < 0 || mc5 < 0 || short < 0 || mc4 + mc5 + short === 0) {
    return res.status(400).json({ error: '만들 문항 수를 1개 이상 입력해주세요.' });
  }

  const { maxOrder } = db
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
    const { lastInsertRowid } = insertQuestion.run(examId, order, now(), now());
    CIRCLED_DIGITS.slice(0, 4).forEach((label, ci) => insertChoice.run(lastInsertRowid, ci, label));
  }
  for (let i = 0; i < mc5; i++, order++) {
    const { lastInsertRowid } = insertQuestion.run(examId, order, now(), now());
    CIRCLED_DIGITS.slice(0, 5).forEach((label, ci) => insertChoice.run(lastInsertRowid, ci, label));
  }
  for (let i = 0; i < short; i++, order++) {
    insertShortQuestion.run(examId, order, now(), now());
  }

  res.status(201).json(getExamFull(examId));
});

// 문항 순서를 드래그로 바꾼 뒤 저장. order는 이 시험의 문항 id를 새 순서로 나열한 배열.
examsRouter.put('/:id/questions/reorder', (req, res) => {
  const examId = Number(req.params.id);
  const exam = getExamRow(examId);
  if (!exam) return res.status(404).json({ error: '시험을 찾을 수 없습니다.' });

  const { order } = req.body;
  const current = db.prepare('SELECT id FROM questions WHERE exam_id = ?').all(examId);
  const currentIds = new Set(current.map((q) => q.id));

  if (
    !Array.isArray(order) ||
    order.length !== currentIds.size ||
    !order.every((id) => currentIds.has(id))
  ) {
    return res.status(400).json({ error: '순서 목록이 이 시험의 문항 구성과 일치하지 않습니다.' });
  }

  const update = db.prepare('UPDATE questions SET order_index = ? WHERE id = ?');
  order.forEach((id, i) => update.run(i, id));

  res.json(getExamFull(examId));
});

function getQuestionOr404(examId, questionId, res) {
  const q = db.prepare('SELECT * FROM questions WHERE id = ? AND exam_id = ?').get(questionId, examId);
  if (!q) res.status(404).json({ error: '문항을 찾을 수 없습니다.' });
  return q;
}

examsRouter.put('/:id/questions/:qid', (req, res) => {
  const examId = Number(req.params.id);
  const qid = Number(req.params.qid);
  const question = getQuestionOr404(examId, qid, res);
  if (!question) return;

  const prompt = req.body.prompt ?? question.prompt;
  const points = req.body.points ?? question.points;
  const type = req.body.type ?? question.type;

  db.prepare('UPDATE questions SET prompt = ?, points = ?, type = ?, updated_at = ? WHERE id = ?').run(
    prompt,
    points,
    type,
    now(),
    qid,
  );
  res.json(getExamFull(examId).questions.find((q) => q.id === qid));
});

examsRouter.delete('/:id/questions/:qid', (req, res) => {
  const examId = Number(req.params.id);
  const qid = Number(req.params.qid);
  db.prepare('DELETE FROM questions WHERE id = ? AND exam_id = ?').run(qid, examId);

  // order_index 재정렬 (구멍 없이 유지)
  const remaining = db
    .prepare('SELECT id FROM questions WHERE exam_id = ? ORDER BY order_index')
    .all(examId);
  remaining.forEach((q, i) => {
    db.prepare('UPDATE questions SET order_index = ? WHERE id = ?').run(i, q.id);
  });

  res.json(getExamFull(examId));
});

// ---- 보기(객관식) ----

examsRouter.put('/:id/questions/:qid/choices', (req, res) => {
  const examId = Number(req.params.id);
  const qid = Number(req.params.qid);
  const question = getQuestionOr404(examId, qid, res);
  if (!question) return;

  const { choices } = req.body; // [{text, is_correct}]
  if (!Array.isArray(choices) || choices.length === 0) {
    return res.status(400).json({ error: 'choices 배열이 필요합니다.' });
  }

  db.prepare('DELETE FROM choices WHERE question_id = ?').run(qid);
  const insert = db.prepare(
    'INSERT INTO choices (question_id, order_index, text, is_correct) VALUES (?, ?, ?, ?)',
  );
  choices.forEach((c, i) => {
    insert.run(qid, i, c.text, c.is_correct ? 1 : 0);
  });

  res.json(getExamFull(examId).questions.find((q) => q.id === qid));
});

// ---- 정답(단답형) ----

examsRouter.put('/:id/questions/:qid/answer', (req, res) => {
  const examId = Number(req.params.id);
  const qid = Number(req.params.qid);
  const question = getQuestionOr404(examId, qid, res);
  if (!question) return;

  const { correct_short_answers } = req.body; // string[]
  if (!Array.isArray(correct_short_answers) || correct_short_answers.length === 0) {
    return res.status(400).json({ error: 'correct_short_answers 배열이 필요합니다.' });
  }

  db.prepare('UPDATE questions SET correct_short_answers = ?, updated_at = ? WHERE id = ?').run(
    JSON.stringify(correct_short_answers),
    now(),
    qid,
  );
  res.json(getExamFull(examId).questions.find((q) => q.id === qid));
});

// ---- 성취기준 태깅 ----

examsRouter.put('/:id/questions/:qid/standards', (req, res) => {
  const examId = Number(req.params.id);
  const qid = Number(req.params.qid);
  const question = getQuestionOr404(examId, qid, res);
  if (!question) return;

  const { codes } = req.body; // string[]
  if (!Array.isArray(codes)) {
    return res.status(400).json({ error: 'codes 배열이 필요합니다.' });
  }

  const unknown = codes.filter((code) => !getStandardByCode(code));
  if (unknown.length > 0) {
    return res.status(400).json({ error: '알 수 없는 성취기준 코드입니다.', unknown });
  }

  db.prepare('DELETE FROM question_standards WHERE question_id = ?').run(qid);
  const insert = db.prepare(
    'INSERT INTO question_standards (question_id, standard_code, statement_snapshot, is_ai_suggested, confidence) VALUES (?, ?, ?, 0, NULL)',
  );
  codes.forEach((code) => {
    const std = getStandardByCode(code);
    insert.run(qid, code, std.statement);
  });

  res.json(getExamFull(examId).questions.find((q) => q.id === qid));
});

// ---- 확정(finalize) ----

examsRouter.post('/:id/finalize', (req, res) => {
  const examId = Number(req.params.id);
  const exam = getExamFull(examId);
  if (!exam) return res.status(404).json({ error: '시험을 찾을 수 없습니다.' });

  if (exam.questions.length === 0) {
    return res.status(400).json({ error: '문항이 1개 이상 있어야 합니다.', missing: [] });
  }

  const missing = [];
  for (const q of exam.questions) {
    const reasons = [];
    // 온라인 모드는 학생 화면에 문제를 그대로 보여주므로 내용이 비어 있으면 안 되지만,
    // 종이 마킹 모드는 학생이 종이 시험지를 보므로 문제 내용은 선택 사항이다.
    if (exam.mode === 'online' && !q.prompt.trim()) {
      reasons.push('문제 내용이 비어 있습니다.');
    }
    if (q.type === 'mc') {
      if (!q.choices.some((c) => c.is_correct)) reasons.push('정답으로 표시된 보기가 없습니다.');
      if (q.choices.length < 2) reasons.push('보기가 2개 이상이어야 합니다.');
    } else if (q.type === 'short') {
      if (!q.correct_short_answers || q.correct_short_answers.length === 0) {
        reasons.push('정답이 설정되지 않았습니다.');
      }
    }
    if (q.standards.length === 0) reasons.push('성취기준이 1개 이상 태깅되어야 합니다.');

    if (reasons.length > 0) {
      missing.push({ question_id: q.id, order_index: q.order_index, reasons });
    }
  }

  if (missing.length > 0) {
    return res.status(400).json({ error: '완성되지 않은 문항이 있습니다.', missing });
  }

  db.prepare("UPDATE exams SET status = 'finalized', updated_at = ? WHERE id = ?").run(now(), examId);
  res.json(getExamFull(examId));
});
