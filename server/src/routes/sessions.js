import { Router } from 'express';
import * as repo from '../db/repo.js';
import { config } from '../config.js';
import { emitExamMonitorUpdate } from '../lib/realtime.js';
import { requireAuth } from '../middleware/auth.js';
import {
  attachQuestionInsights,
  attachQuestionStudentInsights,
  attachSessionInsights,
} from '../services/assessmentInsights.js';
import {
  gradeKeywordAnswer,
  keywordAnswerNeedsReview,
  keywordAwardedPoints,
  parseKeywordRubric,
} from '../services/keywordGrading.js';

export const sessionsRouter = Router();

const failedCodeAttempts = new Map();
const MAX_CODE_ATTEMPTS = 5;
const CODE_BLOCK_MS = 5 * 60 * 1000;

function now() {
  return new Date().toISOString();
}

function sanitizeQuestionForStudent(q, examMode) {
  return {
    id: q.id,
    order_index: q.order_index,
    type: q.type,
    prompt: examMode === 'paper_marking' ? '' : q.prompt,
    prompt_image_path: examMode === 'paper_marking' ? null : q.prompt_image_path,
    // 이미지가 그림 자료일 뿐이면 문제 설명 텍스트도 함께 보여준다.
    show_prompt_text: Boolean(q.show_prompt_text),
    points: q.points,
    multi_select: Boolean(q.multi_select),
    // 서술형이면 학생 화면이 여러 줄 입력칸을 보여준다(채점 키워드는 보내지 않는다).
    essay: isKeywordQuestion(q),
    // 종이 마킹 모드는 학생이 종이 시험지를 보고 번호만 고르므로 보기 문구를 보내지 않는다.
    choices: q.choices.map((c, i) => ({
      id: c.id,
      order_index: c.order_index,
      text: examMode === 'paper_marking' ? String(i + 1) : c.text,
    })),
  };
}

// 객관식 채점. 한 개만 고르는 문항은 selected_choice_id를, "모두 고르기" 문항은
// selected_choice_ids 배열을 받아 정답 보기 집합과 정확히 일치할 때만 정답으로 본다.
// 저장용 값도 같이 돌려줘서 본시험/오답 재풀이 두 경로가 같은 규칙을 쓰게 한다.
function gradeMultipleChoice(question, body) {
  if (question.multi_select) {
    const validIds = new Set(question.choices.map((c) => c.id));
    const raw = Array.isArray(body?.selected_choice_ids) ? body.selected_choice_ids : [];
    const selectedIds = [...new Set(raw.filter((id) => Number.isInteger(id) && validIds.has(id)))];
    const correctIds = question.choices.filter((c) => c.is_correct).map((c) => c.id);
    const isCorrect =
      selectedIds.length > 0 &&
      selectedIds.length === correctIds.length &&
      correctIds.every((id) => selectedIds.includes(id));
    return { selectedChoiceId: null, selectedChoiceIds: selectedIds, isCorrect };
  }
  const selectedChoiceId = Number.isInteger(body?.selected_choice_id) ? body.selected_choice_id : null;
  const choice = question.choices.find((c) => c.id === selectedChoiceId);
  return { selectedChoiceId: choice ? selectedChoiceId : null, selectedChoiceIds: null, isCorrect: Boolean(choice?.is_correct) };
}

// 서술형 답안이 비정상적으로 길어 DB가 부풀지 않도록 넉넉한 길이에서 자른다.
const MAX_SHORT_ANSWER_LENGTH = 5000;
function readShortAnswerText(body) {
  const text = typeof body?.short_answer_text === 'string' ? body.short_answer_text : '';
  return text.slice(0, MAX_SHORT_ANSWER_LENGTH);
}

function isKeywordQuestion(q) {
  return q.type === 'short' && q.grading_mode === 'keyword';
}

// 단답형 채점. 일반 단답형은 인정 답안 중 하나와 같으면 만점, 서술형은 맞힌 키워드 그룹
// 비율만큼 부분 점수를 주고 전부 맞혔을 때만 정답(is_correct)으로 본다 - 오답 재풀이와
// 정답률 통계가 "정답/오답" 두 가지로만 돌아가기 때문이다.
function gradeShortAnswer(question, answerText) {
  if (isKeywordQuestion(question)) {
    const { ratio } = gradeKeywordAnswer(question.keyword_rubric, answerText);
    return { isCorrect: ratio === 1, awardedPoints: keywordAwardedPoints(question.points, ratio) };
  }
  const accepted = (question.correct_short_answers ?? []).map(normalizeShortAnswer);
  const isCorrect = accepted.includes(normalizeShortAnswer(answerText));
  return { isCorrect, awardedPoints: isCorrect ? question.points : 0 };
}

// 단답형 비교용 정규화. "건조 기후"와 "건조기후"처럼 띄어쓰기만 다른 답은 같은 답으로 보고,
// "건조 기후."처럼 끝에 붙은 문장부호도 무시한다. 소수점("3.5")·분수("1/2")·음수("-3")는
// 답의 일부라 건드리지 않도록 문장부호는 맨 끝에 있는 것만 뗀다.
function normalizeShortAnswer(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[.。!?~]+$/, '');
}

// 교사 화면용: 서술형 답안의 그룹별 매칭 결과와 검토 필요 여부.
function keywordReviewInfo(question, answerText, gradedByTeacher) {
  if (!isKeywordQuestion(question)) return { keyword_groups: null, needs_review: false };
  const { groups, ratio } = gradeKeywordAnswer(question.keyword_rubric, answerText);
  return {
    keyword_groups: groups,
    needs_review: !gradedByTeacher && keywordAnswerNeedsReview(ratio, answerText),
  };
}

// ---- 학생용: 시험 메타 (정답 정보 없음) ----

sessionsRouter.get('/:id/for-student', async (req, res) => {
  const exam = await repo.getExamFull(Number(req.params.id));
  if (!exam || exam.status !== 'finalized' || !exam.supervised_at || exam.ends_at) {
    return res.status(404).json({ error: '응시할 수 있는 시험을 찾을 수 없습니다.' });
  }
  res.json({
    id: exam.id,
    title: exam.title,
    subject_id: exam.subject_id,
    grade_cluster: exam.grade_cluster,
    time_limit_sec: exam.time_limit_sec,
    mode: exam.mode,
    question_count: exam.questions.length,
  });
});

sessionsRouter.get('/:id/next-for-student', async (req, res) => {
  const next = await repo.getNextSupervisedExam(Number(req.params.id));
  res.json(next);
});

// ---- 세션 참가/조회 ----

function attemptKey(req) {
  return req.socket?.remoteAddress || 'unknown';
}

