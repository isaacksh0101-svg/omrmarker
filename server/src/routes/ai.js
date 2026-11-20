import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { config } from '../config.js';
import * as repo from '../db/repo.js';
import { upload } from '../middleware/upload.js';
import {
  extractAnswerKeyFromDocumentText,
  extractAnswerKeyFromImage,
  extractQuestionsFromDocumentText,
  extractQuestionsFromImage,
} from '../services/aiExtraction.js';
import { cropQuestionImages } from '../services/cropQuestionImages.js';
import { prepareAiImage } from '../services/prepareAiImage.js';
import { renderPdfToImages } from '../services/renderPdfPages.js';
import { requireAuth } from '../middleware/auth.js';
import { sanitizeKeywordRubric } from '../services/keywordGrading.js';
import { parseDocumentWithUpstage } from '../services/upstageDocumentParse.js';

export const aiRouter = Router();

const SOURCE_EXTENSION = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

function saveSourcePage(examId, imageBuffer, mimeType) {
  const extension = SOURCE_EXTENSION[mimeType] || 'png';
  const relativeDir = path.join('sources', String(examId));
  const filename = `${crypto.randomUUID()}.${extension}`;
  const absoluteDir = path.join(config.uploadsDir, relativeDir);
  fs.mkdirSync(absoluteDir, { recursive: true });
  fs.writeFileSync(path.join(absoluteDir, filename), imageBuffer);
  return path.join(relativeDir, filename).replaceAll('\\', '/');
}

// 이미지 한 장(래스터 또는 PDF 한 쪽을 렌더링한 PNG)에 대해 AI 추출 + 발문 이미지 자르기를
// 수행한다. PDF는 여러 쪽일 수 있어 이 함수를 쪽마다 반복 호출한다.
async function extractFromSingleImage(imageBuffer, mimeType, exam, orderOffset, sourceImagePath, documentText = '') {
  const aiImage = await prepareAiImage(imageBuffer, mimeType);
  const extracted = await extractQuestionsFromImage({
    imageBase64: aiImage.buffer.toString('base64'),
    mimeType: aiImage.mimeType,
    subjectId: exam.subject_id,
    gradeCluster: exam.grade_cluster,
    documentText,
  });
  const withImages = await cropQuestionImages(imageBuffer, mimeType, extracted.questions);
  return withImages.map((q, i) => ({
    ...q,
    order_index: orderOffset + i,
    source_image_path: sourceImagePath,
  }));
}

// Upstage 경로는 이미지를 자동으로 자르지 않는다 - Solar Pro는 텍스트만 보므로 어떤
// 방식으로도 정확한 문항 영역을 알아낼 수 없다. 대신 문항 내용을 전부 텍스트(수식 포함)로
// 옮겨 적고, 도형·표·그래프처럼 텍스트로 옮기기 어려운 문항만 교사가 문항 편집 화면에서
// "+ 원본에서 이미지 잘라오기"로 수동으로 채운다(source_image_path에 저장해 둔 원본
// 페이지를 그대로 쓴다).
async function extractFromUpstageDocument(parsedDocument, exam, orderOffset, sourceImagePath) {
  const extracted = await extractQuestionsFromDocumentText({
    documentText: parsedDocument.text,
    subjectId: exam.subject_id,
    gradeCluster: exam.grade_cluster,
  });
  return extracted.questions.map((question, index) => ({
    ...question,
    order_index: orderOffset + index,
    source_image_path: sourceImagePath,
  }));
}

