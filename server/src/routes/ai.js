import { Router } from 'express';
import * as repo from '../db/repo.js';
import { upload } from '../middleware/upload.js';
import { extractQuestionsFromImage } from '../services/aiExtraction.js';

export const aiRouter = Router();

aiRouter.post('/:id/ai-extract', upload.single('file'), async (req, res) => {
  const examId = Number(req.params.id);
  const exam = await repo.getExam(examId);
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

  await repo.addExtractedQuestions(examId, extracted.questions);
  res.status(201).json(await repo.getExamFull(examId));
});