function codeAttemptBlocked(req) {
  const entry = failedCodeAttempts.get(attemptKey(req));
  if (!entry) return false;
  if (entry.blockedUntil > Date.now()) return true;
  if (entry.blockedUntil) failedCodeAttempts.delete(attemptKey(req));
  return false;
}

function recordCodeFailure(req) {
  const key = attemptKey(req);
  const previous = failedCodeAttempts.get(key);
  const entry = previous && Date.now() - previous.windowStarted < CODE_BLOCK_MS
    ? previous
    : { count: 0, blockedUntil: 0, windowStarted: Date.now() };
  entry.count += 1;
  if (entry.count >= MAX_CODE_ATTEMPTS) entry.blockedUntil = Date.now() + CODE_BLOCK_MS;
  failedCodeAttempts.set(key, entry);
}

async function createOrResumeSession(exam, rollNumber, { continuation = false } = {}) {
  const student = await repo.getRosterEntry(rollNumber);
  if (!student) return { status: 400, error: '등록되지 않은 번호입니다.' };

  let session = await repo.getSessionByExamAndRoll(exam.id, rollNumber);
  if (session && (session.status === 'submitted' || session.status === 'force_submitted')) {
    return { status: 409, error: '이미 종료된 응시 기록입니다. 다시 응시하려면 선생님께 요청해주세요.' };
  }
  if (!continuation && session && (session.status === 'joined' || session.status === 'in_progress')) {
    if (!session.allow_rejoin) {
      return {
        status: 409,
        error: '이미 이 번호로 참여 중인 기기가 있습니다. 다른 기기에서 이어서 하려면 선생님께 "재참여 허용"을 요청하세요.',
      };
    }
    await repo.setAllowRejoin(session.id, false);
  }
  if (!session) {
    session = await repo.createSession(exam.id, rollNumber);
    emitExamMonitorUpdate(exam.id);
  }
  if (exam.started_at && session.status === 'joined') {
    await repo.startSession(session.id);
    session = await repo.getSession(session.id);
    emitExamMonitorUpdate(exam.id);
  }
  return { session };
}

sessionsRouter.post('/join', async (req, res) => {
  if (codeAttemptBlocked(req)) {
    return res.status(429).json({ error: '입장 코드를 여러 번 잘못 입력했습니다. 5분 후 다시 시도해주세요.' });
  }
  const admissionCode = String(req.body?.admission_code ?? '').trim();
  if (!/^\d{6}$/.test(admissionCode)) {
    recordCodeFailure(req);
    return res.status(400).json({ error: '6자리 입장 코드를 확인해주세요.' });
  }
  const exam = await repo.getSupervisedExamByAdmissionCode(admissionCode);
  if (!exam) {
    recordCodeFailure(req);
    return res.status(400).json({ error: '입장 코드가 올바르지 않거나 종료된 시험입니다.' });
  }
  failedCodeAttempts.delete(attemptKey(req));
  const rollNumber = Number(req.body?.roll_number);
  if (!Number.isInteger(rollNumber)) return res.status(400).json({ error: '번호를 입력해주세요.' });
  const result = await createOrResumeSession(exam, rollNumber);
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.status(201).json(result.session);
});

sessionsRouter.post('/review/recover', async (req, res) => {
  if (codeAttemptBlocked(req)) {
    return res.status(429).json({ error: '복구 코드를 여러 번 잘못 입력했습니다. 5분 후 다시 시도해주세요.' });
  }
  const rollNumber = Number(req.body?.roll_number);
  const code = String(req.body?.recovery_code ?? '').trim();
  if (!Number.isInteger(rollNumber) || !/^\d{6}$/.test(code)) {
    recordCodeFailure(req);
    return res.status(400).json({ error: '번호와 6자리 복구 코드를 확인해주세요.' });
  }
  const recovered = await repo.redeemReviewRecoveryCode(rollNumber, code);
  if (!recovered) {
    recordCodeFailure(req);
    return res.status(400).json({ error: '복구 코드가 올바르지 않거나 만료되었습니다.' });
  }
  failedCodeAttempts.delete(attemptKey(req));
  res.json(recovered);
});

sessionsRouter.post('/:id/advance', async (req, res) => {
  const currentExamId = Number(req.params.id);
  const currentSession = await repo.getSessionByToken(String(req.body?.access_token ?? ''));
  if (!currentSession || currentSession.exam_id !== currentExamId) {
    return res.status(404).json({ error: '이전 시험 응시 기록을 확인할 수 없습니다.' });
  }
  const completed = currentSession.status === 'submitted'
    || (currentSession.status === 'force_submitted' && currentSession.disqualify_reason === 'teacher_manual');
  if (!completed) return res.status(403).json({ error: '현재 시험을 정상적으로 마친 뒤 다음 시험에 참여할 수 있습니다.' });
  const nextExam = await repo.getNextSupervisedExam(currentExamId);
  if (!nextExam) return res.json(null);
  const result = await createOrResumeSession(nextExam, currentSession.roll_number, { continuation: true });
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.status(201).json({ exam_id: nextExam.id, session: result.session });
});

