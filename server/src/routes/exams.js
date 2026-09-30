import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { Jimp } from 'jimp';
import { config } from '../config.js';
import * as repo from '../db/repo.js';
import { upload } from '../middleware/upload.js';
import { getStandardByCode } from '../services/curriculumStandards.js';
import { sanitizeKeywordRubric } from '../services/keywordGrading.js';
import { requireAuth } from '../middleware/auth.js';

export const examsRouter = Router();

export async function getExamRow(id) {
  return repo.getExam(id);
}

export async function getExamFull(id) {
  return repo.getExamFull(id);
}

// ---- 시험 CRUD ----

examsRouter.get('/', requireAuth, async (_req, res) => {
  res.json(await repo.listExams());
});

examsRouter.post('/', requireAuth, async (req, res) => {
  const { title, subject_id, grade_cluster, time_limit_sec } = req.body;
  const mode = req.body.mode === 'paper_marking' ? 'paper_marking' : 'online';
  if (!title || !subject_id || !grade_cluster || !Number.isInteger(time_limit_sec)) {
    return res.status(400).json({ error: 'title, subject_id, grade_cluster, time_limit_sec가 모두 필요합니다.' });
  }
  const id = await repo.createExam({ title, subject_id, grade_cluster, time_limit_sec, mode });
  res.status(201).json(await repo.getExamFull(id));
});

// 학생이 시험 참여 화면에서 "응시 가능한 시험"을 고를 때 쓴다 - 로그인 없이 봐야 하므로
// 이 라우터의 다른 라우트와 달리 requireAuth를 붙이지 않는다. 그래서 교사 메모(memo)나
// 아직 확정 전(draft)/숨긴(archived) 시험처럼 학생에게 필요 없는 정보는 아예 빼고 내려준다.
// (GET /:id 보다 먼저 등록해야 한다 - 안 그러면 '/for-student'가 :id로 잡혀서 이 라우트에
// 닿기 전에 위의 로그인 검사에 걸린다.)
examsRouter.get('/for-student', async (_req, res) => {
  const exams = await repo.listSupervisedExams();
  res.json(
    exams.map((e) => ({
        id: e.id,
        title: e.title,
        subject_id: e.subject_id,
        grade_cluster: e.grade_cluster,
        time_limit_sec: e.time_limit_sec,
        mode: e.mode,
      })),
  );
});

examsRouter.post('/:id/supervise', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const exam = await repo.getExam(id);
  if (!exam || exam.status !== 'finalized' || exam.ends_at) {
    return res.status(400).json({ error: '확정된 시험만 감독할 수 있습니다.' });
  }
  await repo.superviseExam(id);
  res.json(await repo.getExam(id));
});

examsRouter.post('/:id/admission-code', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const exam = await repo.getExam(id);
  if (!exam || exam.status !== 'finalized' || !exam.supervised_at || exam.ends_at) {
    return res.status(400).json({ error: '감독 중인 시험의 코드만 변경할 수 있습니다.' });
  }
  const admissionCode = await repo.regenerateAdmissionCode(id);
  res.json({ admission_code: admissionCode });
});

examsRouter.get('/:id', requireAuth, async (req, res) => {
  const exam = await repo.getExamFull(Number(req.params.id));
  if (!exam) return res.status(404).json({ error: '시험을 찾을 수 없습니다.' });
  res.json(exam);
});

examsRouter.put('/:id', requireAuth, async (req, res) => {
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

// 관리 화면에서만 쓰는 교사용 메모(학생에게는 노출 안 됨) - 제목은 자유롭게 두고
// 쌓인 시험지를 구분할 짧은 설명만 따로 붙일 수 있게 한다.
examsRouter.put('/:id/memo', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const exam = await repo.getExam(id);
  if (!exam) return res.status(404).json({ error: '시험을 찾을 수 없습니다.' });

  const memo = typeof req.body.memo === 'string' ? req.body.memo.slice(0, 200) : '';
  await repo.setExamMemo(id, memo || null);
  res.json(await repo.getExamFull(id));
});

// 시험지 삭제: 실제로는 보관(archived) 처리만 해서 목록에서 감추고, 이미 쌓인 학생
// 응시 결과(exam_sessions/answers)는 그대로 남겨 시험별 리포트에서 계속 볼 수 있게 한다.
examsRouter.delete('/:id', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const exam = await repo.getExam(id);
  if (!exam) return res.status(404).json({ error: '시험을 찾을 수 없습니다.' });

  await repo.archiveExam(id);
  res.status(204).end();
});

// 숨기기 취소("다시 보이기") - 목록에서 다시 보이도록 숨기기 전 상태로 복원한다.
examsRouter.post('/:id/unarchive', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const exam = await repo.getExam(id);
  if (!exam) return res.status(404).json({ error: '시험을 찾을 수 없습니다.' });
  if (exam.status !== 'archived') return res.status(400).json({ error: '숨겨진 시험이 아닙니다.' });

  await repo.unarchiveExam(id);
  res.json(await repo.getExamFull(id));
});

