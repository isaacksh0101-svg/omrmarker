import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api/client';
import type {
  CurrentQuestionResponse,
  ExamSession,
  PendingQuestionsResponse,
  PublicExam,
  PublicQuestion,
} from '../../types';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { Badge } from '../../components/Badge';
import { PenCanvas, type PenCanvasHandle, type PenTool } from '../../components/PenCanvas';
import { MathText } from '../../components/MathText';
import { IconEraser, IconHand, IconPen, IconTrash, IconUndo } from '../../components/icons';

const PEN_COLORS = ['#1b1c22', '#f04438', '#3258ce'];
const FINGER_MODE_KEY = 'omr_finger_writing';

function formatTime(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// 대기 화면과 시작 게이트 화면 양쪽에 똑같이 띄운다 - 전체화면을 지원하지 않는 기기
// (예: iOS Safari)는 시작 게이트 화면 자체를 건너뛰므로, 대기 화면에도 반드시 같은
// 경고가 보여야 모든 학생이 시작 전에 한 번은 보게 된다.
function AntiCheatNotice() {
  return (
    <div className="mt-6 max-w-sm space-y-3 rounded-xl border border-danger/30 bg-danger/5 px-4 py-3 text-left">
      <div>
        <p className="text-sm font-bold text-danger">시험 중 다른 화면으로 이동하면 안 됩니다</p>
        <p className="mt-1 text-xs text-ink-soft">
          탭 전환, 창 전환, 최소화 등으로 화면을 벗어나는 순간 그 즉시 시험이 강제로 종료됩니다. 실수로
          종료됐다면 선생님께 바로 말씀해주세요.
        </p>
      </div>
      <div className="border-t border-danger/15 pt-3">
        <p className="text-xs font-bold text-ink">시험 데이터 처리 안내</p>
        <p className="mt-1 text-xs leading-relaxed text-ink-soft">
          출석번호, 답안, 점수, 문항별 소요시간, 필기와 화면 이탈 기록은 시험 운영·채점·학습분석을 위해
          선생님 PC에 저장되며 학기 말에 삭제됩니다. 열람·정정·삭제가 필요하면 담당 선생님께 요청하세요.
        </p>
      </div>
    </div>
  );
}

// 전체화면 API - 사파리(구버전)는 webkit 접두사를 쓰므로 감지/호출을 한 곳에 모아둔다.
// 시험 중 전체화면을 벗어나는 것(alt-tab, 창 전환, 최소화 등 대부분의 "다른 화면으로 이동"
// 동작은 브라우저가 자동으로 전체화면을 해제시킨다)을 이탈 감지의 주 신호로 쓴다 - blur나
// visibilitychange보다 타이밍이 훨씬 더 명확하고 안정적이다(중복 카운트 버그의 원인이었던
// "돌아왔는지 애매한 타이밍" 문제 자체가 없다).
function isFullscreenSupported() {
  const doc = document as Document & { webkitFullscreenEnabled?: boolean };
  return !!(doc.fullscreenEnabled || doc.webkitFullscreenEnabled);
}
function requestFullscreenCompat(el: HTMLElement) {
  const anyEl = el as HTMLElement & { webkitRequestFullscreen?: () => Promise<void> };
  if (el.requestFullscreen) return el.requestFullscreen();
  if (anyEl.webkitRequestFullscreen) return anyEl.webkitRequestFullscreen();
  return Promise.reject(new Error('fullscreen not supported'));
}
function getFullscreenElementCompat() {
  const doc = document as Document & { webkitFullscreenElement?: Element | null };
  return doc.fullscreenElement || doc.webkitFullscreenElement || null;
}
function addFullscreenChangeListener(fn: () => void) {
  document.addEventListener('fullscreenchange', fn);
  document.addEventListener('webkitfullscreenchange', fn);
}
function removeFullscreenChangeListener(fn: () => void) {
  document.removeEventListener('fullscreenchange', fn);
  document.removeEventListener('webkitfullscreenchange', fn);
}

export function TakeExam() {
  const { examId } = useParams();
  const navigate = useNavigate();
  const id = Number(examId);
  const sessionId = localStorage.getItem(`omr_session_${id}`) ?? '';

  // 한 세션 안에서 이탈 감지로 인한 강제 제출 요청을 중복으로 여러 번 보내지 않기 위한
  // 가드 - blur와 visibilitychange, fullscreenchange가 같은 탭 전환에 대해 거의 동시에
  // 여러 번 발동할 수 있다. 세션이 다시 in_progress로 바뀔 때(교사가 되살렸을 때) 초기화된다.
  const disqualifyingRef = useRef(false);
  // 이번 응시에서 전체화면 진입에 성공해 전체화면 이탈을 이탈 신호로 같이 쓰고 있는지.
  const fullscreenArmedRef = useRef(false);

  // 전체화면 진입 제스처(브라우저 정책상 클릭 등 실제 사용자 동작이 있어야만 전체화면
  // 요청이 허용된다)를 거쳤는지 - 응시가 갑자기 자동으로 시작돼도(교사가 원격으로 시작
  // 버튼을 누름) 학생 쪽엔 클릭 한 번이 필요해서 이 게이트를 둔다.
  const [examStarted, setExamStarted] = useState(false);

  const [exam, setExam] = useState<PublicExam | null>(null);
  const [session, setSession] = useState<ExamSession | null>(null);
  const [current, setCurrent] = useState<CurrentQuestionResponse | null>(null);
  // null = 아직 1차 진행 중(건너뛴 문항 복습 단계가 아님). 배열이면 복습 단계 - 건너뛴 문항 목록.
  const [pending, setPending] = useState<PublicQuestion[] | null>(null);
  const [reviewOpenId, setReviewOpenId] = useState<number | null>(null);
  const [selectedChoice, setSelectedChoice] = useState<number | null>(null);
  const [shortAnswer, setShortAnswer] = useState('');
  const [remainingSec, setRemainingSec] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [penActive, setPenActive] = useState(false);
  const [penTool, setPenTool] = useState<PenTool>('pen');
  const [penColor, setPenColor] = useState(PEN_COLORS[0]);
  const [hasStrokes, setHasStrokes] = useState(false);
  // S-Pen이 없는 학생을 위한 손가락 필기 모드 - 이 기기(브라우저)에 저장해두고, 다음
  // 문항/시험에서도 매번 다시 켤 필요 없게 한다.
  const [fingerMode, setFingerMode] = useState(() => localStorage.getItem(FINGER_MODE_KEY) === '1');
  const penRef = useRef<PenCanvasHandle>(null);

  const reloadSession = useCallback(async () => {
    const s = await api.get<ExamSession>(`/exams/${id}/sessions/${sessionId}`);
    setSession(s);
    return s;
  }, [id, sessionId]);

  // 건너뛴 문항들(복습 단계) 목록을 불러온다. 목록 화면으로 돌아가는 것도 겸한다
  // (reviewOpenId를 비워서 지금 풀고 있던 문항 화면을 닫는다).
  const loadPending = useCallback(async () => {
    const res = await api.get<PendingQuestionsResponse>(`/exams/${id}/sessions/${sessionId}/pending-questions`);
    setPending(res.questions);
    setReviewOpenId(null);
    setSelectedChoice(null);
    setShortAnswer('');
  }, [id, sessionId]);

  const loadCurrentQuestion = useCallback(async () => {
    const c = await api.get<CurrentQuestionResponse>(`/exams/${id}/sessions/${sessionId}/current-question`);
    if (c.done) {
      await reloadSession();
      setCurrent(null);
      setPending(null);
      return;
    }
    if (c.reviewMode) {
      setCurrent(null);
      await loadPending();
      return;
    }
    setCurrent(c);
    setPending(null);
    setSelectedChoice(null);
    setShortAnswer('');
  }, [id, sessionId, reloadSession, loadPending]);

  useEffect(() => {
    if (!sessionId) {
      navigate('/student');
      return;
    }
    api.get<PublicExam>(`/exams/${id}/for-student`).then(setExam);
    reloadSession();
  }, [id, sessionId, navigate, reloadSession]);

  useEffect(() => {
    if (session?.status === 'in_progress' && !current && !pending) {
      loadCurrentQuestion();
    }
  }, [session, current, pending, loadCurrentQuestion]);

  // 지금 풀고 있는 문항 - 1차 진행 중이면 current.question, 건너뛴 문항을 복습 중에 다시
  // 열었으면 그 문항. 필기 낙서장을 문항이 바뀔 때마다 새로 시작하는 기준으로도 쓴다.
  const activeQuestion: PublicQuestion | null =
    reviewOpenId != null ? (pending?.find((q) => q.id === reviewOpenId) ?? null) : (current?.question ?? null);

  useEffect(() => {
    penRef.current?.clear();
  }, [activeQuestion?.id]);

  // 대기 화면: 학생이 직접 시작하지 않고, 교사가 '시험 감독' 화면에서 시험을 시작하면
  // 자동으로 응시가 시작된다. 그 전환을 감지하기 위해 대기 중에는 주기적으로 세션
  // 상태를 다시 불러온다.
  useEffect(() => {
    if (session?.status !== 'joined') return;
    const interval = setInterval(reloadSession, 2000);
    return () => clearInterval(interval);
  }, [session?.status, reloadSession]);

  // 교사가 시험 감독 화면에서 이 학생에게만 시간을 더 줬을 수 있다(extra_time_sec) -
  // 카운트다운 마감 시각에 바로 반영되도록 주기적으로 세션을 다시 불러온다. 강제 종료된
  // 뒤에도 계속 불러오는 이유는, 교사가 "되살리기"를 누르면 상태가 다시 in_progress로
  // 바뀌는데 그걸 학생 화면이 스스로 알아챌 방법이 이 폴링 말고는 없기 때문이다(그렇지
  // 않으면 종료 화면에 멈춘 채로 새로고침해야만 다시 이어서 풀 수 있게 된다).
  useEffect(() => {
    const wasForceSubmitted = session?.status === 'force_submitted';
    if (!wasForceSubmitted && session?.status !== 'in_progress') return;
    const interval = setInterval(async () => {
      const updated = await reloadSession();
      if (wasForceSubmitted && updated.status === 'in_progress') {
        // 되살아났다 - 전체화면/이탈 감지 상태를 처음부터 다시 잡도록 시작 게이트로 되돌린다.
        setExamStarted(false);
        disqualifyingRef.current = false;
        fullscreenArmedRef.current = false;
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [session?.status, reloadSession]);

  // 카운트다운
  useEffect(() => {
    if (session?.status !== 'in_progress' || !session.started_at || !exam) return;
    const deadline =
      new Date(session.started_at).getTime() + (exam.time_limit_sec + (session.extra_time_sec ?? 0)) * 1000;

    const tick = () => {
      const left = Math.max(0, Math.round((deadline - Date.now()) / 1000));
      setRemainingSec(left);
      if (left <= 0) {
        api.post(`/exams/${id}/sessions/${sessionId}/submit`).then(reloadSession);
      }
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [session, exam, id, sessionId, reloadSession]);

  // 응시 중 다른 화면으로 이탈하면(탭 전환, 창 최소화, 전체화면 해제 등) 즉시 지금까지
  // 낸 답만으로 시험을 강제 제출 처리한다 - 경고를 몇 번 봐주는 방식은 "나가서 답을
  // 찾아보고 돌아오면 그만"인 허점이 있어서, 첫 이탈부터 바로 종료시키는 쪽으로 바꿨다.
  // 억울하게(알림창, 실수 등) 종료된 경우엔 교사에게 소명해서 "되살리기"로 이어서 풀면 된다.
  useEffect(() => {
    if (session?.status !== 'in_progress') return;
    disqualifyingRef.current = false;

    async function disqualify(type: 'visibility_hidden' | 'window_blur') {
      // blur/visibilitychange/fullscreenchange가 같은 탭 전환 한 번에 여러 번 겹쳐 뜰 수
      // 있다 - 한 번만 요청을 보내면 충분하다(서버도 in_progress가 아니면 무시하므로
      // 중복 요청 자체는 안전하지만, 화면 전환을 굳이 여러 번 반복할 필요는 없다).
      if (disqualifyingRef.current) return;
      disqualifyingRef.current = true;
      try {
        await api.post(`/exams/${id}/sessions/${sessionId}/warning`, { type });
      } catch {
        // 네트워크 오류 등은 무시 - 아래 reloadSession이 최신 상태를 다시 가져온다.
      }
      await reloadSession();
      setCurrent(null);
      setPending(null);
    }

    function onVisibilityChange() {
      if (document.hidden) disqualify('visibility_hidden');
    }
    function onBlur() {
      disqualify('window_blur');
    }
    // 전체화면 모드로 응시 중이면(fullscreenArmedRef), 전체화면이 풀리는 순간도 이탈로
    // 본다 - 탭 전환/창 전환/최소화 대부분이 전체화면도 같이 해제시키므로 blur보다 더
    // 이르고 확실한 신호다. 서버 스키마에 별도 이벤트 타입을 추가하는 대신 기존
    // 'window_blur'로 기록한다(의미상 크게 다르지 않고, DB 마이그레이션을 피할 수 있다).
    function onFullscreenChange() {
      if (fullscreenArmedRef.current && !getFullscreenElementCompat()) disqualify('window_blur');
    }

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('blur', onBlur);
    addFullscreenChangeListener(onFullscreenChange);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('blur', onBlur);
      removeFullscreenChangeListener(onFullscreenChange);
    };
  }, [session?.status, id, sessionId, reloadSession]);

  // 시험이 시작되면(교사가 원격으로 시작시켜도) 바로 문제를 보여주지 않고, 학생이 직접
  // 누르게 해서 그 클릭을 전체화면 진입 제스처로 쓴다 - 브라우저는 사용자 동작 없이
  // 자동으로 전체화면에 들어가는 걸 허용하지 않는다. 전체화면을 지원하지 않는 환경
  // (예: iOS Safari)에서는 이 게이트 없이 바로 진행하고, 이탈 감지는 기존 방식(blur/
  // visibilitychange)에만 의존한다.
  async function startExam() {
    if (isFullscreenSupported()) {
      try {
        await requestFullscreenCompat(document.documentElement);
        fullscreenArmedRef.current = true;
      } catch {
        fullscreenArmedRef.current = false;
      }
    }
    setExamStarted(true);
  }

  // 응답 하나를 서버에 반영한 뒤 화면을 어디로 옮길지는 서버 응답만 보고 정한다 - 1차
  // 진행 중 문항이든, 건너뛴 뒤 복습 화면에서 뒤늦게 답한 문항이든 이 한 함수로 처리된다.
  async function afterAnswerLikeResponse(result: CurrentQuestionResponse) {
    if (result.done) {
      await reloadSession();
      setCurrent(null);
      setPending(null);
    } else if (result.reviewMode) {
      await loadPending();
    } else {
      await loadCurrentQuestion();
    }
  }

  async function submitAnswer() {
    if (!activeQuestion) return;
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = { question_id: activeQuestion.id };
      if (activeQuestion.type === 'mc') body.selected_choice_id = selectedChoice;
      else body.short_answer_text = shortAnswer;
      const strokes = penRef.current?.getStrokes() ?? [];
      if (strokes.length > 0) {
        body.strokes = strokes;
        body.strokes_canvas_size = penRef.current?.getCanvasSize();
      }

      const result = await api.post<CurrentQuestionResponse>(`/exams/${id}/sessions/${sessionId}/answers`, body);
      await afterAnswerLikeResponse(result);
    } catch {
      // 응답 전송 도중 화면 이탈이 감지돼 강제 종료됐을 수 있다 - 최신 세션
      // 상태를 다시 불러와 종료 화면으로 전환한다.
      await reloadSession();
      setCurrent(null);
      setPending(null);
    } finally {
      setSubmitting(false);
    }
  }

  // 1차 진행 중인 문항을 답하지 않고 건너뛴다 - 나중에 복습 단계에서 다시 보여준다.
  async function skipQuestion() {
    if (!current?.question) return;
    setSubmitting(true);
    try {
      const result = await api.post<CurrentQuestionResponse>(`/exams/${id}/sessions/${sessionId}/skip`, {
        question_id: current.question.id,
      });
      await afterAnswerLikeResponse(result);
    } catch {
      await reloadSession();
      setCurrent(null);
      setPending(null);
    } finally {
      setSubmitting(false);
    }
  }

  // 복습 목록에서 문항 하나를 "포기"로 마감한다(빈 답 처리) - 목록 화면에서 바로 누른다.
  async function giveUpQuestion(questionId: number) {
    setSubmitting(true);
    try {
      const result = await api.post<CurrentQuestionResponse>(`/exams/${id}/sessions/${sessionId}/give-up`, {
        question_id: questionId,
      });
      await afterAnswerLikeResponse(result);
    } catch {
      await reloadSession();
      setCurrent(null);
      setPending(null);
    } finally {
      setSubmitting(false);
    }
  }

  if (!session || !exam) {
    return <div className="p-10 text-sm text-ink-soft">불러오는 중...</div>;
  }

  if (session.status === 'joined') {
    return (
      <div className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center px-8 py-10 text-center">
        <h1 className="text-2xl font-bold text-ink">{exam.title}</h1>
        <p className="mt-3 text-base text-ink-soft">
          제한시간 {Math.round(exam.time_limit_sec / 60)}분 · 총 {exam.question_count}문항
        </p>
        <div className="mt-8 flex items-center gap-2">
          <span className="h-2 w-2 animate-pulse rounded-full bg-accent" />
          <p className="text-base font-bold text-ink-soft">선생님이 시험을 시작하면 자동으로 시작됩니다</p>
        </div>
        <AntiCheatNotice />
      </div>
    );
  }

  if (session.status === 'submitted' || session.status === 'force_submitted') {
    const pct =
      session.max_score && session.max_score > 0
        ? Math.round(((session.score ?? 0) / session.max_score) * 100)
        : 0;
    return (
      <div className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-8 py-10">
        <h1 className="text-2xl font-bold text-ink">
          {session.status === 'force_submitted' ? '시험이 강제 종료되었습니다' : '제출 완료'}
        </h1>
        {session.status === 'force_submitted' && (
          <p className="mt-1 text-sm text-ink-soft">
            {session.disqualify_reason === 'screen_leave'
              ? '다른 화면으로 이동한 것이 감지되어 자동으로 제출되었습니다. 실수였다면 선생님께 말씀해주세요.'
              : '선생님이 시험을 종료했습니다.'}
          </p>
        )}
        <Card className="mt-5">
          <p className="text-xs font-bold text-ink-soft">점수</p>
          <p className="mt-1 text-3xl font-bold text-ink">
            {session.score} / {session.max_score}
          </p>
          <p className="mt-1 text-sm text-ink-soft">정답률 {pct}%</p>
        </Card>
        <div className="mt-5 flex flex-wrap gap-2">
          {(session.answers ?? []).map((a) => (
            <span
              key={a.order_index}
              className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold ${
                a.is_correct ? 'bg-good/15 text-good' : 'bg-danger/15 text-danger'
              }`}
            >
              {a.order_index + 1}
            </span>
          ))}
        </div>
      </div>
    );
  }

  // in_progress지만 아직 전체화면 진입 제스처를 거치지 않았으면(지원하는 환경에서만) 문제를
  // 바로 보여주지 않고 시작 버튼을 먼저 누르게 한다.
  if (session.status === 'in_progress' && !examStarted && isFullscreenSupported()) {
    return (
      <div className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center px-8 py-10 text-center">
        <h1 className="text-2xl font-bold text-ink">{exam.title}</h1>
        <p className="mt-3 text-base text-ink-soft">
          제한시간 {Math.round(exam.time_limit_sec / 60)}분 · 총 {exam.question_count}문항
        </p>
        <AntiCheatNotice />
        <Button className="mt-8 text-base" onClick={startExam}>
          시험 시작하기
        </Button>
      </div>
    );
  }

  // in_progress - 건너뛴 문항 복습 목록 화면 (아직 하나도 열지 않은 상태)
  if (pending && reviewOpenId === null) {
    return (
      <div className="mx-auto flex min-h-screen max-w-2xl flex-col px-6 py-10">
        <h1 className="text-xl font-bold text-ink">건너뛴 문제 다시 보기</h1>
        <p className="mt-1 text-sm text-ink-soft">
          아직 답하지 않은 문제가 {pending.length}개 남아있어요. 풀거나, 포기하고 제출할 수 있어요.
        </p>
        <div className="mt-6 flex flex-col gap-2">
          {pending.map((pq) => (
            <div
              key={pq.id}
              className="flex items-center justify-between gap-3 rounded-xl border border-line bg-panel px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold text-ink-soft">{pq.order_index + 1}번</p>
                <p className="truncate text-sm text-ink">
                  {pq.prompt ? (
                    <MathText text={pq.prompt} />
                  ) : pq.prompt_image_path ? (
                    '(그림 문항)'
                  ) : (
                    '(종이 시험지 문항)'
                  )}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button variant="secondary" onClick={() => setReviewOpenId(pq.id)}>
                  풀기
                </Button>
                <Button variant="danger" disabled={submitting} onClick={() => giveUpQuestion(pq.id)}>
                  포기
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!activeQuestion) {
    return <div className="p-10 text-sm text-ink-soft">다음 문항을 불러오는 중...</div>;
  }
  const q = activeQuestion;
  const isReview = reviewOpenId != null;
  const isLast = !isReview && (current?.index ?? 0) + 1 >= (current?.total ?? 0);
  const canSubmit = !submitting && (q.type === 'mc' ? selectedChoice !== null : !!shortAnswer.trim());

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-bg">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-line bg-panel px-4 py-2.5 sm:px-6">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-ink">{exam.title}</p>
        </div>
        <Badge tone={isReview ? 'warn' : 'neutral'}>
          {isReview ? '복습 · ' : ''}
          {q.order_index + 1} / {exam.question_count}
        </Badge>
        {remainingSec !== null && (
          <Badge tone={remainingSec <= 30 ? 'danger' : 'neutral'}>{formatTime(remainingSec)}</Badge>
        )}
        <div className="flex items-center gap-1">
          {penActive && (
            <>
              {PEN_COLORS.map((c) => (
                <button
                  key={c}
                  aria-label={`펜 색상 ${c}`}
                  onClick={() => {
                    setPenTool('pen');
                    setPenColor(c);
                  }}
                  className={`h-6 w-6 shrink-0 rounded-full border-2 transition-transform ${
                    penTool === 'pen' && penColor === c ? 'scale-110 border-accent' : 'border-transparent'
                  }`}
                  style={{ backgroundColor: c }}
                />
              ))}
              <button
                aria-label="지우개"
                onClick={() => setPenTool('eraser')}
                className={`ml-1 rounded-lg p-1.5 ${
                  penTool === 'eraser' ? 'bg-accent-soft text-accent-ink' : 'text-ink-soft hover:bg-surface-container'
                }`}
              >
                <IconEraser className="h-4.5 w-4.5" />
              </button>
              <button
                aria-label="한 획 되돌리기"
                disabled={!hasStrokes}
                onClick={() => penRef.current?.undo()}
                className="rounded-lg p-1.5 text-ink-soft hover:bg-surface-container disabled:opacity-30"
              >
                <IconUndo className="h-4.5 w-4.5" />
              </button>
              <button
                aria-label="필기 전체 지우기"
                disabled={!hasStrokes}
                onClick={() => penRef.current?.clear()}
                className="rounded-lg p-1.5 text-ink-soft hover:bg-surface-container disabled:opacity-30"
              >
                <IconTrash className="h-4.5 w-4.5" />
              </button>
              <button
                aria-label="손가락 필기 모드 켜기/끄기"
                title="펜이 없으면 손가락으로도 필기할 수 있어요"
                onClick={() => {
                  const next = !fingerMode;
                  setFingerMode(next);
                  localStorage.setItem(FINGER_MODE_KEY, next ? '1' : '0');
                }}
                className={`ml-1 rounded-lg p-1.5 ${
                  fingerMode ? 'bg-accent-soft text-accent-ink' : 'text-ink-soft hover:bg-surface-container'
                }`}
              >
                <IconHand className="h-4.5 w-4.5" />
              </button>
            </>
          )}
          <button
            aria-label="펜 필기 켜기/끄기"
            onClick={() => setPenActive((v) => !v)}
            className={`rounded-lg p-1.5 ${
              penActive ? 'bg-accent text-white' : 'text-ink-soft hover:bg-surface-container'
            }`}
          >
            <IconPen className="h-4.5 w-4.5" />
          </button>
        </div>
      </header>

      <div className="relative min-h-0 flex-1">
        <div key={q.id} className="animate-fade-in-up h-full overflow-y-auto">
          {/* min-h를 화면 높이보다 더 크게 잡아서, 문제가 화면 위쪽 절반 정도만 차지하고
              나머지(오른쪽/아래쪽)는 필기용 여백으로 남도록 한다. 스크롤을 내리면 그만큼
              더 넓은 빈 연습장이 이어서 나온다. */}
          <div className="relative min-h-[calc(100%+100vh)] px-6 py-8 sm:px-10">
            <div className="max-w-md">
              {q.prompt_image_path ? (
                <img
                  src={`/uploads/${q.prompt_image_path}`}
                  alt={`${q.order_index + 1}번 문항`}
                  className="max-w-full rounded-lg border border-line"
                />
              ) : q.prompt ? (
                <p className="whitespace-pre-wrap text-base font-bold text-ink">
                  <MathText text={q.prompt} />
                </p>
              ) : (
                <p className="text-base text-ink-soft">종이 시험지의 {q.order_index + 1}번 문항을 마킹하세요.</p>
              )}
            </div>

            {/* 필기는 문제/선택지 영역을 포함한 연습장 전체 위에 덮인다 - 켜져 있는 동안엔
                기본적으로 S-Pen 입력만 받고(팜 리젝션) 손가락은 무시하지만, 손가락 필기
                모드(fingerMode)가 켜져 있으면 펜이 없는 학생을 위해 손가락도 필기로 받는다.
                다시 끄면 원래대로 조작 가능. 스크롤 컨테이너 안에 함께 있어서 필기도
                문제와 같이 스크롤된다. */}
            <PenCanvas
              ref={penRef}
              active={penActive}
              tool={penTool}
              color={penColor}
              allowTouch={fingerMode}
              onStrokesChange={setHasStrokes}
            />
          </div>
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-line bg-panel px-4 py-3 sm:px-6">
        {q.type === 'short' && (
          <input
            className="w-full min-w-0 rounded-xl border border-line bg-bg px-4 py-2.5 text-base text-ink outline-none focus:border-accent sm:w-[28rem]"
            placeholder="정답 입력"
            value={shortAnswer}
            onChange={(e) => setShortAnswer(e.target.value)}
          />
        )}
        {q.type === 'mc' && q.prompt_image_path && (
          <div className="flex flex-wrap gap-2">
            {q.choices.map((c, i) => (
              <button
                key={c.id}
                className={`h-11 w-11 rounded-full border text-base font-bold transition-all duration-150 ${
                  selectedChoice === c.id
                    ? 'border-accent bg-accent-soft text-accent-ink'
                    : 'border-line bg-panel text-ink hover:border-accent/50'
                }`}
                onClick={() => setSelectedChoice(c.id)}
              >
                {i + 1}
              </button>
            ))}
          </div>
        )}
        {/* 이미지에 보기가 이미 포함된 경우(위)엔 번호만 고르면 되지만, 텍스트로만 된
            문항(수동으로 직접 만든 문항 등)은 보기 내용을 여기서도 보여줘야 한다 - 문항
            종류가 달라도 "정답을 고르는 자리"는 항상 화면 오른쪽 아래로 같아야 한다. */}
        {q.type === 'mc' && !q.prompt_image_path && (
          <div className="flex flex-wrap justify-end gap-2">
            {q.choices.map((c) => (
              <button
                key={c.id}
                className={`rounded-xl border px-3.5 py-2.5 text-left text-sm transition-all duration-150 ${
                  selectedChoice === c.id
                    ? 'border-accent bg-accent-soft text-accent-ink'
                    : 'border-line bg-panel text-ink hover:border-accent/50'
                }`}
                onClick={() => setSelectedChoice(c.id)}
              >
                <MathText text={c.text} />
              </button>
            ))}
          </div>
        )}
        {isReview ? (
          <Button variant="secondary" className="text-base" disabled={submitting} onClick={loadPending}>
            목록으로
          </Button>
        ) : (
          <Button variant="secondary" className="text-base" disabled={submitting} onClick={skipQuestion}>
            건너뛰기
          </Button>
        )}
        <Button className="text-base" disabled={!canSubmit} onClick={submitAnswer}>
          {isReview ? '제출' : isLast ? '제출하기' : '다음'}
        </Button>
      </div>
    </div>
  );
}