sessionsRouter.post('/:id/sessions', async (req, res) => {
  if (codeAttemptBlocked(req)) {
    return res.status(429).json({ error: '입장 코드를 여러 번 잘못 입력했습니다. 5분 후 다시 시도해주세요.' });
  }
  const examId = Number(req.params.id);
  const exam = await repo.getExam(examId);
  if (!exam || exam.status !== 'finalized' || !exam.supervised_at) {
    return res.status(400).json({ error: '응시할 수 있는 시험이 아닙니다.' });
  }
  // 교사가 "시험 전체 종료"를 누른 뒤에는 새로 참여를 시도해도 들어올 수 없다 - "시험
  // 다시 열기"를 눌러야 다시 참여할 수 있다. 이미 참여해 진행 중이던 학생은(이 라우트를
  // 다시 타지 않으므로) 영향받지 않는다.
  if (exam.ends_at) {
    return res.status(400).json({ error: '선생님이 시험을 종료했습니다. 다시 열릴 때까지 기다려주세요.' });
  }

  if (String(req.body?.admission_code ?? '').trim() !== exam.admission_code) {
    recordCodeFailure(req);
    return res.status(400).json({ error: '입장 코드가 올바르지 않습니다.' });
  }
  failedCodeAttempts.delete(attemptKey(req));

  const rollNumber = Number(req.body.roll_number);
  if (!Number.isInteger(rollNumber)) {
    return res.status(400).json({ error: '번호를 입력해주세요.' });
  }
  const student = await repo.getRosterEntry(rollNumber);
  if (!student) {
    return res.status(400).json({ error: '등록되지 않은 번호입니다.' });
  }

  let session = await repo.getSessionByExamAndRoll(examId, rollNumber);

  if (session && (session.status === 'submitted' || session.status === 'force_submitted')) {
    return res.status(409).json({ error: '이미 종료된 응시 기록입니다. 다시 응시하려면 선생님께 요청해주세요.' });
  }
  // 같은 번호로 이미 참여/응시 중인 세션이 있는데 또 참여하려는 경우 - 다른 기기가
  // 끼어들면 답 제출/이탈 경고가 뒤섞이므로 기본적으로 막는다. 원래 기기가 고장나서
  // 다른 기기로 이어가야 하는 등 정당한 상황엔 교사가 "실시간 감독"에서 재참여를 허용해줘야
  // 하고, 그러면 이번 한 번만 통과된다(allow_rejoin은 바로 소진).
  if (session && (session.status === 'joined' || session.status === 'in_progress')) {
    if (!session.allow_rejoin) {
      return res.status(409).json({
        error: '이미 이 번호로 참여 중인 기기가 있습니다. 다른 기기에서 이어서 하려면 선생님께 "재참여 허용"을 요청하세요.',
      });
    }
    await repo.setAllowRejoin(session.id, false);
  }

  if (!session) {
    session = await repo.createSession(examId, rollNumber);
    emitExamMonitorUpdate(examId);
  }

  // 교사가 이미 '시험 시작'을 눌러 시험이 진행 중이면, 뒤늦게 들어오는 학생도 대기
  // 화면 없이 바로 응시로 들어간다.
  if (exam.started_at && session.status === 'joined') {
    await repo.startSession(session.id);
    session = await repo.getSession(session.id);
    emitExamMonitorUpdate(examId);
  }

  res.status(201).json(session);
});

// 교사용 라우트(감독/결과 등, 전부 requireAuth)에서 쓴다 - 순차 정수 id로 조회한다.
async function getSessionOr404(examId, sessionId, res) {
  const session = await repo.getSession(sessionId);
  if (!session || session.exam_id !== examId) {
    res.status(404).json({ error: '응시 세션을 찾을 수 없습니다.' });
    return undefined;
  }
  return session;
}

// 학생용 라우트(로그인 없음)는 전부 이걸로 조회한다 - URL의 :sessionId는 더 이상 DB의
// 순차 정수 id가 아니라, 참여할 때 한 번 발급된 무작위 토큰이다. 남의 토큰을 추측하기
// 어려우므로, 다른 학생의 세션 번호를 아무 정수나 넣어보는 식으로는 더 이상 접근할 수 없다.
async function getSessionByTokenOr404(examId, token, res) {
  const session = await repo.getSessionByToken(token);
  if (!session || session.exam_id !== examId) {
    res.status(404).json({ error: '응시 세션을 찾을 수 없습니다.' });
    return undefined;
  }
  return session;
}

sessionsRouter.get('/:id/sessions/:sessionId', async (req, res) => {
  const examId = Number(req.params.id);
  const session = await getSessionByTokenOr404(examId, req.params.sessionId, res);
  if (!session) return;

  const payload = { ...session };
  if (session.status === 'submitted' || session.status === 'force_submitted') {
    payload.answers = await repo.getSessionAnswerSummary(session.id);
  }
  res.json(payload);
});

// 교사가 '시험 감독' 화면에서 누른다. 대기 중(joined)인 학생 전원을 한 번에 응시로
// 전환하고, 이후 들어오는 학생도 곧장 응시로 들어가도록 exam.started_at을 남긴다.
sessionsRouter.post('/:id/start', requireAuth, async (req, res) => {
  const examId = Number(req.params.id);
  const exam = await repo.getExam(examId);
  if (!exam || exam.status !== 'finalized') {
    return res.status(400).json({ error: '확정된 시험만 시작할 수 있습니다.' });
  }

  await repo.markExamStarted(examId);
  const started = await repo.startAllJoinedSessions(examId);
  emitExamMonitorUpdate(examId);
  res.json({ started });
});

// 교사가 '시험 감독' 화면에서 누른다. 아직 대기/응시 중인 학생 전원을 지금까지 낸 답만으로
// 한 번에 강제 제출 처리해 시험을 완전히 끝낸다.
sessionsRouter.post('/:id/end-all', requireAuth, async (req, res) => {
  const examId = Number(req.params.id);
  const exam = await repo.getExam(examId);
  if (!exam) return res.status(404).json({ error: '시험을 찾을 수 없습니다.' });

  const ended = await repo.endAllActiveSessions(examId);
  await repo.markExamEnded(examId);
  await repo.unsuperviseExam(examId);
  emitExamMonitorUpdate(examId);
  res.json({ ended });
});

// 교사가 '시험 감독' 화면에서 누른다. 시험 참여/응시 "접근"만 다시 열어준다(exams.ends_at
// 제거) - 강제 종료됐던 학생 개개인을 응시 중으로 되돌리는 것과는 별개다(그건 학생 카드의
// "되살리기"로 한다). 이후 새로 참여하는 학생부터 다시 받을 수 있게 된다.
sessionsRouter.post('/:id/reopen', requireAuth, async (req, res) => {
  const examId = Number(req.params.id);
  const exam = await repo.getExam(examId);
  if (!exam) return res.status(404).json({ error: '시험을 찾을 수 없습니다.' });

  await repo.clearExamEnded(examId);
  await repo.superviseExam(examId);
  emitExamMonitorUpdate(examId);
  res.json(await repo.getExam(examId));
});

function isTimedOut(session, exam) {
  if (!session.started_at) return false;
  const deadline =
    new Date(session.started_at).getTime() + (exam.time_limit_sec + (session.extra_time_sec ?? 0)) * 1000;
  return Date.now() > deadline;
}

// 1차 진행(순서대로 문항을 보여주는 단계)이 끝났을 때 호출한다. 건너뛴(응답 안 한) 문항이
// 남아 있으면 그것부터 마저 처리하게 하고, 하나도 없으면 그제서야 실제로 제출 확정한다.
// ---- 학생 응시 진행 ----
// 학생은 [이전]/[다음]으로 문항을 오가고, 마지막 문항 다음의 "답안 확인" 화면에서 최종 제출한다.
// current_question_index는 "지금 보고 있는 문항"이고, 문항 수와 같으면 답안 확인 화면이다.
// 답을 낸 문항에 돌아와 고쳐 내면 다시 채점한다. 시간 초과·강제 종료만 즉시 제출된다.