// 시험별 리포트 화면에서 쓰는 진짜 영구 삭제. 응시 기록까지 전부 사라지므로 되돌릴 수
// 없다 - 테스트/오입력 등으로 남은 필요 없는 시험을 완전히 치울 때만 쓴다.
examsRouter.delete('/:id/permanent', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const exam = await repo.getExam(id);
  if (!exam) return res.status(404).json({ error: '시험을 찾을 수 없습니다.' });

  await repo.hardDeleteExam(id);
  // 원본 페이지는 여러 문항이 공유하므로 문항 하나를 지울 때는 보존하고, 시험을 영구
  // 삭제할 때 시험 전용 폴더를 함께 정리한다. 보관(숨기기)에서는 복구를 위해 유지한다.
  const sourceDir = path.resolve(config.uploadsDir, 'sources', String(id));
  const sourceRoot = path.resolve(config.uploadsDir, 'sources');
  if (sourceDir.startsWith(`${sourceRoot}${path.sep}`)) {
    fs.rm(sourceDir, { recursive: true, force: true }, () => {});
  }
  res.status(204).end();
});

// ---- 문항 CRUD ----

examsRouter.post('/:id/questions', requireAuth, async (req, res) => {
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
examsRouter.post('/:id/questions/batch', requireAuth, async (req, res) => {
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
examsRouter.put('/:id/questions/reorder', requireAuth, async (req, res) => {
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

examsRouter.put('/:id/questions/:qid', requireAuth, async (req, res) => {
  const examId = Number(req.params.id);
  const qid = Number(req.params.qid);
  const question = await getQuestionOr404(examId, qid, res);
  if (!question) return;

  const prompt = req.body.prompt ?? question.prompt;
  const points = req.body.points ?? question.points;
  // 유형 변경은 이미 답한 학생이 있는지 확인하는 /kind 경로에서만 한다.
  const type = question.type;
  const multiSelect =
    typeof req.body.multi_select === 'boolean' ? req.body.multi_select : Boolean(question.multi_select);
  const showPromptText =
    typeof req.body.show_prompt_text === 'boolean' ? req.body.show_prompt_text : Boolean(question.show_prompt_text);

  await repo.updateQuestion(examId, qid, { prompt, points, type, multiSelect, showPromptText });
  const full = await repo.getExamFull(examId);
  res.json(full.questions.find((q) => q.id === qid));
});

examsRouter.delete('/:id/questions/:qid', requireAuth, async (req, res) => {
  const examId = Number(req.params.id);
  const qid = Number(req.params.qid);
  await repo.deleteQuestion(examId, qid);
  res.json(await repo.getExamFull(examId));
});

// AI 분석 당시의 시험지 페이지를 재자르기 화면에 제공한다. 전체 시험지 원본은 학생용
// /uploads 정적 경로로 공개하지 않고, 시험/문항 소유 관계와 교사 로그인을 모두 확인한다.
examsRouter.get('/:id/questions/:qid/source-image', requireAuth, async (req, res) => {
  const examId = Number(req.params.id);
  const qid = Number(req.params.qid);
  const question = await getQuestionOr404(examId, qid, res);
  if (!question) return;
  if (!question.source_image_path) {
    return res.status(404).json({ error: '저장된 원본 페이지가 없습니다.' });
  }

  const sourceRoot = path.resolve(config.uploadsDir, 'sources');
  const sourcePath = path.resolve(config.uploadsDir, question.source_image_path);
  if (!sourcePath.startsWith(`${sourceRoot}${path.sep}`) || !fs.existsSync(sourcePath)) {
    return res.status(404).json({ error: '저장된 원본 페이지를 찾을 수 없습니다.' });
  }
  res.sendFile(sourcePath);
});

// 문항 이미지 재크롭: AI가 자동으로 잘라준 이미지가 잘못됐을 때, 교사가 브라우저에서
// 저장된 원본 페이지 또는 교사가 직접 고른 파일에서 영역을 선택해 자른 결과(PNG)를 받는다.
examsRouter.post('/:id/questions/:qid/prompt-image', requireAuth, upload.single('image'), async (req, res) => {
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
  } else if (question.prompt.trim()) {
    // 텍스트로 쓰던 문항에 처음 붙인 이미지는 그림 자료로 본다 - 문제 설명이 사라지지 않게.
    await repo.keepPromptTextWithImage(qid, question.prompt);
  }

  const full = await repo.getExamFull(examId);
  res.json(full.questions.find((q) => q.id === qid));
});

// 문항 이미지를 떼어낸다. 이후엔 텍스트 문제 설명만 학생 화면에 보인다.
examsRouter.delete('/:id/questions/:qid/prompt-image', requireAuth, async (req, res) => {
  const examId = Number(req.params.id);
  const qid = Number(req.params.qid);
  const question = await getQuestionOr404(examId, qid, res);
  if (!question) return;

  const oldPath = question.prompt_image_path;
  await repo.setPromptImage(qid, null);
  if (oldPath) {
    fs.rm(path.join(config.uploadsDir, oldPath), { force: true }, () => {});
  }

  const full = await repo.getExamFull(examId);
  res.json(full.questions.find((q) => q.id === qid));
});

// ---- 보기(객관식) ----

examsRouter.put('/:id/questions/:qid/choices', requireAuth, async (req, res) => {
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

examsRouter.put('/:id/questions/:qid/answer', requireAuth, async (req, res) => {
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

// ---- 문항 유형 바꾸기 ----

examsRouter.put('/:id/questions/:qid/kind', requireAuth, async (req, res) => {
  const examId = Number(req.params.id);
  const qid = Number(req.params.qid);
  const question = await getQuestionOr404(examId, qid, res);
  if (!question) return;

  const kind = req.body?.kind;
  if (!['mc', 'short', 'essay'].includes(kind)) {
    return res.status(400).json({ error: '문항 유형은 객관식, 단답형, 서술형 중 하나여야 합니다.' });
  }
  // 이미 학생이 답한 문항은 저장된 답(보기 선택/글 답안)과 채점 결과가 유형과 어긋나게 된다.
  if ((await repo.countAnswersForQuestion(qid)) > 0) {
    return res.status(409).json({ error: '이미 학생이 답한 문항은 유형을 바꿀 수 없습니다.' });
  }

  await repo.changeQuestionKind(qid, kind);
  const full = await repo.getExamFull(examId);
  res.json(full.questions.find((q) => q.id === qid));
});

// ---- 서술형(키워드 채점) 기준 ----

examsRouter.put('/:id/questions/:qid/keyword-grading', requireAuth, async (req, res) => {
  const examId = Number(req.params.id);
  const qid = Number(req.params.qid);
  const question = await getQuestionOr404(examId, qid, res);
  if (!question) return;
  if (question.type !== 'short') {
    return res.status(400).json({ error: '단답형 문항만 서술형 채점을 쓸 수 있습니다.' });
  }

  const gradingMode = req.body?.grading_mode === 'keyword' ? 'keyword' : 'exact';
  // 채점 방식만 바꿀 때는 기존 기준을 지우지 않는다(다시 켜면 그대로 돌아오도록).
  const rubric = Array.isArray(req.body?.keyword_rubric)
    ? sanitizeKeywordRubric(req.body.keyword_rubric)
    : (await repo.getExamFull(examId)).questions.find((q) => q.id === qid).keyword_rubric;

  await repo.setKeywordGrading(qid, gradingMode, rubric);
  const full = await repo.getExamFull(examId);
  res.json(full.questions.find((q) => q.id === qid));
});

// ---- 성취기준 태깅 ----

examsRouter.put('/:id/questions/:qid/standards', requireAuth, async (req, res) => {
  const examId = Number(req.params.id);
  const qid = Number(req.params.qid);
  const question = await getQuestionOr404(examId, qid, res);
  if (!question) return;

  const { codes } = req.body; // string[]
  if (!Array.isArray(codes)) {
    return res.status(400).json({ error: 'codes 배열이 필요합니다.' });
  }

  // 교육과정 데이터에서 빠진 성취기준으로 예전에 태그해 둔 문항은, 태그를 고칠 때 그 코드를
  // 조용히 떼어낸다. 목록에 없는 코드를 새로 붙이려는 경우만 거부한다.
  const existingCodes = (await repo.getExamFull(examId)).questions
    .find((q) => q.id === qid)
    .standards.map((s) => s.standard_code);
  const unknown = codes.filter((code) => !getStandardByCode(code) && !existingCodes.includes(code));
  if (unknown.length > 0) {
    return res.status(400).json({ error: '알 수 없는 성취기준 코드입니다.', unknown });
  }

  await repo.setStandards(qid, codes.filter((code) => getStandardByCode(code)));
  const full = await repo.getExamFull(examId);
  res.json(full.questions.find((q) => q.id === qid));
});

// ---- 확정(finalize) ----

examsRouter.post('/:id/finalize', requireAuth, async (req, res) => {
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
      if (!q.multi_select && q.choices.filter((c) => c.is_correct).length > 1) {
        reasons.push('정답이 여러 개입니다. "모두 고르기"를 켜거나 정답을 하나만 남겨주세요.');
      }
    } else if (q.type === 'short' && q.grading_mode === 'keyword') {
      if (q.keyword_rubric.length === 0) reasons.push('서술형 채점 키워드가 설정되지 않았습니다.');
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
