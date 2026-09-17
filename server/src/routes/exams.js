import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { Jimp } from 'jimp';
import { config } from '../config.js';
import * as repo from '../db/repo.js';
import { upload } from '../middleware/upload.js';
import { getStandardByCode } from '../services/curriculumStandards.js';

export const examsRouter = Router();

export async function getExamRow(id) {
  return repo.getExam(id);
}

export async function getExamFull(id) {
  return repo.getExamFull(id);
}

// ---- 시험 CRUD ----

examsRouter.get('/', async (_req, res) => {
  res.json(await repo.listExams());
});

examsRouter.post('/', async (req, res) => {
  const { title, subject_id, grade_cluster, time_limit_sec } = req.body;
  const mode = req.body.mode === 'paper_marking' ? 'paper_marking' : 'online';
  if (!title || !subject_id || !grade_cluster || !Number.isInteger(time_limit_sec)) {
    return res.status(400).json({ error: 'title, subject_id, grade_cluster, time_limit_sec가 모두 필요합니다.' });
  }
  const id = await repo.createExam({ title, subject_id, grade_cluster, time_limit_sec, mode });
  res.status(201).json(await repo.getExamFull(id));
});

examsRouter.get('/:id', async (req, res) => {
  const exam = await repo.getExamFull(Number(req.params.id));
  if (!exam) return res.status(404).json({ error: '시험을 찾을 수 없습니다.' });
  res.json(exam);
});

examsRouter.put('/:id', async (req, res) => {
  const id = Number(req.params.id);
  const exam = await repo.getExam(id);
  if (!exam) return res.status(404).json({ error: '시험을 찾을 수 없습니다.' });

  const title = req.body.title ?? exam.title;
  const subject_id = req.body.subject_id ?? exam.subject_id;
  const grade_cluster = req.body.grade_cluster ?? exam.grade_cluster;
  const time_limit_sec = req.body.time_limit_sec ?? exam.time_limit_sec;
  const mode = req.body.mode ?? exam.mode;

  await repo.updateExam(id, { title, subject_id, grade_cluster, time_limit_sec, mode });
  res.json(await repo.getExamFull(id));
});

// 시험지 삭제: 실제로는 보관(archived) 처리만 해서 목록에서 감추고, 이미 쌓인 학생
// 응시 결과(exam_sessions/answers)는 그대로 남겨 시험별 리포트에서 계속 볼 수 있게 한다.
examsRouter.delete('/:id', async (req, res) => {
  const id = Number(req.params.id);
  const exam = await repo.getExam(id);
  if (!exam) return res.status(404).json({ error: '시험을 찾을 수 없습니다.' });

  await repo.archiveExam(id);
  res.status(204).end();
});

// 시험별 리포트 화면에서 쓰는 진짜 영구 삭제. 응시 기록까지 전부 사라지므로 되돌릴 수
// 없다 - 테스트/오입력 등으로 남은 필요 없는 시험을 완전히 치울 때만 쓴다.
examsRouter.delete('/:id/permanent', async (req, res) => {
  const id = Number(req.params.id);
  const exam = await repo.getExam(id);
  if (!exam) return res.status(404).json({ error: '시험을 찾을 수 없습니다.' });

  await repo.hardDeleteExam(id);
  res.status(204).end();
});

// ---- 문항 CRUD ----

examsRouter.post('/:id/questions', async (req, res) => {
  const examId = Number(req.params.id);
  const exam = await repo.getExam(examId);
  if (!exam) return res.status(404).json({ error: '시험을 찾을 수 없습니다.' });

  const { type, points } = req.body;
  const prompt = req.body.prompt ?? '';
  if (!['mc', 'short'].includes(type)) {
    return res.status(400).json({ error: "type은 'mc' 또는 'short'여야 합니다." });
  }

  const newId = await repo.addQuestion(examId, { type, prompt, points });
  const full = await repo.getExamFull(examId);
  res.status(201).json(full.questions.find((q) => q.id === newId));
});