// 필기(strokes)는 교사가 나중에 풀이과정을 다시 볼 수 있도록 그대로 저장한다. 다만 비정상적으로
// 긴 필기(악의적 페이로드 포함)로 DB가 부풀지 않도록, 문항 하나당 넉넉한 점 개수(획 전체 합산
// 4만 개 - 몇 페이지를 빼곡히 채워도 남는 여유)에서 잘라낸다. 문자열을 그냥 자르면 JSON이
// 깨지므로 stroke 단위로 담다가 상한에 닿으면 멈춘다. 좌표는 캡처 당시 캔버스 크기 기준이라,
// 다른 크기 화면에서 같은 비율로 다시 그리려면 그 크기도 같이 저장해야 한다.
function readStrokesJson(body) {
  const MAX_STROKE_POINTS = 40_000;
  const rawStrokes = Array.isArray(body?.strokes) ? body.strokes : [];
  const canvasSize = body?.strokes_canvas_size;
  const cappedStrokes = [];
  let pointCount = 0;
  for (const stroke of rawStrokes) {
    const points = Array.isArray(stroke?.points) ? stroke.points.length : 0;
    if (pointCount + points > MAX_STROKE_POINTS) break;
    cappedStrokes.push(stroke);
    pointCount += points;
  }
  return cappedStrokes.length > 0 && Number(canvasSize?.width) > 0 && Number(canvasSize?.height) > 0
    ? JSON.stringify({ width: canvasSize.width, height: canvasSize.height, strokes: cappedStrokes })
    : null;
}

// 'next' | 'prev' | 'summary' | 문항 번호(0부터)를 이동할 위치로 바꾼다. 문항 수(total)는 답안 확인 화면.
function resolveNavigationTarget(to, currentIndex, total) {
  if (to === 'prev') return Math.max(0, Math.min(currentIndex, total) - 1);
  if (to === 'summary') return total;
  if (Number.isInteger(to)) return Math.max(0, Math.min(to, total));
  return Math.min(currentIndex + 1, total);
}

// 응시 중인지·시간이 남았는지 확인한다. 끝났으면 응답까지 보내고 null을 돌려준다.
async function loadActiveSession(req, res) {
  const examId = Number(req.params.id);
  const session = await getSessionByTokenOr404(examId, req.params.sessionId, res);
  if (!session) return null;
  const exam = await repo.getExamFull(examId);
  if (session.status === 'submitted' || session.status === 'force_submitted') {
    res.json({ done: true });
    return null;
  }
  if (session.status !== 'in_progress') {
    res.status(400).json({ error: '응시 중인 세션이 아닙니다.' });
    return null;
  }
  if (isTimedOut(session, exam)) {
    await repo.finalizeSession(session.id);
    emitExamMonitorUpdate(examId);
    res.json({ done: true, timedOut: true });
    return null;
  }
  return { examId, session, exam };
}

// 지금 보고 있는 문항을 떠난다 - 필기를 남기고 머문 시간을 마감한 뒤 목적지로 옮긴다.
async function leaveCurrentQuestion({ examId, session, exam }, body, { strokesAlreadySaved = false } = {}) {
  const current = exam.questions[session.current_question_index];
  if (current) {
    if (!strokesAlreadySaved) await repo.saveQuestionStrokes(session.id, current.id, readStrokesJson(body));
    await repo.closeQuestionVisit(session.id, current.id, now());
  }
  const target = resolveNavigationTarget(body?.to, session.current_question_index, exam.questions.length);
  await repo.advanceSession(session.id, target);
  emitExamMonitorUpdate(examId);
}

// 요청이 가리키는 문항이 지금 보고 있는 문항인지 - 다른 기기/탭에서 이미 이동했으면 막는다.
function isCurrentQuestion(exam, session, questionId) {
  return exam.questions[session.current_question_index]?.id === questionId;
}

sessionsRouter.get('/:id/sessions/:sessionId/current-question', async (req, res) => {
  const active = await loadActiveSession(req, res);
  if (!active) return;
  const { session, exam } = active;
  const total = exam.questions.length;
  const answeredIds = new Set(await repo.getAnsweredQuestionIds(session.id));

  const question = exam.questions[session.current_question_index];
  if (!question) {
    // 답안 확인 화면 - 문항별로 답했는지만 알려준다.
    return res.json({
      done: false,
      summary: true,
      total,
      answered: exam.questions.map((q) => answeredIds.has(q.id)),
    });
  }

  await repo.openQuestionVisit(session.id, question.id, now());
  const answer = await repo.getAnswer(session.id, question.id);
  res.json({
    done: false,
    index: session.current_question_index,
    total,
    answered_count: answeredIds.size,
    question: sanitizeQuestionForStudent(question, exam.mode),
    // 이미 답했거나 필기해 둔 문항으로 돌아왔을 때 화면을 그대로 되살리기 위한 값
    my_answer: {
      answered: Boolean(answer?.answered_at),
      selected_choice_ids: repo.parseSelectedChoiceIds(answer?.selected_choice_id ?? null, answer?.selected_choice_ids),
      short_answer_text: answer?.answered_at ? (answer.short_answer_text ?? '') : '',
      strokes: answer?.strokes_json ? JSON.parse(answer.strokes_json) : null,
    },
  });
});

// 지금 문항에 답을 내고(고쳐 내도 됨) body.to 방향으로 이동한다(기본 'next').
sessionsRouter.post('/:id/sessions/:sessionId/answers', async (req, res) => {
  const active = await loadActiveSession(req, res);
  if (!active) return;
  const { session, exam } = active;

  const questionId = Number(req.body.question_id);
  const question = exam.questions.find((q) => q.id === questionId);
  if (!question) return res.status(400).json({ error: '문항을 찾을 수 없습니다.' });
  if (!isCurrentQuestion(exam, session, questionId)) {
    return res.status(409).json({ error: '현재 문항과 일치하지 않습니다.' });
  }

  let isCorrect = 0;
  let awardedPoints = 0;
  let selectedChoiceId = null;
  let selectedChoiceIds = null;
  let shortAnswerText = null;

  if (question.type === 'mc') {
    const graded = gradeMultipleChoice(question, req.body);
    selectedChoiceId = graded.selectedChoiceId;
    selectedChoiceIds = graded.selectedChoiceIds;
    isCorrect = graded.isCorrect ? 1 : 0;
    awardedPoints = graded.isCorrect ? question.points : 0;
  } else {
    shortAnswerText = readShortAnswerText(req.body);
    const graded = gradeShortAnswer(question, shortAnswerText);
    isCorrect = graded.isCorrect ? 1 : 0;
    awardedPoints = graded.awardedPoints;
  }

  await repo.submitAnswer(session.id, questionId, {
    selectedChoiceId,
    selectedChoiceIds,
    shortAnswerText,
    answeredAt: now(),
    isCorrect,
    awardedPoints,
    strokesJson: readStrokesJson(req.body),
  });
  await leaveCurrentQuestion(active, req.body, { strokesAlreadySaved: true });
  res.json({ done: false });
});