aiRouter.post('/:id/ai-extract', requireAuth, upload.single('file'), async (req, res) => {
  const examId = Number(req.params.id);
  const exam = await repo.getExam(examId);
  if (!exam) return res.status(404).json({ error: '시험을 찾을 수 없습니다.' });
  if (!req.file) return res.status(400).json({ error: '이미지 파일이 필요합니다.' });

  let allQuestions;
  try {
    const useUpstage = req.body?.provider === 'upstage';
    const parsedDocument = useUpstage && req.file.mimetype !== 'application/pdf'
      ? await parseDocumentWithUpstage(req.file.buffer, req.file.mimetype, req.file.originalname)
      : null;
    if (req.file.mimetype === 'application/pdf') {
      // PDF는 원본에서 바로 잘라낼 수 없으니(래스터화 라이브러리가 없으면), 먼저 쪽마다
      // PNG로 렌더링해서 그 뒤로는 이미지 업로드와 완전히 같은 경로를 태운다.
      const pageImages = await renderPdfToImages(req.file.buffer);
      allQuestions = [];
      for (const [pageIndex, pageImage] of pageImages.entries()) {
        const sourceImagePath = saveSourcePage(examId, pageImage, 'image/png');
        const pageDocument = useUpstage
          ? await parseDocumentWithUpstage(pageImage, 'image/png', `${req.file.originalname}-page-${pageIndex + 1}.png`)
          : '';
        const pageQuestions = useUpstage
          ? await extractFromUpstageDocument(pageDocument, exam, allQuestions.length, sourceImagePath)
          : await extractFromSingleImage(pageImage, 'image/png', exam, allQuestions.length, sourceImagePath);
        allQuestions = allQuestions.concat(pageQuestions);
      }
    } else {
      const sourceImagePath = saveSourcePage(examId, req.file.buffer, req.file.mimetype);
      allQuestions = useUpstage
        ? await extractFromUpstageDocument(parsedDocument, exam, 0, sourceImagePath)
        : await extractFromSingleImage(req.file.buffer, req.file.mimetype, exam, 0, sourceImagePath);
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
  const aiImage = await prepareAiImage(imageBuffer, mimeType);
  return extractAnswerKeyFromImage({
    imageBase64: aiImage.buffer.toString('base64'),
    mimeType: aiImage.mimeType,
    questions: questionInfos,
  });
}

async function extractAnswersFromUpstageDocument(imageBuffer, mimeType, filename, questionInfos) {
  const parsedDocument = await parseDocumentWithUpstage(imageBuffer, mimeType, filename);
  return extractAnswerKeyFromDocumentText({ documentText: parsedDocument.text, questions: questionInfos });
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
    essay: q.type === 'short' && q.grading_mode === 'keyword',
    numChoices: q.choices.length,
  }));

  let extractedAnswers;
  try {
    const useUpstage = req.body?.provider === 'upstage';
    if (req.file.mimetype === 'application/pdf') {
      const pageImages = await renderPdfToImages(req.file.buffer);
      extractedAnswers = [];
      for (const [pageIndex, pageImage] of pageImages.entries()) {
        const pageAnswers = useUpstage
          ? await extractAnswersFromUpstageDocument(
              pageImage,
              'image/png',
              `${req.file.originalname}-page-${pageIndex + 1}.png`,
              questionInfos,
            )
          : await extractAnswersFromSingleImage(pageImage, 'image/png', questionInfos);
        extractedAnswers = extractedAnswers.concat(pageAnswers);
      }
    } else {
      extractedAnswers = useUpstage
        ? await extractAnswersFromUpstageDocument(req.file.buffer, req.file.mimetype, req.file.originalname, questionInfos)
        : await extractAnswersFromSingleImage(req.file.buffer, req.file.mimetype, questionInfos);
    }
  } catch (e) {
    return res.status(502).json({ error: `AI 추출 실패: ${e.message}` });
  }

  // 같은 문항 번호가 여러 쪽에 걸쳐 나오는 일은 없다고 보고, 나중 값이 있으면 그걸로 덮는다.
  const byNumber = new Map(extractedAnswers.map((a) => [a.question_number, a]));
  const applied = [];
  const skipped = [];
  // 서술형 결과는 따로 알려준다 - AI가 추천한 키워드는 교사가 꼭 확인해야 하고, 이미 교사가
  // 입력해 둔 키워드는 덮어쓰지 않는다.
  const keywordSuggested = [];
  const keywordKept = [];

  for (const q of exam.questions) {
    const extracted = byNumber.get(q.order_index + 1);
    if (q.type === 'short' && q.grading_mode === 'keyword') {
      if (q.keyword_rubric.length > 0) {
        keywordKept.push(q.order_index + 1);
        continue;
      }
      // 한 글자 표현("빛" 등)은 다른 낱말에 섞여 잘못 인정되기 쉬워 AI 추천에서는 뺀다
      // (교사가 필요하면 직접 넣을 수 있다).
      const rubric = sanitizeKeywordRubric(
        (extracted?.keyword_groups ?? []).map((keywords) => ({
          keywords: keywords.filter((k) => k.replace(/\s+/g, '').length >= 2),
          weight: 1,
        })),
      );
      if (rubric.length === 0) {
        skipped.push(q.order_index + 1);
        continue;
      }
      await repo.setKeywordGrading(q.id, 'keyword', rubric);
      keywordSuggested.push(q.order_index + 1);
      continue;
    }
    const raw = extracted?.answer;
    if (!raw) {
      skipped.push(q.order_index + 1);
      continue;
    }
    if (q.type === 'mc') {
      // "2, 4"처럼 정답 번호가 여러 개면 "모두 고르기" 문항으로 보고 자동으로 켠다.
      const numbers = [...new Set(String(raw).split(/[,\s]+/).filter(Boolean).map(Number))];
      if (numbers.length === 0 || numbers.some((n) => !Number.isInteger(n) || n < 1 || n > q.choices.length)) {
        skipped.push(q.order_index + 1);
        continue;
      }
      const choices = q.choices.map((c, i) => ({ text: c.text, is_correct: numbers.includes(i + 1) }));
      await repo.setChoices(q.id, choices);
      if (numbers.length > 1 && !q.multi_select) await repo.setMultiSelect(q.id, true);
      applied.push(q.order_index + 1);
    } else {
      // 복수 인정 답안은 | 로 구분한다. 쉼표는 "8, 1.7"처럼 소문항 답을 묶은 정답의 일부다.
      const answers = raw
        .split('|')
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

  res.json({
    exam: await repo.getExamFull(examId),
    applied,
    skipped,
    keyword_suggested: keywordSuggested,
    keyword_kept: keywordKept,
  });
});