// 종이 시험지 "틀 만들기": 객관식(4/5지선다)·단답형 개수만 받아 한 번에 문항을 생성한다.
// 정답은 아직 정하지 않는다 - 이후 "정답 입력" 단계에서 채운다.
examsRouter.post('/:id/questions/batch', async (req, res) => {
  const examId = Number(req.params.id);
  const exam = await repo.getExam(examId);
  if (!exam) return res.status(404).json({ error: '시험을 찾을 수 없습니다.' });

  const mc4 = Number.isInteger(req.body.mc4) ? req.body.mc4 : 0;
  const mc5 = Number.isInteger(req.body.mc5) ? req.body.mc5 : 0;
  const short = Number.isInteger(req.body.short) ? req.body.short : 0;
  if (mc4 < 0 || mc5 < 0 || short < 0 || mc4 + mc5 + short === 0) {
    return res.status(400).json({ error: '만들 문항 수를 1개 이상 입력해주세요.' });
  }

  await repo.batchCreateQuestions(examId, { mc4, mc5, short });
  res.status(201).json(await repo.getExamFull(examId));
});

// 문항 순서를 드래그로 바꾼 뒤 저장. order는 이 시험의 문항 id를 새 순서로 나열한 배열.
examsRouter.put('/:id/questions/reorder', async (req, res) => {
  const examId = Number(req.params.id);
  const exam = await repo.getExam(examId);
  if (!exam) return res.status(404).json({ error: '시험을 찾을 수 없습니다.' });

  const { order } = req.body;
  const currentIds = new Set(await repo.getQuestionIds(examId));

  if (
    !Array.isArray(order) ||
    order.length !== currentIds.size ||
    !order.every((id) => currentIds.has(id))
  ) {
    return res.status(400).json({ error: '순서 목록이 이 시험의 문항 구성과 일치하지 않습니다.' });
  }

  await repo.reorderQuestions(examId, order);
  res.json(await repo.getExamFull(examId));
});

async function getQuestionOr404(examId, questionId, res) {
  const q = await repo.getQuestion(examId, questionId);
  if (!q) res.status(404).json({ error: '문항을 찾을 수 없습니다.' });
  return q;
}

examsRouter.put('/:id/questions/:qid', async (req, res) => {
  const examId = Number(req.params.id);
  const qid = Number(req.params.qid);
  const question = await getQuestionOr404(examId, qid, res);
  if (!question) return;

  const prompt = req.body.prompt ?? question.prompt;
  const points = req.body.points ?? question.points;
  const type = req.body.type ?? question.type;

  await repo.updateQuestion(examId, qid, { prompt, points, type });
  const full = await repo.getExamFull(examId);
  res.json(full.questions.find((q) => q.id === qid));
});

examsRouter.delete('/:id/questions/:qid', async (req, res) => {
  const examId = Number(req.params.id);
  const qid = Number(req.params.qid);
  await repo.deleteQuestion(examId, qid);
  res.json(await repo.getExamFull(examId));
});

// 문항 이미지 재크롭: AI가 자동으로 잘라준 이미지가 잘못됐을 때, 교사가 브라우저에서
// 원본 PDF/이미지를 다시 골라 영역을 선택해 자른 결과(PNG)만 여기로 올린다. 원본 파일
// 자체는 서버로 전송되지 않고 클라이언트에서 이미 잘린 이미지만 받으므로, 서버가 시험지
// 원본을 계속 보관할 필요가 없다.
examsRouter.post('/:id/questions/:qid/prompt-image', upload.single('image'), async (req, res) => {
  const examId = Number(req.params.id);
  const qid = Number(req.params.qid);
  const question = await getQuestionOr404(examId, qid, res);
  if (!question) return;
  if (!req.file) return res.status(400).json({ error: '이미지 파일이 필요합니다.' });

  let image;
  try {
    image = await Jimp.read(req.file.buffer);
  } catch {
    return res.status(400).json({ error: '이미지를 읽을 수 없습니다.' });
  }

  const dir = path.join(config.uploadsDir, 'questions');
  fs.mkdirSync(dir, { recursive: true });
  const filename = `${crypto.randomUUID()}.png`;
  await image.write(path.join(dir, filename));

  const oldPath = question.prompt_image_path;
  await repo.setPromptImage(qid, `questions/${filename}`);
  if (oldPath) {
    fs.rm(path.join(config.uploadsDir, oldPath), { force: true }, () => {});
  }

  const full = await repo.getExamFull(examId);
  res.json(full.questions.find((q) => q.id === qid));
});