// 답을 내지 않고 이동한다(이전 문항, 건너뛰기, 답안 확인 화면에서 문항 고르기).
sessionsRouter.post('/:id/sessions/:sessionId/navigate', async (req, res) => {
  const active = await loadActiveSession(req, res);
  if (!active) return;
  const { session, exam } = active;
  const onQuestion = session.current_question_index < exam.questions.length;
  if (onQuestion && !isCurrentQuestion(exam, session, Number(req.body?.question_id))) {
    return res.status(409).json({ error: '현재 문항과 일치하지 않습니다.' });
  }
  await leaveCurrentQuestion(active, req.body);
  res.json({ done: false });
});

// 학생이 답안 확인 화면에서 "최종 제출"을 눌렀다. 답하지 않은 문항은 무응답 오답으로 마감한다.
sessionsRouter.post('/:id/sessions/:sessionId/final-submit', async (req, res) => {
  const active = await loadActiveSession(req, res);
  if (!active) return;
  const { examId, session } = active;
  await repo.markUnansweredAsBlank(session.id, examId, now());
  await repo.finalizeSession(session.id);
  emitExamMonitorUpdate(examId);
  res.json({ done: true });
});

// 다른 화면으로 이탈(탭 전환, 창 최소화, 전체화면 해제)이 감지되면 그 즉시 강제 제출
// 처리한다 - 경고를 몇 번 봐주는 방식은 "나가서 답을 찾아보고 돌아오면 그만"인 허점이
// 있어 첫 이탈부터 바로 종료시킨다. 억울하게 종료된 경우엔 교사가 감독 화면에서
// "되살리기"로 이어서 풀게 해줄 수 있다.
sessionsRouter.post('/:id/sessions/:sessionId/warning', async (req, res) => {
  const examId = Number(req.params.id);
  const session = await getSessionByTokenOr404(examId, req.params.sessionId, res);
  if (!session) return;

  if (session.status !== 'in_progress') {
    return res.json({ disqualified: false });
  }

  const type = req.body.type === 'window_blur' ? 'window_blur' : 'visibility_hidden';
  const result = await repo.recordScreenLeave(session.id, type, config.anticheatDebounceMs);
  emitExamMonitorUpdate(examId);
  res.json(result);
});

sessionsRouter.post('/:id/sessions/:sessionId/submit', async (req, res) => {
  const examId = Number(req.params.id);
  const session = await getSessionByTokenOr404(examId, req.params.sessionId, res);
  if (!session) return;

  await repo.finalizeSession(session.id);
  emitExamMonitorUpdate(examId);
  res.json(await repo.getSession(session.id));
});

// ---- 교사 배정형 오답 재풀이 ----
sessionsRouter.post('/:id/sessions/:sessionId/review-assignment', requireAuth, async (req, res) => {
  const examId = Number(req.params.id);
  const sessionId = Number(req.params.sessionId);
  const session = await getSessionOr404(examId, sessionId, res);
  if (!session) return;
  if (session.status !== 'submitted' && session.status !== 'force_submitted') {
    return res.status(400).json({ error: '제출이 끝난 학생에게만 오답 재풀이를 배정할 수 있습니다.' });
  }
  const assignment = await repo.assignWrongAnswerReview(sessionId);
  if (!assignment) return res.status(400).json({ error: '다시 풀 오답 문항이 없습니다.' });
  const questions = await repo.getReviewAssignmentQuestions(assignment.id);
  res.status(201).json({ ...assignment, question_count: questions.length });
});

sessionsRouter.get('/:id/sessions/:sessionId/review-assignment', requireAuth, async (req, res) => {
  const examId = Number(req.params.id);
  const sessionId = Number(req.params.sessionId);
  const session = await getSessionOr404(examId, sessionId, res);
  if (!session) return;
  const assignment = await repo.getReviewAssignmentBySession(sessionId);
  if (!assignment) return res.status(404).json({ error: '오답 재풀이 기록이 없습니다.' });
  const questions = await repo.getReviewAssignmentDetail(assignment.id);
  res.json({ assignment, questions });
});

// 학생 첫 화면에서 이 브라우저에 남아 있는 세션 토큰만 확인해 재풀이 바로가기를 만든다.
// 시험이 감독 종료된 뒤에도 재풀이는 독립적으로 접근할 수 있지만, 원래 응시 기기의 비밀
// 토큰 없이는 상태조차 조회할 수 없다.
sessionsRouter.get('/:id/review/status', async (req, res) => {
  const examId = Number(req.params.id);
  const session = await getSessionByTokenOr404(examId, String(req.query.access_token ?? ''), res);
  if (!session) return;
  const assignment = await repo.getReviewAssignmentBySession(session.id);
  if (!assignment) return res.json(null);
  const exam = await repo.getExam(examId);
  const questions = await repo.getReviewAssignmentQuestions(assignment.id);
  const answers = await repo.getReviewAnswerSummary(assignment.id);
  res.json({
    exam_id: examId,
    exam_title: exam?.title ?? '시험',
    status: assignment.status,
    total: questions.length,
    answered: answers.length,
    correct: answers.filter((answer) => answer.is_correct).length,
    completed_at: assignment.completed_at,
  });
});

sessionsRouter.get('/:id/review', async (req, res) => {
  const examId = Number(req.params.id);
  const session = await getSessionByTokenOr404(examId, String(req.query.access_token ?? ''), res);
  if (!session) return;
  if (session.status !== 'submitted' && session.status !== 'force_submitted') {
    return res.status(400).json({ error: '시험을 마친 뒤에 오답을 복습할 수 있습니다.' });
  }

  const exam = await repo.getExamFull(examId);
  if (!exam) return res.status(404).json({ error: '시험을 찾을 수 없습니다.' });

  const assignment = await repo.getReviewAssignmentBySession(session.id);
  if (!assignment) return res.status(404).json({ error: '선생님이 배정한 오답 재풀이가 없습니다.' });
  await repo.startReviewAssignment(assignment.id);
  const assigned = await repo.getReviewAssignmentQuestions(assignment.id);
  const assignedIds = new Set(assigned.map((row) => row.question_id));
  const questions = exam.questions
    .filter((q) => assignedIds.has(q.id))
    .map((q) => sanitizeQuestionForStudent(q, exam.mode));
  const answers = await repo.getReviewAnswerSummary(assignment.id);
  const correctCount = answers.filter((a) => a.is_correct).length;
  res.json({ exam_title: exam.title, assignment: { ...assignment, status: correctCount >= questions.length ? 'completed' : assignment.status }, questions, answers });
});

