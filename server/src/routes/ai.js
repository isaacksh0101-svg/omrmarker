import { Router } from 'express';
import { db } from '../db/index.js';
import { upload } from '../middleware/upload.js';
import { extractQuestionsFromImage } from '../services/aiExtraction.js';
import { getExamRow, getExamFull } from './exams.js';
import { getStandardByCode } from '../services/curriculumStandards.js';

export const aiRouter = Router();

function now() {
  return new Date().toISOString();
}

aiRouter.post('/:id/ai-extract', upload.single('file'), async (req, res) => {
  const examId = Number(req.params.id);
  const exam = getExamRow(examId);
  if (!exam) return res.status(404).json({ error: '시험을 찾을 수 없습니다.' });
  if (!req.file) return res.status(400).json({ error: '이미지 파일이 필요합니다.' });

  let extracted;
  try {
    extracted = await extractQuestionsFromImage({
      imageBase64: req.file.buffer.toString('base64'),
      mimeType: req.file.mimetype,
      subjectId: exam.subject_id,
      gradeCluster: exam.grade_cluster,
    });
  } catch (e) {
    return res.status(502).json({ error: `AI 추출 실패: ${e.message}` });
  }

  const { maxOrder } = db
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

  extracted.questions.forEach((q, i) => {
    const result = insertQuestion.run(examId, maxOrder + 1 + i, q.type, q.prompt, now(), now());
    const questionId = result.lastInsertRowid;

    if (q.type === 'mc') {
      q.choices.forEach((c, ci) => insertChoice.run(questionId, ci, c.text));
    }

    q.suggested_standards.forEach((s) => {
      const std = getStandardByCode(s.code);
      if (!std) return; // 서비스 계층에서 이미 걸러지지만 한 번 더 방어
      insertStandard.run(questionId, s.code, std.statement, s.confidence ?? null);
    });
  });

  res.status(201).json(getExamFull(examId));
});
