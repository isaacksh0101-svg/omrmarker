import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api/client';
import type {
  CurrentQuestionResponse,
  ExamSession,
  PendingQuestionsResponse,
  PublicExam,
  PublicQuestion,
  WarningResponse,
} from '../../types';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { Badge } from '../../components/Badge';
import { PenCanvas, type PenCanvasHandle, type PenTool } from '../../components/PenCanvas';
import { MathText } from '../../components/MathText';
import { IconEraser, IconPen, IconTrash, IconUndo } from '../../components/icons';

const PEN_COLORS = ['#1b1c22', '#f04438', '#3258ce'];

function formatTime(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function TakeExam() {
  const { examId } = useParams();
  const navigate = useNavigate();
  const id = Number(examId);
  const sessionId = Number(localStorage.getItem(`omr_session_${id}`));

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
    if (!Number.isInteger(sessionId)) {
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
  // 카운트다운 마감 시각에 바로 반영되도록 주기적으로 세션을 다시 불러온다.
  useEffect(() => {
    if (session?.status !== 'in_progress') return;
    const interval = setInterval(reloadSession, 5000);
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

  // 응시 중 다른 화면으로 이탈하면(탭 전환, 창 최소화 등) 서버에 기록하고 학생에게도
  // 경고 팝업을 띄운다. 정해진 횟수(기본 3회)를 넘기면 서버가 시험을 강제 제출 처리하므로,
  // 그 결과를 받아 화면도 바로 종료 상태로 전환한다.
  //
  // 안드로이드 크롬 등 모바일 브라우저는 화면이 안 보이는 동안(document.hidden) 뜬
  // alert()를 아예 무시하거나 띄우지 못한다 - 다른 앱으로 전환한 "그 순간"에 경고를
  // 기록하면서 동시에 alert()를 호출하면, 기록은 서버에 정상적으로 남지만 팝업은 학생
  // 눈에 보이지 않은 채 사라져버렸다. 그래서 팝업 문구는 일단 담아두고, 화면/창이 실제로
  // 다시 보이는 시점(visibilitychange로 visible이 되거나 window focus)에 띄운다.
  useEffect(() => {
    if (session?.status !== 'in_progress') return;

    let pendingAlert: string | null = null;
    function flushPendingAlert() {
      if (pendingAlert) {
        const msg = pendingAlert;
        pendingAlert = null;
        alert(msg);
      }
    }

    async function report(type: 'visibility_hidden' | 'window_blur') {
      try {
        const res = await api.post<WarningResponse>(`/exams/${id}/sessions/${sessionId}/warning`, { type });
        if (!res.counted) return;
        if (res.disqualified) {
          pendingAlert = `화면 이탈이 ${res.warning_count}회 감지되어 시험이 강제 종료되었습니다.`;
          await reloadSession();
          setCurrent(null);
          setPending(null);
        } else {
          const remaining = res.max_warnings - res.warning_count;
          pendingAlert = `다른 화면으로 이동한 것이 감지되었습니다. (${res.warning_count}/${res.max_warnings}회)\n${remaining}회 더 감지되면 시험이 강제 종료됩니다.`;
        }
        if (!document.hidden) flushPendingAlert();
      } catch {
        // 네트워크 오류 등은 무시 - 경고 기록은 부가 기능이라 시험 진행을 막지 않는다.
      }
    }
    function onVisibilityChange() {
      if (document.hidden) {
        report('visibility_hidden');
      } else {
        flushPendingAlert();
      }
    }
    function onBlur() {
      report('window_blur');
    }
    function onFocus() {
      flushPendingAlert();
    }

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
    };
  }, [session?.status, id, sessionId, reloadSession]);

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

      const result = await api.post<CurrentQuestionResponse>(`/exams/${id}/sessions/${sessionId}/answers`, body);
      await afterAnswerLikeResponse(result);
    } catch {
      // 응답 전송 도중 화면 이탈 경고 누적으로 강제 종료됐을 수 있다 - 최신 세션
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
          <p className="mt-1 text-sm text-ink-soft">화면 이탈이 반복되어 자동으로 제출되었습니다.</p>
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
        <div key={q.id} className="animate-fade-in-up h-full overflow-y-auto px-6 py-8 sm:px-10">
          <div className="mx-auto max-w-3xl">
            {q.prompt_image_path ? (
              <img
                src={`/uploads/${q.prompt_image_path}`}
                alt={`${q.order_index + 1}번 문항`}
                className="max-w-full rounded-lg border border-line"
              />
            ) : q.prompt ? (
              <p className="whitespace-pre-wrap text-xl font-bold text-ink">
                <MathText text={q.prompt} />
              </p>
            ) : (
              <p className="text-base text-ink-soft">종이 시험지의 {q.order_index + 1}번 문항을 마킹하세요.</p>
            )}

            {q.type === 'mc' && (
              <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
                {q.choices.map((c) => (
                  <button
                    key={c.id}
                    className={`rounded-xl border px-4 py-3.5 text-left text-base transition-all duration-150 ${
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
          </div>
        </div>

        {/* 필기는 이 문항 영역 위에만 덮인다 - 켜져 있는 동안엔 S-Pen 입력만 받고(팜 리젝션),
            아래 선택지 등은 손가락으로 건드려도 반응하지 않는다. 다시 끄면 원래대로 조작 가능. */}
        <PenCanvas
          ref={penRef}
          active={penActive}
          tool={penTool}
          color={penColor}
          onStrokesChange={setHasStrokes}
        />
      </div>

      <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-line bg-panel px-4 py-3 sm:px-6">
        {q.type === 'short' && (
          <input
            className="min-w-0 flex-1 rounded-xl border border-line bg-bg px-4 py-2.5 text-base text-ink outline-none focus:border-accent sm:max-w-xs"
            placeholder="정답 입력"
            value={shortAnswer}
            onChange={(e) => setShortAnswer(e.target.value)}
          />
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