sessionsRouter.post('/:id/review/answer', async (req, res) => {
  const examId = Number(req.params.id);
  const session = await getSessionByTokenOr404(examId, String(req.body?.access_token ?? ''), res);
  if (!session) return;
  if (session.status !== 'submitted' && session.status !== 'force_submitted') {
    return res.status(400).json({ error: '시험을 마친 뒤에 오답을 복습할 수 있습니다.' });
  }

  const assignment = await repo.getReviewAssignmentBySession(session.id);
  if (!assignment) return res.status(404).json({ error: '선생님이 배정한 오답 재풀이가 없습니다.' });
  const questionId = Number(req.body?.question_id);
  const assigned = await repo.getReviewAssignmentQuestions(assignment.id);
  if (!assigned.some((row) => row.question_id === questionId)) return res.status(400).json({ error: '재풀이 대상 문항이 아닙니다.' });

  const exam = await repo.getExamFull(examId);
  const question = exam?.questions.find((q) => q.id === questionId);
  if (!question) return res.status(404).json({ error: '문항을 찾을 수 없습니다.' });

  let isCorrect = false;
  let selectedChoiceId = null;
  let selectedChoiceIds = null;
  const shortAnswerText = readShortAnswerText(req.body);
  // 서술형 재풀이는 몇 개의 핵심 내용을 담았는지만 알려준다(어떤 키워드인지는 알려주지 않음).
  let essayProgress = null;
  if (question.type === 'mc') {
    ({ selectedChoiceId, selectedChoiceIds, isCorrect } = gradeMultipleChoice(question, req.body));
  } else {
    ({ isCorrect } = gradeShortAnswer(question, shortAnswerText));
    if (isKeywordQuestion(question)) {
      const { groups } = gradeKeywordAnswer(question.keyword_rubric, shortAnswerText);
      essayProgress = { matched: groups.filter((g) => g.matched != null).length, total: groups.length };
    }
  }

  const updated = await repo.saveReviewAnswer(assignment.id, questionId, {
    selectedChoiceId,
    selectedChoiceIds,
    shortAnswerText,
    isCorrect,
  });
  const answers = await repo.getReviewAnswerSummary(assignment.id);
  res.json({
    is_correct: isCorrect,
    done: updated.status === 'completed',
    answered_count: answers.length,
    essay_progress: essayProgress,
  });
});

// ---- 교사용: 시험 감독(실시간 모니터링) ----

sessionsRouter.get('/:id/monitor', requireAuth, async (req, res) => {
  const examId = Number(req.params.id);
  const exam = await repo.getExamFull(examId);
  if (!exam) return res.status(404).json({ error: '시험을 찾을 수 없습니다.' });

  const students = await repo.getMonitorStudents(examId);
  res.json({
    exam: {
      id: exam.id,
      title: exam.title,
      status: exam.status,
      question_count: exam.questions.length,
      time_limit_sec: exam.time_limit_sec,
      started_at: exam.started_at,
      ends_at: exam.ends_at,
      admission_closed: Boolean(exam.admission_closed),
      admission_code: exam.admission_code,
    },
    students,
  });
});

sessionsRouter.get('/:id/sessions/:sessionId/monitor', requireAuth, async (req, res) => {
  const examId = Number(req.params.id);
  const sessionId = Number(req.params.sessionId);
  const session = await getSessionOr404(examId, sessionId, res);
  if (!session) return;

  const exam = await repo.getExamFull(examId);
  const student = await repo.getRosterEntry(session.roll_number);
  const rawHistory = await repo.getSessionAnswerHistory(sessionId);

  // getSessionAnswerHistory는 문항당 학생이 실제로 고른 보기 텍스트만 갖고 있다 - 지난
  // 시험을 나중에 복습할 때(SessionReview 페이지)는 문항 이미지와 보기 전체·정답까지
  // 같이 봐야 하므로, 이미 불러온 exam.questions에서 같은 문항을 찾아 덧붙인다.
  const history = rawHistory.map((h) => {
    const question = exam.questions.find((q) => q.order_index === h.order_index);
    return {
      ...h,
      prompt_image_path: question?.prompt_image_path ?? null,
      show_prompt_text: Boolean(question?.show_prompt_text),
      choices: question
        ? question.choices.map((c) => ({
            id: c.id,
            order_index: c.order_index,
            text: c.text,
            is_correct: c.is_correct,
          }))
        : [],
      correct_short_answers: question?.correct_short_answers ?? null,
      essay: question ? isKeywordQuestion(question) : false,
      ...(question
        ? keywordReviewInfo(question, h.short_answer_text, h.graded_by_teacher)
        : { keyword_groups: null, needs_review: false }),
    };
  });

  let currentQuestion = null;
  if (session.status === 'in_progress') {
    const q = exam.questions[session.current_question_index];
    if (q) {
      currentQuestion = {
        index: session.current_question_index,
        total: exam.questions.length,
        type: q.type,
        prompt: q.prompt,
        prompt_image_path: q.prompt_image_path,
        show_prompt_text: Boolean(q.show_prompt_text),
        choices: q.choices.map((c) => ({
          id: c.id,
          order_index: c.order_index,
          text: c.text,
          is_correct: c.is_correct,
        })),
      };
    }
  }

  // access_token은 학생 화면이 자기 세션을 증명하는 비밀값이다 - 교사는 이미 이 세션의
  // 모든 내용을 볼 권한이 있어 문제될 건 없지만, 굳이 API 응답에 실어 보낼 이유도 없어 뺀다.
  const { access_token, ...sessionWithoutToken } = session;

  res.json({
    session: sessionWithoutToken,
    student: student ? { roll_number: student.roll_number, name: student.name } : null,
    currentQuestion,
    history,
  });
});

// 교사가 응시 중(또는 아직 시작 전)인 학생의 시험을 강제로 끝낸다. 이미 끝난 세션은
// 다시 종료할 수 없으므로 상태를 먼저 확인한다.
sessionsRouter.post('/:id/sessions/:sessionId/force-submit', requireAuth, async (req, res) => {
  const examId = Number(req.params.id);
  const sessionId = Number(req.params.sessionId);
  const session = await getSessionOr404(examId, sessionId, res);
  if (!session) return;

  if (session.status !== 'joined' && session.status !== 'in_progress') {
    return res.status(400).json({ error: '이미 종료된 세션입니다.' });
  }

  await repo.finalizeSession(sessionId, 'force_submitted', 'teacher_manual');
  emitExamMonitorUpdate(examId);
  res.json(await repo.getSession(sessionId));
});

