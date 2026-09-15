import { Router } from 'express';
import * as repo from '../db/repo.js';
import { upload } from '../middleware/upload.js';
import { extractQuestionsFromImage } from '../services/aiExtraction.js';
import { cropQuestionImages } from '../services/cropQuestionImages.js';
import { renderPdfToImages } from '../services/renderPdfPages.js';

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

aiRouter.post('/:id/ai-extract', upload.single('file'), async (req, res) => {
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
