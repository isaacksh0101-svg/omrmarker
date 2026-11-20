import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../../api/client';
import type { ReviewQuestionsResponse } from '../../types';
import { Button } from '../../components/Button';
import { Badge } from '../../components/Badge';
import { Card } from '../../components/Card';
import { ChoiceNumberPicker, ChoiceTextList } from '../../components/ChoiceList';
import { QuestionPrompt } from '../../components/QuestionPrompt';
import { PenCanvas, type PenCanvasHandle, type PenTool } from '../../components/PenCanvas';
import { IconEraser, IconFingerDraw, IconGrip, IconPen, IconTrash, IconUndo } from '../../components/icons';
import { isFullscreenSupported, requestFullscreenCompat } from '../../lib/fullscreen';
import { AnswerAppeals, AppealItem } from './AnswerAppeals';
import { clearLocalStrokes, clearOtherLocalStrokes, loadLocalStrokes, saveLocalStrokes } from '../../lib/localStrokes';

const PEN_COLORS = ['#1b1c22', '#f04438', '#3258ce'];

function useVisibleViewport() {
  const read = () => ({
    width: window.visualViewport?.width ?? window.innerWidth,
    height: window.visualViewport?.height ?? window.innerHeight,
    left: window.visualViewport?.offsetLeft ?? 0,
    top: window.visualViewport?.offsetTop ?? 0,
  });
  const [viewport, setViewport] = useState(read);
  useEffect(() => {
    const update = () => setViewport(read());
    const visual = window.visualViewport;
    visual?.addEventListener('resize', update);
    visual?.addEventListener('scroll', update);
    window.addEventListener('resize', update);
    return () => {
      visual?.removeEventListener('resize', update);
      visual?.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, []);
  return viewport;
}

export function ReviewMistakes() {
  const { examId } = useParams();
  const navigate = useNavigate();
  const id = Number(examId);
  const accessToken = localStorage.getItem(`omr_session_${id}`) ?? '';
  const [data, setData] = useState<ReviewQuestionsResponse | null>(null);
  const [index, setIndex] = useState(0);
  const [selectedChoices, setSelectedChoices] = useState<number[]>([]);
  const [shortAnswer, setShortAnswer] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 방금 확인한 답이 맞았는지/틀렸는지 보여주는 표시. 문항은 학생이 이전/다음/번호로 자유롭게
  // 오가고, 틀린 문항은 다시 풀거나 건너뛰었다가 나중에 돌아와도 된다.
  const [feedback, setFeedback] = useState<'correct' | 'wrong' | null>(null);
  // "그만 풀기"를 한 번 누르면 못 맞힌 문항 수를 보여주고 한 번 더 확인받는다.
  const [confirmingFinish, setConfirmingFinish] = useState(false);
  // 서술형 재풀이에서 핵심 내용을 몇 개 담았는지(어떤 키워드인지는 알려주지 않는다).
  const [essayProgress, setEssayProgress] = useState<{ matched: number; total: number } | null>(null);
  const [penTool, setPenTool] = useState<PenTool>('pen');
  const [penColor, setPenColor] = useState(PEN_COLORS[0]);
  // 기기를 공유하는 교실 특성상 저장해두지 않는다 - 매번 펜 모드로 새로 시작한다(TakeExam과 동일).
  const [fingerMode, setFingerMode] = useState(false);
  const [hasStrokes, setHasStrokes] = useState(false);
  // 목록 화면에서 이 항목을 누른 클릭 자체는 전체화면 진입 제스처로 쓸 수 없다(그 사이
  // 페이지 이동과 데이터 로딩이 끼어든다) - 그래서 여기서도 TakeExam과 똑같이 학생이
  // 직접 누르는 시작 버튼을 한 번 더 거쳐서 그 클릭을 전체화면 진입 제스처로 쓴다.
  const [started, setStarted] = useState(false);
  const penRef = useRef<PenCanvasHandle>(null);
  const floatRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ pointerId: number; offsetX: number; offsetY: number } | null>(null);
  const [floatPos, setFloatPos] = useState<{ x: number; y: number } | null>(null);
  const [floatSize, setFloatSize] = useState({ width: 0, height: 0 });
  const viewport = useVisibleViewport();

  useEffect(() => {
    if (!accessToken) {
      setError('이 기기에서 응시한 기록을 찾을 수 없습니다.');
      return;
    }
    api.get<ReviewQuestionsResponse>(`/exams/${id}/review?access_token=${encodeURIComponent(accessToken)}`)
      .then((result) => {
        setData(result);
        // 맞을 때까지 다시 풀어야 하므로, 이어서 시작할 위치는 "아직 정답을 못 맞힌" 첫
        // 문항이다(단순히 답을 낸 개수가 아니라).
        const correctIds = new Set(result.answers.filter((a) => a.is_correct).map((a) => a.question_id));
        const firstUnsolved = result.questions.findIndex((q) => !correctIds.has(q.id));
        setIndex(firstUnsolved === -1 ? Math.max(0, result.questions.length - 1) : firstUnsolved);
      })
      .catch((cause) => setError(cause instanceof ApiError ? cause.message : '오답 재풀이를 불러오지 못했습니다.'));
  }, [id, accessToken]);

  const correctCount = useMemo(() => data?.answers.filter((answer) => !!answer.is_correct).length ?? 0, [data]);
  const completed = data?.assignment.status === 'completed' || (!!data && correctCount >= data.questions.length);
  const question = data?.questions[index];
  // 문항별 상태: 'correct'(맞힘) | 'wrong'(확인했지만 아직 틀림) | undefined(아직 안 품)
  const statusById = useMemo(() => {
    const map = new Map<number, 'correct' | 'wrong'>();
    for (const answer of data?.answers ?? []) map.set(answer.question_id, answer.is_correct ? 'correct' : 'wrong');
    return map;
  }, [data]);
  const unsolvedCount = (data?.questions.length ?? 0) - correctCount;
  const alreadyCorrect = !!question && statusById.get(question.id) === 'correct';
  const appealTarget = question ? data?.appeal_targets?.find((a) => a.question_id === question.id) : undefined;
  const canSubmit = !alreadyCorrect && (question?.type === 'mc' ? selectedChoices.length > 0 : shortAnswer.trim().length > 0);

  // 문항을 오갈 때 필기가 사라지지 않도록 이 기기에 문항별로 남겨 두고 다시 그린다(lib/localStrokes).
  const strokeQuestionIdRef = useRef<number | null>(null);
  useEffect(() => {
    strokeQuestionIdRef.current = null;
    const qid = question?.id;
    penRef.current?.load(qid != null ? loadLocalStrokes('review', accessToken, qid) : null);
    strokeQuestionIdRef.current = qid ?? null;
  }, [question?.id, accessToken, started]);

  function handleStrokesChange(has: boolean) {
    setHasStrokes(has);
    const qid = strokeQuestionIdRef.current;
    const pen = penRef.current;
    if (qid == null || !pen) return;
    saveLocalStrokes('review', accessToken, qid, pen.getStrokes(), pen.getCanvasSize());
  }

  // 재풀이를 다 마치면 이 기기에 남긴 필기를 지운다. 앞서 이 기기를 쓴 다른 학생의 필기도 지운다.
  useEffect(() => {
    if (!accessToken) return;
    clearOtherLocalStrokes('review', accessToken);
    if (completed) clearLocalStrokes('review', accessToken);
  }, [accessToken, completed]);

  useEffect(() => {
    setFloatPos(null);
    setFeedback(null);
    setEssayProgress(null);
    setSelectedChoices([]);
    setShortAnswer('');
  }, [question?.id]);

  function goTo(next: number) {
    if (!data) return;
    setConfirmingFinish(false);
    setIndex(Math.max(0, Math.min(next, data.questions.length - 1)));
  }

  async function reload() {
    const refreshed = await api.get<ReviewQuestionsResponse>(`/exams/${id}/review?access_token=${encodeURIComponent(accessToken)}`);
    setData(refreshed);
  }

  // "그만 풀기"는 재풀이를 마감하지 않고 화면만 나간다 - 못 맞힌 문항은 다음에 들어오면
  // 이어서 풀 수 있고, 다 맞히면 그때 완료된다. 끝까지 못 맞히는 경우는 교사가 마감한다.
  function leave() {
    navigate('/student');
  }

  useEffect(() => {
    const panel = floatRef.current;
    if (!panel) return;
    const measure = () => setFloatSize({ width: panel.offsetWidth, height: panel.offsetHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(panel);
    return () => observer.disconnect();
    // started가 true로 바뀌어야 이 패널이 실제로 마운트된다(그 전엔 "시작하기" 게이트
    // 화면이라 floatRef가 아직 null) - started를 의존성에서 빼면 게이트를 넘어간 뒤에도
    // 이 effect가 다시 안 돌아서 floatSize가 0으로 남고, 그 결과 세로 위치 계산이 패널을
    // 화면 아래로 밀어내 안 보이게 된다(TakeExam.tsx도 examStarted를 넣어 같은 문제를 피함).
  }, [question?.id, started]);

  function dragStart(event: React.PointerEvent) {
    const rect = floatRef.current?.getBoundingClientRect();
    if (!rect) return;
    dragRef.current = { pointerId: event.pointerId, offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function dragMove(event: React.PointerEvent) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const minX = viewport.left + 8;
    const minY = viewport.top + 8;
    const maxX = Math.max(minX, viewport.left + viewport.width - floatSize.width - 8);
    const maxY = Math.max(minY, viewport.top + viewport.height - floatSize.height - 8);
    setFloatPos({ x: Math.min(Math.max(minX, event.clientX - drag.offsetX), maxX), y: Math.min(Math.max(minY, event.clientY - drag.offsetY), maxY) });
  }

  async function submit() {
    if (!question || !canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await api.post<{
        is_correct: boolean;
        done: boolean;
        answered_count: number;
        essay_progress: { matched: number; total: number } | null;
      }>(
        `/exams/${id}/review/answer`,
        {
          access_token: accessToken,
          question_id: question.id,
          ...(question.multi_select
            ? { selected_choice_ids: selectedChoices }
            : { selected_choice_id: selectedChoices[0] ?? null }),
          short_answer_text: shortAnswer,
        },
      );
      // 번호 버튼 색(맞힘/틀림)을 바로 바꾸기 위해 목록을 다시 불러오지 않고 여기서 고친다.
      setData((prev) => {
        if (!prev) return prev;
        const rest = prev.answers.filter((a) => a.question_id !== question.id);
        return { ...prev, answers: [...rest, { question_id: question.id, order_index: question.order_index, is_correct: result.is_correct ? 1 : 0 }] };
      });
      if (!result.is_correct) {
        // 틀렸으면 같은 문항에 머물러 결과만 보여준다 - 다시 풀지, 다음 문항으로 넘어갈지는
        // 학생이 고른다. 선택은 비워서 다시 고르기 쉽게 한다.
        setFeedback('wrong');
        setEssayProgress(result.essay_progress);
        setSelectedChoices([]);
        // 서술형은 쓴 답을 지우지 않고 빠진 내용을 보태서 다시 내게 한다.
        if (!question.essay) setShortAnswer('');
        return;
      }
      setFeedback('correct');
      if (result.done) await reload();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : '답안을 제출하지 못했습니다.');
    } finally {
      setSubmitting(false);
    }
  }

  async function start() {
    if (isFullscreenSupported()) {
      try {
        await requestFullscreenCompat(document.documentElement);
      } catch {
        // 무시 - 전체화면 없이도 재풀이 자체는 계속 진행할 수 있다.
      }
    }
    setStarted(true);
  }

  if (error && !data) {
    return <div className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center px-8 text-center">
      <p className="text-sm font-bold text-danger">{error}</p>
      <Button className="mt-5" variant="secondary" onClick={() => navigate('/student')}>처음으로</Button>
    </div>;
  }
  if (!data) return <div className="p-10 text-sm text-ink-soft">불러오는 중...</div>;

  if (!completed && !started && isFullscreenSupported()) {
    return (
      <div className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center px-8 py-10 text-center">
        <h1 className="text-2xl font-bold text-ink">{data.exam_title} · 오답 재풀이</h1>
        <p className="mt-3 text-base text-ink-soft">틀렸던 문항 {data.questions.length}개를 다시 풀어봐요.</p>
        <Button className="mt-8 text-base" onClick={start}>
          시작하기
        </Button>
      </div>
    );
  }

  if (completed) {
    return <div className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-8 py-10">
      <h1 className="text-2xl font-bold text-ink">오답 재풀이 완료</h1>
      <p className="mt-2 text-sm text-ink-soft">최초 시험 점수는 변경되지 않으며 재풀이 결과는 별도로 저장됩니다.</p>
      <Card className="mt-5">
        <p className="text-xs font-bold text-ink-soft">재풀이 결과</p>
        <p className="mt-1 text-3xl font-bold text-ink">{correctCount} / {data.questions.length}</p>
      </Card>
      <div className="mt-5 flex flex-wrap gap-2">{data.questions.map((q) => {
        const status = statusById.get(q.id);
        return <span key={q.id} className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold ${status === 'correct' ? 'bg-good/15 text-good' : status === 'wrong' ? 'bg-danger/15 text-danger' : 'bg-surface-container text-ink-soft'}`}>
          {q.order_index + 1}
        </span>;
      })}</div>
      <AnswerAppeals examId={id} sessionToken={accessToken} targets={data.appeal_targets ?? []} onSent={reload} />
      <Button className="mt-7 self-start" onClick={() => navigate('/student')}>다른 시험 응시하기</Button>
    </div>;
  }

  if (!question) return <div className="p-10 text-sm text-ink-soft">재풀이 문항이 없습니다.</div>;
  const minX = viewport.left + 8;
  const minY = viewport.top + 8;
  const maxX = Math.max(minX, viewport.left + viewport.width - floatSize.width - 8);
  const maxY = Math.max(minY, viewport.top + viewport.height - floatSize.height - 12);
  const panelPosition = {
    x: Math.min(Math.max(minX, floatPos?.x ?? viewport.left + (viewport.width - floatSize.width) / 2), maxX),
    y: Math.min(Math.max(minY, floatPos?.y ?? maxY), maxY),
  };

  return <div className="flex flex-col overflow-hidden bg-bg" style={{ height: viewport.height }}>
    <header className="flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-line bg-panel px-4 py-2.5 sm:px-6">
      <p className="min-w-0 flex-1 truncate text-base font-bold text-ink">{data.exam_title} · 오답 재풀이</p>
      <Badge tone="warn">맞힘 {correctCount} / {data.questions.length}</Badge>
      {/* 번호를 눌러 원하는 문항으로 바로 간다. 초록=맞힘, 빨강=틀림, 회색=아직 안 품. */}
      <div className="flex w-full flex-wrap gap-1.5 sm:order-last">
        {data.questions.map((q, i) => {
          const status = statusById.get(q.id);
          return <button key={q.id} type="button" onClick={() => goTo(i)} aria-label={`원래 시험 ${q.order_index + 1}번으로 가기`}
            className={`flex h-8 min-w-8 items-center justify-center rounded-full px-2 text-sm font-bold ${i === index ? 'ring-2 ring-accent' : ''} ${status === 'correct' ? 'bg-good/15 text-good' : status === 'wrong' ? 'bg-danger/15 text-danger' : 'bg-surface-container text-ink-soft'}`}>
            {q.order_index + 1}
          </button>;
        })}
      </div>
      <div className="flex w-full items-center justify-between gap-1 sm:w-auto sm:justify-start">
        {PEN_COLORS.map((color) => <button key={color} aria-label={`펜 색상 ${color}`} onClick={() => { setPenTool('pen'); setPenColor(color); }} className={`h-6 w-6 rounded-full border-2 ${penTool === 'pen' && penColor === color ? 'scale-110 border-accent' : 'border-transparent'}`} style={{ backgroundColor: color }} />)}
        <button aria-label="지우개" onClick={() => setPenTool('eraser')} className={`ml-1 rounded-lg p-1.5 ${penTool === 'eraser' ? 'bg-accent-soft text-accent-ink' : 'text-ink-soft hover:bg-surface-container'}`}><IconEraser className="h-4.5 w-4.5" /></button>
        <button aria-label="한 획 되돌리기" disabled={!hasStrokes} onClick={() => penRef.current?.undo()} className="rounded-lg p-1.5 text-ink-soft hover:bg-surface-container disabled:opacity-30"><IconUndo className="h-4.5 w-4.5" /></button>
        <button aria-label="필기 전체 지우기" disabled={!hasStrokes} onClick={() => penRef.current?.clear()} className="rounded-lg p-1.5 text-ink-soft hover:bg-surface-container disabled:opacity-30"><IconTrash className="h-4.5 w-4.5" /></button>
        <button aria-label="손가락 필기 모드" onClick={() => { setFingerMode(true); setPenTool('pen'); }} className={`ml-1 flex h-8 w-8 items-center justify-center rounded-lg ${fingerMode ? 'bg-accent text-white' : 'text-ink-soft hover:bg-surface-container'}`}><IconFingerDraw className="h-4.5 w-4.5" /></button>
        <button aria-label="펜 필기 모드" onClick={() => { setFingerMode(false); setPenTool('pen'); }} className={`flex h-8 w-8 items-center justify-center rounded-lg ${!fingerMode ? 'bg-accent text-white' : 'text-ink-soft hover:bg-surface-container'}`}><IconPen className="h-4.5 w-4.5" /></button>
      </div>
    </header>
    <div className="relative min-h-0 flex-1">
      <div key={question.id} className="h-full overflow-y-auto">
        <div className="relative min-h-[calc(100%+100vh)] px-6 py-8 sm:px-10">
          <div className="max-w-md">
            <p className="mb-4 text-sm font-bold text-ink-soft">원래 시험 {question.order_index + 1}번</p>
            <QuestionPrompt prompt={question.prompt} imagePath={question.prompt_image_path} showPromptText={question.show_prompt_text} alt={`${question.order_index + 1}번 문항`} />
          </div>
          {/* 필기 레이어 위로 올려야 손가락으로 버튼을 누를 수 있다. */}
          {appealTarget && (
            <div className="relative z-10 mt-5 max-w-md">
              <AppealItem examId={id} sessionToken={accessToken} answer={appealTarget} onSent={reload} />
            </div>
          )}
          {question.type === 'mc' && <ChoiceTextList choices={question.choices} />}
          <PenCanvas ref={penRef} active tool={penTool} color={penColor} allowTouch={fingerMode} onStrokesChange={handleStrokesChange} />
        </div>
      </div>
    </div>
    <div ref={floatRef} className="fixed z-20 flex max-w-[calc(100vw-16px)] flex-wrap items-center gap-2 rounded-2xl border border-line bg-panel px-4 py-3 shadow-lg" style={{ left: panelPosition.x, top: panelPosition.y }}>
      <button type="button" aria-label="답안 입력창 위치 옮기기" className="-ml-1 flex h-7 w-6 touch-none items-center justify-center text-ink-soft" onPointerDown={dragStart} onPointerMove={dragMove} onPointerUp={() => { dragRef.current = null; }} onPointerCancel={() => { dragRef.current = null; }}><IconGrip className="h-4 w-4" /></button>
      {alreadyCorrect && (
        <p className="w-full text-sm font-bold text-good">
          {feedback === 'correct' ? '정답이에요! 다음 문제로 넘어가세요.' : '이미 맞힌 문제예요.'}
        </p>
      )}
      {feedback === 'wrong' && (
        <p className="w-full text-sm font-bold text-danger">
          {question.essay && essayProgress
            ? `핵심 내용 ${essayProgress.total}개 중 ${essayProgress.matched}개를 썼어요. 빠진 내용을 보태서 다시 확인해보세요.`
            : '오답이에요. 다시 풀어 보거나 다음 문제로 넘어가도 돼요.'}
        </p>
      )}
      {question.type === 'short' && question.essay && <textarea rows={4} value={shortAnswer} disabled={alreadyCorrect} onChange={(event) => { setShortAnswer(event.target.value); setFeedback(null); }} placeholder="답을 문장으로 써주세요" className="w-full min-w-0 resize-none rounded-xl border border-line bg-bg px-4 py-2.5 text-lg outline-none focus:border-accent sm:w-[32rem]" />}
      {question.type === 'short' && !question.essay && <input value={shortAnswer} disabled={alreadyCorrect} onChange={(event) => { setShortAnswer(event.target.value); setFeedback(null); }} placeholder="정답 입력" className="w-full min-w-0 rounded-xl border border-line bg-bg px-4 py-2.5 text-lg outline-none focus:border-accent sm:w-[28rem]" />}
      {question.type === 'mc' && <ChoiceNumberPicker choices={question.choices} selectedIds={selectedChoices} multiSelect={question.multi_select} onChange={(next) => { if (!alreadyCorrect) { setSelectedChoices(next); setFeedback(null); } }} />}
      <Button variant="secondary" className="text-base" disabled={submitting || index === 0} onClick={() => goTo(index - 1)}>이전</Button>
      <Button className="text-base" disabled={!canSubmit || submitting} onClick={submit}>{submitting ? '확인 중...' : '정답 확인'}</Button>
      <Button variant="secondary" className="text-base" disabled={submitting || index + 1 === data.questions.length} onClick={() => goTo(index + 1)}>다음</Button>
      {!confirmingFinish ? (
        <Button variant="secondary" className="text-base" disabled={submitting} onClick={() => setConfirmingFinish(true)}>그만 풀기</Button>
      ) : (
        <div className="flex w-full flex-wrap items-center gap-2">
          <p className="text-sm font-bold text-ink">
            {`아직 못 맞힌 문제가 ${unsolvedCount}개 있어요. 나중에 다시 들어오면 이어서 풀 수 있어요.`}
          </p>
          <Button className="text-base" disabled={submitting} onClick={leave}>나가기</Button>
          <Button variant="secondary" className="text-base" disabled={submitting} onClick={() => setConfirmingFinish(false)}>계속 풀기</Button>
        </div>
      )}
      {error && <p className="w-full text-xs font-bold text-danger">{error}</p>}
    </div>
  </div>;
}