// 강제 종료(경고 누적 또는 교사가 직접 종료)된 학생을 다시 응시 중 상태로 되살린다 -
// 오탐(인터넷 끊김 등)으로 억울하게 종료됐거나, 사정을 봐서 계속 풀게 해주고 싶을 때 쓴다.
// 시간이 이미 다 지나있으면 되살려도 바로 다시 시간 초과로 제출돼버리므로, 지금 시각을
// 새 시작 시각으로 삼아 처음 시험 시간만큼 다시 준다(기존에 받은 추가시간은 그대로 유지).
// 경고 횟수도 0으로 초기화하고, 학생이 입장 코드를 다시 입력하는 경우를 위해 재입장 1회도
// 함께 허용한다. 재입장에 성공하면 createOrResumeSession에서 허용값을 즉시 소진한다.
sessionsRouter.post('/:id/sessions/:sessionId/revive', requireAuth, async (req, res) => {
  const examId = Number(req.params.id);
  const sessionId = Number(req.params.sessionId);
  const session = await getSessionOr404(examId, sessionId, res);
  if (!session) return;

  if (session.status !== 'force_submitted') {
    return res.status(400).json({ error: '강제 종료된 세션만 되살릴 수 있습니다.' });
  }

  await repo.reviveSession(sessionId);
  emitExamMonitorUpdate(examId);
  res.json(await repo.getSession(sessionId));
});

// 교사가 시험 감독 화면에서 특정 학생에게만 시간을 더 준다(+1/+5/+10분 등). 이미 끝난
// 세션은 더 줘도 의미가 없으므로 응시 중일 때만 허용한다.
sessionsRouter.post('/:id/sessions/:sessionId/extend-time', requireAuth, async (req, res) => {
  const examId = Number(req.params.id);
  const sessionId = Number(req.params.sessionId);
  const session = await getSessionOr404(examId, sessionId, res);
  if (!session) return;

  if (session.status !== 'in_progress') {
    return res.status(400).json({ error: '응시 중인 학생에게만 시간을 추가할 수 있습니다.' });
  }
  const seconds = Number(req.body.seconds);
  if (!Number.isInteger(seconds) || seconds === 0) {
    return res.status(400).json({ error: 'seconds가 필요합니다.' });
  }

  const updated = await repo.addExtraTime(sessionId, seconds);
  emitExamMonitorUpdate(examId);
  res.json(updated);
});

// 같은 번호로 다른 기기가 참여를 시도했다가 막힌 경우(위 join 라우트 참고), 교사가
// "실시간 감독"에서 이 버튼을 눌러 다음 참여 시도 한 번만 통과시켜준다 - 학생 기기가
// 고장나서 다른 기기로 이어가야 하는 등 정당한 상황을 위한 예외 통로.
sessionsRouter.post('/:id/sessions/:sessionId/allow-rejoin', requireAuth, async (req, res) => {
  const examId = Number(req.params.id);
  const sessionId = Number(req.params.sessionId);
  const session = await getSessionOr404(examId, sessionId, res);
  if (!session) return;

  await repo.setAllowRejoin(sessionId, true);
  emitExamMonitorUpdate(examId);
  res.json(await repo.getSession(sessionId));
});

// ---- 교사용 결과 집계 ----

sessionsRouter.get('/:id/results', requireAuth, async (req, res) => {
  const examId = Number(req.params.id);
  const exam = await repo.getExamFull(examId);
  if (!exam) return res.status(404).json({ error: '시험을 찾을 수 없습니다.' });

  const { sessions, questionStats: rawQuestionStats } = await repo.getResultsForExam(examId);

  attachSessionInsights(sessions);
  const questionStats = attachQuestionInsights(rawQuestionStats);

  // 실제로 유난히 오래 걸린다는 신호가 있는 문항만 보여준다. 모든 시간이 비슷할 때도
  // 무조건 상위 3개를 만들던 기존 방식은 교사에게 불필요한 경고를 만들었다.
  const slowestQuestions = [...questionStats]
    .filter((q) => q.insight_codes.includes('difficult_slow') || q.insight_codes.includes('accurate_slow'))
    .sort((a, b) => b.avg_time_spent_ms - a.avg_time_spent_ms)
    .slice(0, 3);
  const lowestAccuracyQuestions = [...questionStats]
    .filter((q) => q.insight_codes.includes('difficult_slow') || q.insight_codes.includes('fast_wrong'))
    .sort((a, b) => a.correct_count / a.answered_count - b.correct_count / b.answered_count)
    .slice(0, 3);

  const standardsAccuracy = await repo.computeStandardsAccuracy({ examId });

  res.json({ sessions, questionStats, slowestQuestions, lowestAccuracyQuestions, standardsAccuracy });
});

// 문항별 정답률에서 문항 번호를 누르면 보여주는 학생별 소요시간/정답 여부 상세.
sessionsRouter.get('/:id/questions/:qid/breakdown', requireAuth, async (req, res) => {
  const examId = Number(req.params.id);
  const qid = Number(req.params.qid);
  const question = await repo.getQuestion(examId, qid);
  if (!question) return res.status(404).json({ error: '문항을 찾을 수 없습니다.' });

  const rows = await repo.getQuestionStudentBreakdown(qid);
  const times = rows.map((r) => r.time_spent_ms).filter((t) => t != null);
  const avgTimeMs = times.length > 0 ? times.reduce((a, b) => a + b, 0) / times.length : null;

  const answeredCount = rows.length;
  const correctCount = rows.filter((r) => r.is_correct).length;
  const accuracy = answeredCount > 0 ? correctCount / answeredCount : null;

  // "쉬운 문항"을 고정값(예: 80%)으로 정하지 않는다 - 시험마다 난이도가 다르고, 반
  // 인원이 적으면 한 명 차이로 값이 크게 흔들려서 절대 기준은 데이터로서 가치가 떨어진다.
  // 대신 "그 학생 자신의 이번 시험 전체 정답률"을 기준점으로 삼는다: 이 문항의 반
  // 정답률이 그 학생의 전체 정답률보다 높다면(=그 학생 실력 기준으로도 상대적으로 쉬운
  // 축에 속하는 문항인데) 틀렸다는 뜻이라, 학생마다 다른 기준으로 "그 학생에게 의미
  // 있는" 이상치를 잡을 수 있다. 전체 정답률은 시험이 끝난(submitted/force_submitted)
  // 학생만 의미가 있어 그 외엔 비교하지 않는다.
  const { sessions } = await repo.getResultsForExam(examId);
  const ownAccuracyByRoll = new Map(
    sessions
      .filter((s) => s.status === 'submitted')
      .map((s) => [s.roll_number, s.max_score ? s.score / s.max_score : 0]),
  );

  const gradingQuestion = { ...question, keyword_rubric: parseKeywordRubric(question.keyword_rubric) };
  const students = attachQuestionStudentInsights(rows, accuracy, ownAccuracyByRoll).map((row) => ({
    ...row,
    needs_review: keywordReviewInfo(gradingQuestion, row.short_answer_text, row.graded_by_teacher).needs_review,
  }));

  res.json({ avgTimeMs, accuracy, points: question.points, students });
});