// ---- 보기(객관식) ----

examsRouter.put('/:id/questions/:qid/choices', async (req, res) => {
  const examId = Number(req.params.id);
  const qid = Number(req.params.qid);
  const question = await getQuestionOr404(examId, qid, res);
  if (!question) return;

  const { choices } = req.body; // [{text, is_correct}]
  if (!Array.isArray(choices) || choices.length === 0) {
    return res.status(400).json({ error: 'choices 배열이 필요합니다.' });
  }

  await repo.setChoices(qid, choices);
  const full = await repo.getExamFull(examId);
  res.json(full.questions.find((q) => q.id === qid));
});

// ---- 정답(단답형) ----

examsRouter.put('/:id/questions/:qid/answer', async (req, res) => {
  const examId = Number(req.params.id);
  const qid = Number(req.params.qid);
  const question = await getQuestionOr404(examId, qid, res);
  if (!question) return;

  const { correct_short_answers } = req.body; // string[]
  if (!Array.isArray(correct_short_answers) || correct_short_answers.length === 0) {
    return res.status(400).json({ error: 'correct_short_answers 배열이 필요합니다.' });
  }

  await repo.setShortAnswer(qid, correct_short_answers);
  const full = await repo.getExamFull(examId);
  res.json(full.questions.find((q) => q.id === qid));
});

// ---- 성취기준 태깅 ----

examsRouter.put('/:id/questions/:qid/standards', async (req, res) => {
  const examId = Number(req.params.id);
  const qid = Number(req.params.qid);
  const question = await getQuestionOr404(examId, qid, res);
  if (!question) return;

  const { codes } = req.body; // string[]
  if (!Array.isArray(codes)) {
    return res.status(400).json({ error: 'codes 배열이 필요합니다.' });
  }

  const unknown = codes.filter((code) => !getStandardByCode(code));
  if (unknown.length > 0) {
    return res.status(400).json({ error: '알 수 없는 성취기준 코드입니다.', unknown });
  }

  await repo.setStandards(qid, codes);
  const full = await repo.getExamFull(examId);
  res.json(full.questions.find((q) => q.id === qid));
});

// ---- 확정(finalize) ----

examsRouter.post('/:id/finalize', async (req, res) => {
  const examId = Number(req.params.id);
  const exam = await repo.getExamFull(examId);
  if (!exam) return res.status(404).json({ error: '시험을 찾을 수 없습니다.' });

  if (exam.questions.length === 0) {
    return res.status(400).json({ error: '문항이 1개 이상 있어야 합니다.', missing: [] });
  }

  const missing = [];
  for (const q of exam.questions) {
    const reasons = [];
    // 온라인 모드는 학생 화면에 문제를 그대로 보여주므로 내용이 비어 있으면 안 되지만,
    // 종이 마킹 모드는 학생이 종이 시험지를 보므로 문제 내용은 선택 사항이다.
    if (exam.mode === 'online' && !q.prompt.trim() && !q.prompt_image_path) {
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
    // AI가 불러온 문항은 AI가 제안한 성취기준을 교사가 실제로 확인·확정했는지 보장하기
    // 위해 태깅을 필수로 한다. 직접 만든 문항은 채점/시간 로깅만 원할 수도 있으므로 선택.
    if (q.ai_suggested && q.standards.length === 0) {
      reasons.push('AI로 불러온 문항은 성취기준이 1개 이상 태깅되어야 합니다.');
    }

    if (reasons.length > 0) {
      missing.push({ question_id: q.id, order_index: q.order_index, reasons });
    }
  }

  if (missing.length > 0) {
    return res.status(400).json({ error: '완성되지 않은 문항이 있습니다.', missing });
  }

  await repo.finalizeExam(examId);
  res.json(await repo.getExamFull(examId));
});
