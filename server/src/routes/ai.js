import { Router } from 'express';
import * as repo from '../db/repo.js';
import { upload } from '../middleware/upload.js';
import { extractAnswerKeyFromImage, extractQuestionsFromImage } from '../services/aiExtraction.js';
import { cropQuestionImages } from '../services/cropQuestionImages.js';
import { renderPdfToImages } from '../services/renderPdfPages.js';
import { requireAuth } from '../middleware/auth.js';

export const aiRouter = Router();

// 이미지 한 장(래스터 또는 PDF 한 쪽을 렌더링한 PNG)에 대해 AI 추출 + 발문 이미지 자르기를
// 수행한다. PDF는 여러 쪽일 수 있어 이 함수를 쪽마다 반복 호출한다.
async function extractFromSingleImage(imageBuffer, mimeType, exam, orderOffset) {
  const extracted = await extractQuestionsFromImage({
    imageBase64: imageBuffer.toString('base64'),
    mimeType,
    subjectId: exam.subject_id,
    gradeCluster: exam.grade_cluster,
  });
  const withImages = await cropQuestionImages(imageBuffer, mimeType, extracted.questions);
  return withImages.map((q, i) => ({ ...q, order_index: orderOffset + i }));
}

aiRouter.post('/:id/ai-extract', requireAuth, upload.single('file'), async (req, res) => {
  const examId = Number(req.params.id);
  const exam = await repo.getExam(examId);
  if (!exam) return res.status(404).json({ error: '시험을 찾을 수 없습니다.' });
  if (!req.file) return res.status(400).json({ error: '이미지 파일이 필요합니다.' });

  let allQuestions;
  try {
    if (req.file.mimetype === 'application/pdf') {
      // PDF는 원본에서 바로 잘라낼 수 없으니(래스터화 라이브러리가 없으면), 먼저 쪽마다
      // PNG로 렌더링해서 그 뒤로는 이미지 업로드와 완전히 같은 경로를 태운다.
      const pageImages = await renderPdfToImages(req.file.buffer);
      allQuestions = [];
      for (const pageImage of pageImages) {
        const pageQuestions = await extractFromSingleImage(pageImage, 'image/png', exam, allQuestions.length);
        allQuestions = allQuestions.concat(pageQuestions);
      }
    } else {
      allQuestions = await extractFromSingleImage(req.file.buffer, req.file.mimetype, exam, 0);
    }
  } catch (e) {
    return res.status(502).json({ error: `AI 추출 실패: ${e.message}` });
  }

  await repo.addExtractedQuestions(examId, allQuestions);
  res.status(201).json(await repo.getExamFull(examId));
});

// 정답지(사진/PDF)를 올리면 이미 만들어진 문항들에 맞춰 정답을 자동으로 채운다. 문항
// 생성(위 ai-extract)과는 별도 경로 - 문제지와 정답지가 따로 오는 경우가 흔하기 때문이다.
// 이미지 한 장에 대해 AI 추출을 수행한다. PDF는 여러 쪽일 수 있어 쪽마다 반복 호출한다.
async function extractAnswersFromSingleImage(imageBuffer, mimeType, questionInfos) {
  return extractAnswerKeyFromImage({
    imageBase64: imageBuffer.toString('base64'),
    mimeType,
    questions: questionInfos,
  });
}

aiRouter.post('/:id/ai-extract-answers', requireAuth, upload.single('file'), async (req, res) => {
  const examId = Number(req.params.id);
  const exam = await repo.getExamFull(examId);
  if (!exam) return res.status(404).json({ error: '시험을 찾을 수 없습니다.' });
  if (!req.file) return res.status(400).json({ error: '이미지 파일이 필요합니다.' });
  if ((exam.questions ?? []).length === 0) {
    return res.status(400).json({ error: '먼저 문항을 만든 뒤에 정답지를 올려주세요.' });
  }

  const questionInfos = exam.questions.map((q) => ({
    order_index: q.order_index,
    type: q.type,
    numChoices: q.choices.length,
  }));

  let extractedAnswers;
  try {
    if (req.file.mimetype === 'application/pdf') {
      const pageImages = await renderPdfToImages(req.file.buffer);
      extractedAnswers = [];
      for (const pageImage of pageImages) {
        const pageAnswers = await extractAnswersFromSingleImage(pageImage, 'image/png', questionInfos);
        extractedAnswers = extractedAnswers.concat(pageAnswers);
      }
    } else {
      extractedAnswers = await extractAnswersFromSingleImage(req.file.buffer, req.file.mimetype, questionInfos);
    }
  } catch (e) {
    return res.status(502).json({ error: `AI 추출 실패: ${e.message}` });
  }

  // 같은 문항 번호가 여러 쪽에 걸쳐 나오는 일은 없다고 보고, 나중 값이 있으면 그걸로 덮는다.
  const byNumber = new Map(extractedAnswers.map((a) => [a.question_number, a.answer]));
  const applied = [];
  const skipped = [];

  for (const q of exam.questions) {
    const raw = byNumber.get(q.order_index + 1);
    if (raw === undefined) {
      skipped.push(q.order_index + 1);
      continue;
    }
    if (q.type === 'mc') {
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 1 || n > q.choices.length) {
        skipped.push(q.order_index + 1);
        continue;
      }
      const choices = q.choices.map((c, i) => ({ text: c.text, is_correct: i === n - 1 }));
      await repo.setChoices(q.id, choices);
      applied.push(q.order_index + 1);
    } else {
      const answers = raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (answers.length === 0) {
        skipped.push(q.order_index + 1);
        continue;
      }
      await repo.setShortAnswer(q.id, answers);
      applied.push(q.order_index + 1);
    }
  }

  res.json({ exam: await repo.getExamFull(examId), applied, skipped });
});