// 서술형 이의 제기 처리: 학생이 쓴 표현을 채점 기준의 한 줄(핵심 내용)에 동의어로 추가하고,
// 이 문항의 모든 자동 채점 답안을 새 기준으로 다시 채점한다(같은 표현을 쓴 다른 학생도 함께
// 인정되도록). apply가 false면 점수가 바뀌는 학생 목록만 미리 돌려준다.
sessionsRouter.post('/:id/questions/:qid/keyword-expression', requireAuth, async (req, res) => {
  const examId = Number(req.params.id);
  const qid = Number(req.params.qid);
  const exam = await repo.getExamFull(examId);
  const question = exam?.questions.find((q) => q.id === qid);
  if (!question) return res.status(404).json({ error: '문항을 찾을 수 없습니다.' });
  if (!isKeywordQuestion(question)) return res.status(400).json({ error: '서술형 문항이 아닙니다.' });

  const groupIndex = Number(req.body?.group_index);
  const expression = typeof req.body?.expression === 'string' ? req.body.expression.trim().slice(0, 100) : '';
  if (!Number.isInteger(groupIndex) || !question.keyword_rubric[groupIndex]) {
    return res.status(400).json({ error: '핵심 내용을 찾을 수 없습니다.' });
  }
  if (!expression) return res.status(400).json({ error: '인정할 표현을 입력해주세요.' });

  const rubric = question.keyword_rubric.map((group, i) =>
    i === groupIndex && !group.keywords.includes(expression)
      ? { ...group, keywords: [...group.keywords, expression] }
      : group,
  );
  const regraded = { ...question, keyword_rubric: rubric };
  const changes = [];
  for (const answer of await repo.listAutoGradedAnswers(qid)) {
    const graded = gradeShortAnswer(regraded, answer.short_answer_text ?? '');
    if (graded.awardedPoints === answer.awarded_points && Number(graded.isCorrect) === answer.is_correct) continue;
    changes.push({
      session_id: answer.session_id,
      roll_number: answer.roll_number,
      name: answer.name,
      before: answer.awarded_points ?? 0,
      after: graded.awardedPoints,
      is_correct: graded.isCorrect,
    });
  }

  const apply = req.body?.apply === true;
  if (apply) {
    await repo.setKeywordGrading(qid, 'keyword', rubric);
    for (const change of changes) {
      await repo.applyAutoRegrade(change.session_id, qid, change.after, change.is_correct);
    }
    emitExamMonitorUpdate(examId);
  }
  res.json({ applied: apply, points: question.points, changes });
});

// 교사가 끝난 시험의 단답형/서술형 답안 점수를 직접 고친다(키워드 자동 채점이 틀렸을 때 등).
// 만점이면 정답으로 바뀌어 정답률·성취기준 통계에도 반영되고, 총점도 다시 계산한다.
sessionsRouter.put('/:id/sessions/:sessionId/answers/:questionId/grade', requireAuth, async (req, res) => {
  const examId = Number(req.params.id);
  const sessionId = Number(req.params.sessionId);
  const questionId = Number(req.params.questionId);
  const session = await getSessionOr404(examId, sessionId, res);
  if (!session) return;
  if (session.status !== 'submitted' && session.status !== 'force_submitted') {
    return res.status(400).json({ error: '시험을 마친 답안만 점수를 고칠 수 있습니다.' });
  }
  const question = await repo.getQuestion(examId, questionId);
  if (!question) return res.status(404).json({ error: '문항을 찾을 수 없습니다.' });
  if (question.type !== 'short') {
    return res.status(400).json({ error: '단답형·서술형 문항만 점수를 고칠 수 있습니다.' });
  }
  const answer = await repo.getAnswer(sessionId, questionId);
  if (!answer?.answered_at) return res.status(400).json({ error: '학생이 답하지 않은 문항입니다.' });

  const awardedPoints = Number(req.body?.awarded_points);
  if (!Number.isFinite(awardedPoints) || awardedPoints < 0 || awardedPoints > question.points) {
    return res.status(400).json({ error: `점수는 0~${question.points}점 사이로 입력해주세요.` });
  }
  const rounded = Math.round(awardedPoints * 100) / 100;
  await repo.setAnswerGradeByTeacher(sessionId, questionId, rounded, rounded >= question.points);
  const updated = await repo.getSession(sessionId);
  res.json({ ok: true, score: updated.score, max_score: updated.max_score });
});

// SessionReview(학생 한 명 × 시험 한 번 상세 복습 화면)에서 "빠르게 풀고 틀림"/"오래
// 고민하고 틀림" 배지를 보여주기 위한 것. 위 breakdown과 같은 판정 로직을 문항마다
// 반복 호출하지 않고, 이 세션 하나에 필요한 결과만 한 번에 계산해 돌려준다.
sessionsRouter.get('/:id/sessions/:sessionId/question-insights', requireAuth, async (req, res) => {
  const examId = Number(req.params.id);
  const sessionId = Number(req.params.sessionId);
  const session = await getSessionOr404(examId, sessionId, res);
  if (!session) return;

  const allRows = await repo.getExamQuestionStudentBreakdown(examId);
  const { sessions } = await repo.getResultsForExam(examId);
  const ownAccuracyByRoll = new Map(
    sessions
      .filter((s) => s.status === 'submitted')
      .map((s) => [s.roll_number, s.max_score ? s.score / s.max_score : 0]),
  );

  const byQuestion = new Map();
  for (const row of allRows) {
    if (!byQuestion.has(row.question_id)) byQuestion.set(row.question_id, { orderIndex: row.order_index, rows: [] });
    byQuestion.get(row.question_id).rows.push(row);
  }

  const result = [];
  for (const { orderIndex, rows } of byQuestion.values()) {
    const answeredCount = rows.length;
    const correctCount = rows.filter((r) => r.is_correct).length;
    const accuracy = answeredCount > 0 ? correctCount / answeredCount : null;
    const students = attachQuestionStudentInsights(rows, accuracy, ownAccuracyByRoll);
    const mine = students.find((s) => s.roll_number === session.roll_number);
    if (mine?.isOutlier) {
      result.push({ order_index: orderIndex, outlierReason: mine.outlierReason });
    }
  }
  res.json(result);
});
