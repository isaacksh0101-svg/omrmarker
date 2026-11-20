import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../../api/client';
import type { CurrentQuestionResponse, ExamSession, PublicExam, PublicQuestion } from '../../types';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { Badge } from '../../components/Badge';
import { PenCanvas, type PenCanvasHandle, type PenTool } from '../../components/PenCanvas';
import { clearLocalStrokes, clearOtherLocalStrokes, loadLocalStrokes, saveLocalStrokes } from '../../lib/localStrokes';
import { ChoiceNumberPicker, ChoiceTextList } from '../../components/ChoiceList';
import { QuestionPrompt } from '../../components/QuestionPrompt';
import { IconEraser, IconFingerDraw, IconGrip, IconPen, IconTrash, IconUndo } from '../../components/icons';
import {
  addFullscreenChangeListener,
  getFullscreenElementCompat,
  isFullscreenSupported,
  removeFullscreenChangeListener,
  requestFullscreenCompat,
} from '../../lib/fullscreen';

const PEN_COLORS = ['#1b1c22', '#f04438', '#3258ce'];

function formatTime(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// 태블릿/휴대폰에서 정답 입력창을 누르면 화면 키패드가 올라오는데, 일부 브라우저는
// 100vh를 키패드만큼 줄여주지 않는다 - 그러면 h-screen 레이아웃 전체가 실제 보이는
// 영역보다 커져서, 브라우저가 입력창을 보이게 하려고 페이지를 스크롤하고, 그 바람에
// 위쪽 펜 도구 모음이 화면 밖으로 밀려나거나 아래쪽 입력창이 키패드에 가려진다.
// visualViewport로 실제 보이는 높이를 직접 재서 컨테이너 키를 그만큼만 잡으면, 키패드가
// 뜨든 안 뜨든 헤더/입력창이 항상 그 안에 고정된 채로 남는다.
type VisibleViewport = {
  width: number;
  height: number;
  offsetLeft: number;
  offsetTop: number;
};

function getVisibleViewport(): VisibleViewport {
  const viewport = window.visualViewport;
  return {
    width: viewport?.width ?? window.innerWidth,
    height: viewport?.height ?? window.innerHeight,
    offsetLeft: viewport?.offsetLeft ?? 0,
    offsetTop: viewport?.offsetTop ?? 0,
  };
}

function useVisibleViewport() {
  const [viewport, setViewport] = useState(getVisibleViewport);
  useEffect(() => {
    const vv = window.visualViewport;
    const update = () => setViewport(getVisibleViewport());
    update();
    vv?.addEventListener('resize', update);
    vv?.addEventListener('scroll', update);
    window.addEventListener('resize', update);
    return () => {
      vv?.removeEventListener('resize', update);
      vv?.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, []);
  return viewport;
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
          탭 전환, 창 전환, 최소화 등으로 화면을 벗어나는 순간 그 즉시 시험이 강제로 종료됩니다. 알림창
          등으로 잠깐 벗어났다 돌아오는 것도 몇 번까지만 봐주고, 그 뒤로는 종료됩니다. 실수로 종료됐다면
          선생님께 바로 말씀해주세요.
        </p>
      </div>
      <div className="border-t border-danger/15 pt-3">
        <p className="text-xs font-bold text-ink">시험 데이터 처리 안내</p>
        <p className="mt-1 text-xs leading-relaxed text-ink-soft">
          번호, 답안, 점수, 문항별 소요시간, 필기, 화면 이탈 기록과 이의 제기 내용은 시험 운영·채점·학습분석을 위해
          선생님 PC에 저장되며 학기 말에 삭제됩니다. 열람·정정·삭제가 필요하면 담당 선생님께 요청하세요.
        </p>
      </div>
    </div>
  );
}

// 시험 중 전체화면을 벗어나는 것(alt-tab, 창 전환, 최소화 등 대부분의 "다른 화면으로 이동"
// 동작은 브라우저가 자동으로 전체화면을 해제시킨다)을 이탈 감지의 주 신호로 쓴다 - blur나
// visibilitychange보다 타이밍이 훨씬 더 명확하고 안정적이다(중복 카운트 버그의 원인이었던
// "돌아왔는지 애매한 타이밍" 문제 자체가 없다).

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
  // 전체화면만 풀리고 화면은 계속 보이는 상태(브라우저의 전체화면 닫기 X 버튼 등) - 종료시키지
  // 않고 문제를 가린 채 "전체화면으로 돌아가기" 버튼을 보여준다.
  const [fullscreenLost, setFullscreenLost] = useState(false);
  // 이벤트 핸들러(타이머 안)에서 최신 값을 읽기 위한 사본.
  const fullscreenLostRef = useRef(false);
  fullscreenLostRef.current = fullscreenLost;
  // 창이 포커스를 잃은 상태 - 3초 유예를 기다리지 않고 그 즉시 문제를 가린다. 화면 분할이나
  // 팝업으로 띄운 AI 창에 문제를 보면서 입력하지 못하게 하기 위함.
  const [focusLost, setFocusLost] = useState(false);
  // 이번 이탈(포커스를 잃고 다시 돌아오기까지 한 번)을 이미 짧은 이탈로 보고했는지. 전체화면
  // 닫기 X 버튼처럼 fullscreenchange와 focus 복귀가 각각 보고를 부르는 경우가 있어, 한 번의
  // 이탈이 서버의 허용 횟수를 두 번 깎지 않게 한다.
  const softReportedRef = useRef(false);

  const [exam, setExam] = useState<PublicExam | null>(null);
  const [session, setSession] = useState<ExamSession | null>(null);
  const [current, setCurrent] = useState<CurrentQuestionResponse | null>(null);
  // 답안 확인 화면에서 "최종 제출"을 한 번 누르면 답하지 않은 문항 경고를 보여주고, 한 번 더
  // 눌러야 제출한다. 브라우저 confirm() 창은 화면 이탈(blur)로 잡혀 강제 종료되므로 쓰지 않는다.
  const [confirmingSubmit, setConfirmingSubmit] = useState(false);
  // 답안 확인 화면을 한 번이라도 봤으면, 건너뛴 문제로 돌아가 푼 뒤 "다음"으로 마지막 문제까지
  // 다시 넘기지 않고 바로 답안 확인으로 돌아갈 수 있게 버튼을 하나 더 보여준다.
  const [visitedSummary, setVisitedSummary] = useState(false);
  const [selectedChoices, setSelectedChoices] = useState<number[]>([]);
  const [shortAnswer, setShortAnswer] = useState('');
  const [remainingSec, setRemainingSec] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // 시험에 들어오면 S-Pen 필기는 바로 사용할 수 있게 켜 둔다. 손가락 필기는 별도
  // 버튼을 눌렀을 때만 켜져 기본 상태의 한 손가락 스크롤을 방해하지 않는다.
  const [penTool, setPenTool] = useState<PenTool>('pen');
  const [penColor, setPenColor] = useState(PEN_COLORS[0]);
  const [hasStrokes, setHasStrokes] = useState(false);
  // S-Pen이 없는 학생을 위한 손가락 필기 모드 - 기기를 공유하는 교실 특성상 이전 학생이
  // 켜둔 설정이 다음 학생에게 그대로 넘어가면 안 되므로, 매 시험 진입마다 항상 펜 모드로
  // 새로 시작한다(저장하지 않음).
  const [fingerMode, setFingerMode] = useState(false);
  const penRef = useRef<PenCanvasHandle>(null);
  const visibleViewport = useVisibleViewport();

  // 정답 입력창을 화면 바닥에 딱 붙이지 않고 살짝 띄운 플로팅 패널로 두고, 손잡이를
  // 잡아 원하는 자리로 옮길 수 있게 한다 - 학생이 필기 중인 자리를 가리면 옆으로 치울 수
  // 있어야 하기 때문. null이면 기본 위치(화면 아래 가운데)에 그대로 둔다.
  const [floatPos, setFloatPos] = useState<{ x: number; y: number } | null>(null);
  const [floatSize, setFloatSize] = useState({ width: 0, height: 0 });
  const floatRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ pointerId: number; offsetX: number; offsetY: number } | null>(null);

  function handleFloatDragStart(e: React.PointerEvent) {
    const panel = floatRef.current;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    dragRef.current = { pointerId: e.pointerId, offsetX: e.clientX - rect.left, offsetY: e.clientY - rect.top };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }
  function handleFloatDragMove(e: React.PointerEvent) {
    const drag = dragRef.current;
    const panel = floatRef.current;
    if (!drag || drag.pointerId !== e.pointerId || !panel) return;
    const minX = visibleViewport.offsetLeft + 8;
    const minY = visibleViewport.offsetTop + 8;
    const maxX = Math.max(minX, visibleViewport.offsetLeft + visibleViewport.width - panel.offsetWidth - 8);
    const maxY = Math.max(minY, visibleViewport.offsetTop + visibleViewport.height - panel.offsetHeight - 8);
    setFloatPos({
      x: Math.min(Math.max(minX, e.clientX - drag.offsetX), maxX),
      y: Math.min(Math.max(minY, e.clientY - drag.offsetY), maxY),
    });
  }
  function handleFloatDragEnd() {
    dragRef.current = null;
  }

  // 키패드가 뜨거나 화면이 회전해 보이는 영역이 바뀌면, 드래그로 옮겨둔 위치가 화면 밖으로
  // 밀려날 수 있어 다시 안쪽으로 당겨온다.
  const reloadSession = useCallback(async () => {
    const s = await api.get<ExamSession>(`/exams/${id}/sessions/${sessionId}`);
    setSession(s);
    return s;
  }, [id, sessionId]);

  // 최종 제출 - 답안 확인 화면의 "정말 제출하기"에서도 쓰고, 안 푼 문제 없이 마지막
  // 문항까지 다 풀었을 때 확인 화면을 건너뛰고 바로 여기로도 온다.
  const finalSubmit = useCallback(async () => {
    setSubmitting(true);
    try {
      await api.post(`/exams/${id}/sessions/${sessionId}/final-submit`);
    } catch {
      // 이미 시간 초과 등으로 끝났을 수 있다 - 아래에서 최신 상태를 불러온다.
    }
    await reloadSession();
    setCurrent(null);
    setSubmitting(false);
  }, [id, sessionId, reloadSession]);

  // 지금 위치(문항 또는 답안 확인 화면)를 불러온다. 이미 답했거나 필기해 둔 문항이면 그 답을
  // 입력칸에 되살린다(필기는 아래 effect에서 캔버스에 다시 그린다).
  const loadCurrentQuestion = useCallback(async () => {
    const c = await api.get<CurrentQuestionResponse>(`/exams/${id}/sessions/${sessionId}/current-question`);
    if (c.done) {
      await reloadSession();
      setCurrent(null);
      return;
    }
    // 답안 확인 화면인데 빠진 문항이 하나도 없으면, 확인 화면을 보여주지 않고 그대로
    // 제출한다 - 이 화면은 "안 푼 문제가 있으니 확인해라"는 경고용이라, 다 풀었을 때는
    // 굳이 한 번 더 거칠 필요가 없다.
    if (c.summary && (c.answered ?? []).every(Boolean)) {
      await finalSubmit();
      return;
    }
    if (c.summary) setVisitedSummary(true);
    setCurrent(c);
    setConfirmingSubmit(false);
    setSelectedChoices(c.my_answer?.selected_choice_ids ?? []);
    setShortAnswer(c.my_answer?.short_answer_text ?? '');
  }, [id, sessionId, reloadSession, finalSubmit]);

  useEffect(() => {
    // 같은 /student/exam/:examId 라우트 안에서 다른 시험으로 이동하면 React가 이
    // 컴포넌트를 재사용하므로 이전 시험의 화면 상태를 비운다.
    setExam(null);
    setSession(null);
    setCurrent(null);
    setRemainingSec(null);
    setVisitedSummary(false);
    setExamStarted(false);
    disqualifyingRef.current = false;
    fullscreenArmedRef.current = false;
    if (!sessionId) {
      navigate('/student');
      return;
    }
    api.get<PublicExam>(`/exams/${id}/for-student`).then(setExam);
    reloadSession();
  }, [id, sessionId, navigate, reloadSession]);

  useEffect(() => {
    if (session?.status === 'in_progress' && !current) {
      loadCurrentQuestion();
    }
  }, [session, current, loadCurrentQuestion]);

  // 지금 보고 있는 문항(답안 확인 화면이면 null).
  const activeQuestion: PublicQuestion | null = current?.question ?? null;

  // 문항이 바뀔 때마다 그 문항에 전에 써 둔 필기를 다시 그린다(처음 보는 문항이면 빈 캔버스).
  // 필기는 이 기기에만 임시 보관한다(lib/localStrokes). 예전에 서버에 저장된 필기가 있으면 그것을 쓴다.
  const strokeQuestionIdRef = useRef<number | null>(null);
  useEffect(() => {
    // 불러오는 동안(load가 onStrokesChange를 부른다) 저장하지 않도록, 불러온 뒤에 문항 id를 정한다.
    strokeQuestionIdRef.current = null;
    const qid = activeQuestion?.id;
    penRef.current?.load(
      current?.my_answer?.strokes ?? (qid != null ? loadLocalStrokes('exam', sessionId, qid) : null),
    );
    strokeQuestionIdRef.current = qid ?? null;
    // examStarted: 새로고침 뒤 "시작하기"를 누르기 전에는 필기 캔버스가 아직 없다 - 누른 뒤에 다시 불러온다.
  }, [activeQuestion?.id, current?.my_answer?.strokes, sessionId, examStarted]);

  // 한 획을 마칠 때마다(지우기·되돌리기 포함) 이 기기에 저장한다 - 다음 문항으로 넘어가거나
  // 화면이 새로고침돼도 남는다.
  function handleStrokesChange(has: boolean) {
    setHasStrokes(has);
    const qid = strokeQuestionIdRef.current;
    const pen = penRef.current;
    if (qid == null || !pen) return;
    saveLocalStrokes('exam', sessionId, qid, pen.getStrokes(), pen.getCanvasSize());
  }

  // 시험을 마치면 이 기기에 남긴 필기를 지운다(다음 학생이 같은 기기를 쓸 수 있으므로). 이 기기에서
  // 앞서 다른 응시의 필기가 남아 있으면 그것도 지운다.
  const finished = session?.status === 'submitted' || session?.status === 'force_submitted';
  useEffect(() => {
    if (!sessionId) return;
    clearOtherLocalStrokes('exam', sessionId);
    if (finished) clearLocalStrokes('exam', sessionId);
  }, [sessionId, finished]);

  useEffect(() => {
    const panel = floatRef.current;
    if (!panel) return;
    const measure = () => setFloatSize({ width: panel.offsetWidth, height: panel.offsetHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(panel);
    return () => observer.disconnect();
  }, [activeQuestion?.id, examStarted]);

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

  // 응시 중에는 화면 자동 꺼짐을 막는다 - 태블릿에서 문제를 오래 고민하는 사이 화면이 꺼지면
  // document.hidden이 되어 이탈로 즉시 강제 종료되는 일이 있었다. 화면이 가려지면 브라우저가
  // wake lock을 자동으로 풀어버리므로, 다시 보이게 될 때마다 새로 요청한다. 지원하지 않는
  // 브라우저(구형 iOS Safari 등)나 저전력 모드에서 거부되면 조용히 넘어간다.
  useEffect(() => {
    if (session?.status !== 'in_progress') return;
    type WakeLockSentinelLike = { release: () => Promise<void> };
    const wakeLockApi = (navigator as Navigator & {
      wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinelLike> };
    }).wakeLock;
    if (!wakeLockApi) return;
    let sentinel: WakeLockSentinelLike | null = null;
    let disposed = false;

    async function acquire() {
      if (document.hidden || !wakeLockApi) return;
      try {
        const s = await wakeLockApi.request('screen');
        if (disposed) s.release().catch(() => {});
        else sentinel = s;
      } catch {
        // 거부됨(저전력 모드, 권한 정책 등) - 감지 동작에는 영향 없음.
      }
    }
    function onVisible() {
      if (!document.hidden) acquire();
    }

    acquire();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', onVisible);
      sentinel?.release().catch(() => {});
      sentinel = null;
    };
  }, [session?.status]);

  // 응시 중 다른 화면으로 이탈하면 지금까지 낸 답만으로 시험을 강제 제출 처리한다.
  // - 화면이 가려짐(탭·앱 전환, 화면 꺼짐): 즉시 종료.
  // - 포커스를 잃음(알림창, S펜 에어 커맨드, 다른 앱 팝업 창 등): BLUR_GRACE_MS 안에 돌아오면
  //   종료하지 않고 기록만 남긴다. 그보다 오래 다른 곳에 머물면(예: 팝업 계산기를 띄워 씀) 종료.
  // - 전체화면만 풀림(브라우저의 전체화면 닫기 X 버튼 등)이고 화면은 계속 보임: 종료하지 않고
  //   문제를 가린 채 "전체화면으로 돌아가기" 버튼을 띄우고 기록만 남긴다.
  // 실제 시험에서 펜 옆 버튼·알림창 내리기·X 버튼으로 학생들이 억울하게 종료되는 일이 있어서
  // 이렇게 나눴다. 억울하게 종료된 경우엔 교사가 "되살리기"로 이어서 풀게 하면 된다.
  useEffect(() => {
    if (session?.status !== 'in_progress') return;
    disqualifyingRef.current = false;
    softReportedRef.current = false;
    setFullscreenLost(false);
    setFocusLost(!document.hasFocus());
    const BLUR_GRACE_MS = 3000;
    // 전체화면이 풀려 가림 화면이 떠 있을 때, 포커스 없이 추가로 기다려 주는 시간.
    const OVERLAY_FOCUS_GRACE_MS = 7000;
    let blurTimer: number | null = null;
    let fullscreenTimer: number | null = null;

    function clearTimers() {
      if (blurTimer != null) window.clearTimeout(blurTimer);
      if (fullscreenTimer != null) window.clearTimeout(fullscreenTimer);
      blurTimer = null;
      fullscreenTimer = null;
    }

    async function disqualify(type: 'visibility_hidden' | 'window_blur') {
      // blur/visibilitychange/fullscreenchange가 같은 탭 전환 한 번에 여러 번 겹쳐 뜰 수
      // 있다 - 한 번만 요청을 보내면 충분하다(서버도 in_progress가 아니면 무시하므로
      // 중복 요청 자체는 안전하지만, 화면 전환을 굳이 여러 번 반복할 필요는 없다).
      if (disqualifyingRef.current) return;
      disqualifyingRef.current = true;
      clearTimers();
      setFullscreenLost(false);
      try {
        await api.post(`/exams/${id}/sessions/${sessionId}/warning`, { type });
      } catch {
        // 네트워크 오류 등은 무시 - 아래 reloadSession이 최신 상태를 다시 가져온다.
      }
      await reloadSession();
      setCurrent(null);
    }

    // 종료시키지 않는 이탈 기록 - 교사 감독 화면의 "경고 발생"에 잡힌다. 서버가 허용 횟수를
    // 넘었다고 판단하면 이 기록으로 강제 종료되므로, 그 경우 종료 화면으로 바로 전환한다.
    async function reportSoft() {
      if (disqualifyingRef.current || softReportedRef.current) return;
      softReportedRef.current = true;
      try {
        const result = await api.post<{ disqualified?: boolean }>(`/exams/${id}/sessions/${sessionId}/warning`, {
          type: 'window_blur',
          soft: true,
        });
        if (result?.disqualified && !disqualifyingRef.current) {
          disqualifyingRef.current = true;
          clearTimers();
          setFullscreenLost(false);
          setFocusLost(false);
          await reloadSession();
          setCurrent(null);
        }
      } catch {
        // 네트워크 오류 등은 무시 - 주기적인 세션 폴링이 최신 상태를 가져온다.
      }
    }

    function isArmedButNotFullscreen() {
      return fullscreenArmedRef.current && !getFullscreenElementCompat();
    }
    // 시험 화면에 완전히 돌아왔으면(포커스 있음, 전체화면 응시 중이면 전체화면도 복구) 이번
    // 이탈을 마무리한다 - 다음에 또 벗어나면 새 이탈로 센다. 전체화면이 풀린 채 가림 화면만
    // 눌러 포커스가 돌아온 상태는 아직 같은 이탈이 이어지는 중으로 본다.
    function closeIncidentIfBack() {
      if (document.hasFocus() && !document.hidden && !isArmedButNotFullscreen()) {
        softReportedRef.current = false;
      }
    }
    function onVisibilityChange() {
      if (document.hidden) disqualify('visibility_hidden');
    }
    function onBlur() {
      if (document.hidden) {
        disqualify('visibility_hidden');
        return;
      }
      setFocusLost(true);
      if (blurTimer != null) return;
      // 가림 화면이 이미 떠 있는 상태에서 포커스를 잃었다면(ESC 등으로 전체화면을 끈 뒤 다른
      // 창으로 감) X 버튼 때문에 포커스가 빠진 경우가 아니므로 추가 유예 없이 판단한다.
      const overlayAlreadyShown = fullscreenLostRef.current;
      blurTimer = window.setTimeout(() => {
        blurTimer = null;
        if (document.hidden) disqualify('visibility_hidden');
        else if (overlayAlreadyShown && !document.hasFocus()) disqualify('window_blur');
        // 전체화면 닫기 X 버튼은 브라우저 자체 UI라, 누르면 포커스가 그쪽으로 가서 학생이 페이지를
        // 다시 누를 때까지 돌아오지 않는다. 이때는 "전체화면으로 돌아가기" 화면이 문제를 가리고
        // 있으므로 OVERLAY_FOCUS_GRACE_MS만큼 더 기다려 준다. 그래도 계속 다른 곳(나란히 띄운 창,
        // 화면 분할 앱 등)에 머물면 검색 등 딴짓으로 보고 종료한다. 화면이 가려지면 즉시 종료.
        else if (fullscreenLostRef.current || isArmedButNotFullscreen()) {
          // fullscreenchange를 놓친 기기라도 문제가 보이는 채로 두지 않도록 가림 화면을 확실히 띄운다.
          setFullscreenLost(true);
          blurTimer = window.setTimeout(() => {
            blurTimer = null;
            if (document.hidden) disqualify('visibility_hidden');
            else if (!document.hasFocus()) disqualify('window_blur');
          }, OVERLAY_FOCUS_GRACE_MS);
        }
        else if (!document.hasFocus()) disqualify('window_blur');
        else {
          reportSoft();
          closeIncidentIfBack();
        }
      }, BLUR_GRACE_MS);
    }
    function onFocus() {
      setFocusLost(false);
      if (blurTimer != null) {
        window.clearTimeout(blurTimer);
        blurTimer = null;
        reportSoft();
      }
      closeIncidentIfBack();
    }
    // 전체화면 모드로 응시 중이면(fullscreenArmedRef) 전체화면이 풀린 걸 감지한다. 탭 전환이면
    // visibilitychange가 곧 뒤따르므로 잠깐 기다렸다가, 화면이 여전히 보이면 X 버튼 등으로
    // 전체화면만 풀린 것으로 보고 돌아가기 화면을 띄운다.
    function onFullscreenChange() {
      if (!fullscreenArmedRef.current) return;
      if (getFullscreenElementCompat()) {
        setFullscreenLost(false);
        closeIncidentIfBack();
        return;
      }
      if (fullscreenTimer != null) window.clearTimeout(fullscreenTimer);
      fullscreenTimer = window.setTimeout(() => {
        fullscreenTimer = null;
        if (document.hidden) {
          disqualify('visibility_hidden');
          return;
        }
        if (getFullscreenElementCompat()) return;
        setFullscreenLost(true);
        reportSoft();
      }, 400);
    }

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);
    addFullscreenChangeListener(onFullscreenChange);
    return () => {
      clearTimers();
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
      removeFullscreenChangeListener(onFullscreenChange);
    };
  }, [session?.status, id, sessionId, reloadSession]);

  // "전체화면으로 돌아가기" 버튼 - 브라우저는 학생이 직접 누른 동작이 있어야만 전체화면을
  // 허용하므로 자동으로 되돌릴 수 없다. 전체화면에 다시 못 들어가는 기기면(거부됨) 막힌 채로
  // 두지 않고, 그 뒤로는 blur/visibilitychange 감지만으로 이어서 응시하게 한다.
  async function returnToFullscreen() {
    try {
      await requestFullscreenCompat(document.documentElement);
    } catch {
      fullscreenArmedRef.current = false;
      // 전체화면에 못 돌아가는 기기 - 그래도 시험 화면에는 돌아왔으므로 이번 이탈을 마무리한다.
      if (document.hasFocus()) softReportedRef.current = false;
    }
    setFullscreenLost(false);
  }

  // 응시 중에는 길게 누르기 메뉴("이미지 복사", 구글 렌즈, 웹 검색 등)와 글자 선택, 끌기를
  // 막는다. 펜으로 한 곳을 오래 누르면 이 메뉴가 뜨고, 그 과정에서 전체화면이 풀려 이탈로
  // 강제 종료되는 일이 실제 시험에서 있었다. 답 입력칸(input/textarea)은 그대로 쓸 수 있게 둔다.
  useEffect(() => {
    if (session?.status !== 'in_progress') return;
    const isTextField = (target: EventTarget | null) =>
      target instanceof HTMLElement && !!target.closest('input, textarea, [contenteditable="true"]');
    const block = (e: Event) => {
      if (!isTextField(e.target)) e.preventDefault();
    };
    document.addEventListener('contextmenu', block, true);
    document.addEventListener('selectstart', block, true);
    document.addEventListener('dragstart', block, true);
    document.body.classList.add('exam-lock');
    return () => {
      document.removeEventListener('contextmenu', block, true);
      document.removeEventListener('selectstart', block, true);
      document.removeEventListener('dragstart', block, true);
      document.body.classList.remove('exam-lock');
    };
  }, [session?.status]);

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

  // 지금 문항을 떠나 다른 곳으로 간다. 답이 있으면 저장(고쳐 낸 답은 다시 채점)하고, 없으면
  // 필기만 남기고 이동한다. to: 'next' | 'prev' | 'summary' | 문항 번호(0부터).
  async function move(to: 'next' | 'prev' | 'summary' | number) {
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = { to };
      const q = activeQuestion;
      let hasAnswer = false;
      if (q) {
        body.question_id = q.id;
        // 임시: 필기가 많으면 요청이 커져 "다음"이 거절되던 문제 때문에 필기 전송을 끈다.
        // 대신 필기는 이 기기에 문항별로 남겨 돌아오면 다시 그린다(handleStrokesChange).
        // 다시 켜려면 SEND_STROKES를 true로 바꾼다(서버 sessions.js의 STROKES_SAVE_DISABLED도 함께).
        const SEND_STROKES = false;
        const strokes = SEND_STROKES ? (penRef.current?.getStrokes() ?? []) : [];
        if (strokes.length > 0) {
          body.strokes = strokes;
          body.strokes_canvas_size = penRef.current?.getCanvasSize();
        }
        if (q.type === 'mc') {
          hasAnswer = selectedChoices.length > 0;
          if (q.multi_select) body.selected_choice_ids = selectedChoices;
          else body.selected_choice_id = selectedChoices[0] ?? null;
        } else {
          hasAnswer = !!shortAnswer.trim();
          body.short_answer_text = shortAnswer;
        }
      }
      const path = hasAnswer ? 'answers' : 'navigate';
      const result = await api.post<{ done: boolean }>(`/exams/${id}/sessions/${sessionId}/${path}`, body);
      if (result.done) {
        await reloadSession();
        setCurrent(null);
      } else {
        await loadCurrentQuestion();
      }
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409) {
        // 다른 기기에서 이미 다른 문항으로 이동했다 - 지금 위치를 다시 불러온다.
        await loadCurrentQuestion();
      } else {
        // 전송 도중 화면 이탈이 감지돼 강제 종료됐을 수 있다 - 최신 세션 상태로 전환한다.
        await reloadSession();
        setCurrent(null);
      }
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
        <div className="mt-8 w-full max-w-xs rounded-3xl border-2 border-accent/25 bg-accent-soft px-6 py-6 shadow-sm">
          <p className="text-sm font-bold text-accent-ink">내 번호</p>
          <p className="mt-1 text-7xl font-black tracking-tight text-accent-ink">
            {session.roll_number}<span className="ml-1 text-3xl">번</span>
          </p>
        </div>
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
    const pendingCount = (session.answers ?? []).filter((a) => a.confirm_pending).length;
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
          {pendingCount > 0 && (
            <p className="mt-2 text-sm font-bold text-warn">
              선생님이 확인 중인 문항이 {pendingCount}개 있어요. 확인이 끝나면 점수가 확정돼요.
            </p>
          )}
        </Card>
        <div className="mt-5 flex flex-wrap gap-2">
          {(session.answers ?? []).map((a) => (
            <span
              key={a.order_index}
              title={a.confirm_pending ? '선생님 확인 후 정답 확정' : undefined}
              className={`flex h-9 min-w-9 items-center justify-center rounded-full px-2 text-sm font-bold ${
                a.confirm_pending
                  ? 'bg-warn/15 text-warn'
                  : a.is_correct
                    ? 'bg-good/15 text-good'
                    : 'bg-danger/15 text-danger'
              }`}
            >
              {a.order_index + 1}
              {a.confirm_pending ? ' ?' : ''}
            </span>
          ))}
        </div>
        {pendingCount > 0 && (
          <p className="mt-2 text-xs text-ink-soft">
            <span className="font-bold text-warn">?</span> 표시는 선생님이 채점 중인 문항이에요. 나머지 틀린 문항은 지금 바로
            다시 풀 수 있고, 채점 중인 문항은 오답으로 확정되면 그때 오답 재풀이에 추가돼요.
          </p>
        )}
        <div className="mt-7 flex flex-wrap gap-2">
          {(session.answers ?? []).some((a) => !a.is_correct && !a.confirm_pending) && (
            <Button variant="secondary" onClick={() => navigate(`/student/exam/${id}/review`)}>
              틀린 문항 다시 풀기
            </Button>
          )}
          <Button onClick={() => navigate('/student')}>다른 시험 응시하기</Button>
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

  // 전체화면만 풀렸을 때 문제를 가리는 화면 - 문항 화면을 그대로 둔 채(필기 보존) 위에 덮는다.
  const fullscreenOverlay = fullscreenLost ? (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-5 bg-bg px-8 text-center">
      <p className="text-xl font-bold text-ink">전체화면이 풀렸어요</p>
      <p className="text-base text-ink-soft">아래 버튼을 눌러 시험 화면으로 돌아가세요.</p>
      <Button className="text-base" onClick={returnToFullscreen}>
        전체화면으로 돌아가기
      </Button>
    </div>
  ) : focusLost ? (
    // 포커스를 잃은 즉시 문제를 가리는 화면 - 화면을 한 번 누르면 포커스가 돌아와 사라진다.
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-bg px-8 text-center">
      <p className="text-xl font-bold text-ink">시험 화면을 벗어났어요</p>
      <p className="text-base text-ink-soft">화면을 눌러 시험으로 돌아오세요.</p>
      <p className="max-w-sm text-sm text-danger">
        화면을 벗어난 기록은 선생님께 전달되고, 여러 번 반복되면 시험이 자동으로 종료돼요.
      </p>
    </div>
  ) : null;

  // in_progress - 마지막 문항 다음의 답안 확인 화면. 번호를 누르면 그 문항으로 가고,
  // "최종 제출"을 눌러야 제출된다.
  if (current?.summary) {
    const answered = current.answered ?? [];
    const unanswered = answered.filter((a) => !a).length;
    return (
      <div className="mx-auto flex min-h-screen max-w-2xl flex-col px-6 py-10">
        {fullscreenOverlay}
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-xl font-bold text-ink">답안 확인</h1>
          {remainingSec !== null && (
            <Badge tone={remainingSec <= 30 ? 'danger' : 'neutral'}>{formatTime(remainingSec)}</Badge>
          )}
        </div>
        <p className="mt-1 text-sm text-ink-soft">
          {answered.length}문항 중 {answered.length - unanswered}문항에 답했어요. 번호를 누르면 그 문제로 돌아가서
          답을 고칠 수 있어요.
        </p>
        <div className="mt-6 flex flex-wrap gap-2.5">
          {answered.map((done, index) => (
            <button
              key={index}
              disabled={submitting}
              onClick={() => move(index)}
              className={`flex h-12 w-12 items-center justify-center rounded-xl border-2 text-base font-bold transition-colors ${
                done ? 'border-accent bg-accent-soft text-accent-ink' : 'border-danger/40 bg-panel text-danger'
              }`}
            >
              {index + 1}
            </button>
          ))}
        </div>
        {unanswered > 0 && (
          <p className="mt-3 text-sm font-bold text-danger">빨간 번호는 아직 답하지 않은 문제예요.</p>
        )}
        {confirmingSubmit && (
          <p className="mt-6 rounded-xl border border-danger/30 bg-danger/5 px-4 py-3 text-sm font-bold text-danger">
            {unanswered > 0
              ? `답하지 않은 문제가 ${unanswered}개 있어요. 제출하면 틀린 것으로 처리되고 더 이상 고칠 수 없어요.`
              : '제출하면 더 이상 답을 고칠 수 없어요.'}
          </p>
        )}
        <div className="mt-6 flex flex-wrap gap-2">
          <Button variant="secondary" className="text-base" disabled={submitting} onClick={() => move('prev')}>
            마지막 문제로 돌아가기
          </Button>
          {confirmingSubmit ? (
            <Button variant="danger" className="text-base" disabled={submitting} onClick={finalSubmit}>
              정말 제출하기
            </Button>
          ) : (
            <Button className="text-base" disabled={submitting} onClick={() => setConfirmingSubmit(true)}>
              최종 제출
            </Button>
          )}
        </div>
      </div>
    );
  }

  if (!activeQuestion) {
    return <div className="p-10 text-sm text-ink-soft">다음 문항을 불러오는 중...</div>;
  }
  const q = activeQuestion;
  const questionIndex = current?.index ?? 0;
  const isLast = questionIndex + 1 >= (current?.total ?? 0);
  const panelMinX = visibleViewport.offsetLeft + 8;
  const panelMinY = visibleViewport.offsetTop + 8;
  const panelMaxX = Math.max(
    panelMinX,
    visibleViewport.offsetLeft + visibleViewport.width - floatSize.width - 8,
  );
  const panelMaxY = Math.max(
    panelMinY,
    visibleViewport.offsetTop + visibleViewport.height - floatSize.height - 12,
  );
  const desiredPanelX =
    floatPos?.x ?? visibleViewport.offsetLeft + Math.max(8, (visibleViewport.width - floatSize.width) / 2);
  const desiredPanelY = floatPos?.y ?? panelMaxY;
  const answerPanelPosition = {
    x: Math.min(Math.max(panelMinX, desiredPanelX), panelMaxX),
    y: Math.min(Math.max(panelMinY, desiredPanelY), panelMaxY),
  };

  return (
    <div className="flex flex-col overflow-hidden bg-bg" style={{ height: visibleViewport.height }}>
      {fullscreenOverlay}
      {/* 휴대폰처럼 좁은 화면에서는 필기 도구가 한 줄에 다 들어가지 않아 오른쪽이 잘리므로,
          도구 묶음을 둘째 줄로 내려 화면 너비 전체를 쓰게 한다. */}
      <header className="sticky top-0 z-10 flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-line bg-panel px-4 py-2.5 sm:flex-nowrap sm:px-6">
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-bold text-ink">{exam.title}</p>
        </div>
        <Badge tone="neutral">
          {q.order_index + 1} / {exam.question_count}
        </Badge>
        {remainingSec !== null && (
          <Badge tone={remainingSec <= 30 ? 'danger' : 'neutral'}>{formatTime(remainingSec)}</Badge>
        )}
        <div className="flex w-full items-center justify-between gap-1 sm:w-auto sm:justify-start">
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
                aria-label="손가락 필기 모드"
                title="손가락으로 필기합니다. 두 손가락으로 화면을 이동할 수 있습니다."
                onClick={() => {
                  setFingerMode(true);
                  setPenTool('pen');
                }}
                className={`ml-1 flex h-8 w-8 items-center justify-center rounded-lg ${
                  fingerMode ? 'bg-accent text-white' : 'text-ink-soft hover:bg-surface-container'
                }`}
              >
                <IconFingerDraw className="h-4.5 w-4.5" />
              </button>
          </>
          <button
            aria-label="펜 필기 모드"
            title="펜으로 필기합니다. 손가락 한 개로 화면을 이동할 수 있습니다."
            onClick={() => {
              setFingerMode(false);
              setPenTool('pen');
            }}
            className={`flex h-8 w-8 items-center justify-center rounded-lg ${
              !fingerMode ? 'bg-accent text-white' : 'text-ink-soft hover:bg-surface-container'
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
              <QuestionPrompt
                prompt={q.prompt}
                imagePath={q.prompt_image_path}
                showPromptText={q.show_prompt_text}
                alt={`${q.order_index + 1}번 문항`}
                fallback={<p className="text-xl text-ink-soft">종이 시험지의 {q.order_index + 1}번 문항을 마킹하세요.</p>}
              />
            </div>
            {q.type === 'mc' && <ChoiceTextList choices={q.choices} />}

            {/* 필기는 문제/선택지 영역을 포함한 연습장 전체 위에 덮인다 - 켜져 있는 동안엔
                기본적으로 S-Pen 입력만 받고(팜 리젝션) 손가락은 무시하지만, 손가락 필기
                모드(fingerMode)가 켜져 있으면 펜이 없는 학생을 위해 손가락도 필기로 받는다.
                다시 끄면 원래대로 조작 가능. 스크롤 컨테이너 안에 함께 있어서 필기도
                문제와 같이 스크롤된다. */}
            <PenCanvas
              ref={penRef}
              active
              tool={penTool}
              color={penColor}
              allowTouch={fingerMode}
              onStrokesChange={handleStrokesChange}
            />
          </div>
        </div>
      </div>

      <div
        ref={floatRef}
        className="fixed z-20 flex max-w-[calc(100vw-16px)] flex-wrap items-center gap-2 rounded-2xl border border-line bg-panel px-4 py-3 shadow-lg"
        style={{
          left: answerPanelPosition.x,
          top: answerPanelPosition.y,
        }}
      >
        <button
          type="button"
          aria-label="답안 입력창 위치 옮기기"
          className="-ml-1 flex h-7 w-6 shrink-0 touch-none items-center justify-center rounded text-ink-soft active:cursor-grabbing"
          onPointerDown={handleFloatDragStart}
          onPointerMove={handleFloatDragMove}
          onPointerUp={handleFloatDragEnd}
          onPointerCancel={handleFloatDragEnd}
        >
          <IconGrip className="h-4 w-4" />
        </button>
        {q.type === 'short' && q.essay && (
          <textarea
            rows={4}
            className="w-full min-w-0 resize-none rounded-xl border border-line bg-bg px-4 py-2.5 text-lg text-ink outline-none focus:border-accent sm:w-[32rem]"
            placeholder="답을 문장으로 써주세요"
            value={shortAnswer}
            onChange={(e) => setShortAnswer(e.target.value)}
          />
        )}
        {q.type === 'short' && !q.essay && (
          <input
            className="w-full min-w-0 rounded-xl border border-line bg-bg px-4 py-2.5 text-lg text-ink outline-none focus:border-accent sm:w-[28rem]"
            placeholder="정답 입력"
            value={shortAnswer}
            onChange={(e) => setShortAnswer(e.target.value)}
          />
        )}
        {/* 보기 문구는 본문(ChoiceTextList)에서 읽고, 여기서는 번호만 고른다 - 문항 종류나
            보기 길이가 달라도 "정답을 고르는 자리"는 항상 같은 모양이어야 한다. */}
        {q.type === 'mc' && (
          <ChoiceNumberPicker
            choices={q.choices}
            selectedIds={selectedChoices}
            multiSelect={q.multi_select}
            onChange={setSelectedChoices}
          />
        )}
        {/* 답을 골랐으면 저장하고 이동, 안 골랐으면 그냥 이동(건너뛰기)한다. 마지막 문제 다음은
            답안 확인 화면이고, 제출은 그 화면에서만 한다. */}
        <Button
          variant="secondary"
          className="text-base"
          disabled={submitting || questionIndex === 0}
          onClick={() => move('prev')}
        >
          이전
        </Button>
        <Button className="text-base" disabled={submitting} onClick={() => move('next')}>
          {isLast ? '답안 확인' : '다음'}
        </Button>
        {visitedSummary && !isLast && (
          <Button variant="secondary" className="text-base" disabled={submitting} onClick={() => move('summary')}>
            답안 확인으로
          </Button>
        )}
      </div>
    </div>
  );
}
