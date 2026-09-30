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
  // 방금 낸 답이 틀렸다는 걸 보여주는 표시 - 오답이면 다음 문항으로 넘기지 않고 같은
  // 문항에 머물러서, 맞힐 때까지 다시 고르게 한다.
  const [wrongFeedback, setWrongFeedback] = useState(false);
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
  const canSubmit = question?.type === 'mc' ? selectedChoices.length > 0 : shortAnswer.trim().length > 0;

  useEffect(() => {
    penRef.current?.clear();
    setFloatPos(null);
    setWrongFeedback(false);
  }, [question?.id]);

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
      if (!result.is_correct) {
        // 틀렸으면 다음으로 넘어가지 않고 같은 문항에 머문다 - 선택은 비워서 다시 고르게 한다.
        setWrongFeedback(true);
        setEssayProgress(result.essay_progress);
        setSelectedChoices([]);
        // 서술형은 쓴 답을 지우지 않고 빠진 내용을 보태서 다시 내게 한다.
        if (!question.essay) setShortAnswer('');
        return;
      }
      setWrongFeedback(false);
      if (result.done) {
        const refreshed = await api.get<ReviewQuestionsResponse>(`/exams/${id}/review?access_token=${encodeURIComponent(accessToken)}`);
        setData(refreshed);
      } else {
        setIndex((value) => value + 1);
        setSelectedChoices([]);
        setShortAnswer('');
      }
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
      <div className="mt-5 flex flex-wrap gap-2">{data.answers.map((answer) =>
        <span key={answer.question_id} className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold ${answer.is_correct ? 'bg-good/15 text-good' : 'bg-danger/15 text-danger'}`}>
          {answer.order_index + 1}
        </span>)}</div>
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
    <header className="flex shrink-0 items-center justify-between gap-3 border-b border-line bg-panel px-4 py-2.5 sm:px-6">
      <p className="min-w-0 flex-1 truncate text-base font-bold text-ink">{data.exam_title} · 오답 재풀이</p>
      <Badge tone="warn">{index + 1} / {data.questions.length}</Badge>
      <div className="flex items-center gap-1">
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
          {question.type === 'mc' && <ChoiceTextList choices={question.choices} />}
          <PenCanvas ref={penRef} active tool={penTool} color={penColor} allowTouch={fingerMode} onStrokesChange={setHasStrokes} />
        </div>
      </div>
    </div>
    <div ref={floatRef} className="fixed z-20 flex max-w-[calc(100vw-16px)] flex-wrap items-center gap-2 rounded-2xl border border-line bg-panel px-4 py-3 shadow-lg" style={{ left: panelPosition.x, top: panelPosition.y }}>
      <button type="button" aria-label="답안 입력창 위치 옮기기" className="-ml-1 flex h-7 w-6 touch-none items-center justify-center text-ink-soft" onPointerDown={dragStart} onPointerMove={dragMove} onPointerUp={() => { dragRef.current = null; }} onPointerCancel={() => { dragRef.current = null; }}><IconGrip className="h-4 w-4" /></button>
      {wrongFeedback && (
        <p className="w-full text-sm font-bold text-danger">
          {question.essay && essayProgress
            ? `핵심 내용 ${essayProgress.total}개 중 ${essayProgress.matched}개를 썼어요. 빠진 내용을 보태서 다시 제출해보세요.`
            : '오답이에요. 다시 골라보세요.'}
        </p>
      )}
      {question.type === 'short' && question.essay && <textarea rows={4} value={shortAnswer} onChange={(event) => { setShortAnswer(event.target.value); setWrongFeedback(false); }} placeholder="답을 문장으로 써주세요" className="w-full min-w-0 resize-none rounded-xl border border-line bg-bg px-4 py-2.5 text-lg outline-none focus:border-accent sm:w-[32rem]" />}
      {question.type === 'short' && !question.essay && <input value={shortAnswer} onChange={(event) => { setShortAnswer(event.target.value); setWrongFeedback(false); }} placeholder="정답 입력" className="w-full min-w-0 rounded-xl border border-line bg-bg px-4 py-2.5 text-lg outline-none focus:border-accent sm:w-[28rem]" />}
      {question.type === 'mc' && <ChoiceNumberPicker choices={question.choices} selectedIds={selectedChoices} multiSelect={question.multi_select} onChange={(next) => { setSelectedChoices(next); setWrongFeedback(false); }} />}
      <Button className="text-base" disabled={!canSubmit || submitting} onClick={submit}>{submitting ? '제출 중...' : index + 1 === data.questions.length ? '재풀이 제출' : '다음'}</Button>
      {error && <p className="w-full text-xs font-bold text-danger">{error}</p>}
    </div>
  </div>;
}
