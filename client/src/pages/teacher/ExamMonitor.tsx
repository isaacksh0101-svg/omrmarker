import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../../api/client';
import { getSocket } from '../../lib/socket';
import type { ExamMonitorData, MonitorStudent } from '../../types';
import { statusMeta } from '../../lib/sessionStatus';
import { Card } from '../../components/Card';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { StatCard, StatCardRow } from '../../components/StatCard';
import { SessionDetailModal } from '../../components/SessionDetailModal';
import { IconEye, IconStopCircle, IconUndo } from '../../components/icons';

function formatClock(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// 학생 화면(TakeExam)의 카운트다운과 같은 공식 - started_at부터 (제한시간 + 추가시간)이
// 지나면 종료된다. 감독 화면에서도 매초 갱신해서 교사가 얼마나 남았는지 실시간으로 본다.
function useRemainingSeconds(startedAt: string | null, timeLimitSec: number, extraTimeSec: number, active: boolean) {
  const [remaining, setRemaining] = useState<number | null>(null);
  useEffect(() => {
    if (!active || !startedAt) {
      setRemaining(null);
      return;
    }
    const deadline = new Date(startedAt).getTime() + (timeLimitSec + extraTimeSec) * 1000;
    const tick = () => setRemaining(Math.max(0, Math.round((deadline - Date.now()) / 1000)));
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [startedAt, timeLimitSec, extraTimeSec, active]);
  return remaining;
}

const EXTRA_TIME_OPTIONS = [
  { label: '+1분', seconds: 60 },
  { label: '+5분', seconds: 300 },
  { label: '+10분', seconds: 600 },
];

function StudentCard({
  student,
  questionCount,
  timeLimitSec,
  index,
  onView,
  onForceEnd,
  onExtendTime,
  onRevive,
}: {
  student: MonitorStudent;
  questionCount: number;
  timeLimitSec: number;
  index: number;
  onView: () => void;
  onForceEnd: () => void;
  onExtendTime: (seconds: number) => void;
  onRevive: () => void;
}) {
  const meta = statusMeta(student.status, student.disqualify_reason);
  const canView = student.session_id != null;
  const canForceEnd = student.status === 'joined' || student.status === 'in_progress';
  const canRevive = student.status === 'force_submitted';
  const extraTimeSec = student.extra_time_sec ?? 0;
  const remainingSec = useRemainingSeconds(
    student.started_at,
    timeLimitSec,
    extraTimeSec,
    student.status === 'in_progress',
  );
  const progressPct =
    student.status === 'in_progress' && questionCount > 0
      ? Math.min(100, Math.round(((student.current_question_index ?? 0) / questionCount) * 100))
      : 0;

  return (
    <Card
      className="animate-fade-in-up flex flex-col gap-3 p-4 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md"
      style={{ animationDelay: `${Math.min(index, 20) * 25}ms` }}
    >
      <div className="flex items-center gap-2.5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-bold text-accent-ink">
          {student.roll_number}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-ink">{student.name || '이름 없음'}</p>
          <div className="mt-0.5 flex items-center gap-1.5">
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${meta.dot}`} />
            <span className="truncate text-xs text-ink-soft">{meta.label}</span>
          </div>
        </div>
      </div>

      <div>
        {student.status === 'in_progress' ? (
          <>
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-ink-soft">현재 문제</span>
              <span className="font-bold text-ink">
                {(student.current_question_index ?? 0) + 1} / {questionCount}
              </span>
            </div>
            <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-line">
              <div
                className="h-full rounded-full bg-accent transition-[width] duration-500 ease-out"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </>
        ) : student.status === 'submitted' || student.status === 'force_submitted' ? (
          <div className="flex items-center justify-between text-xs">
            <span className="font-bold text-ink-soft">점수</span>
            <span className="font-bold text-ink">
              {student.score ?? 0} / {student.max_score ?? 0}
            </span>
          </div>
        ) : (
          <p className="whitespace-nowrap text-[11px] text-ink-soft">아직 문제를 풀고 있지 않아요.</p>
        )}
      </div>

      <div className="flex items-center justify-between">
        <span className="text-xs font-bold text-ink-soft">남은 시간</span>
        <Badge tone={remainingSec != null && remainingSec <= 30 ? 'danger' : 'neutral'}>
          {remainingSec != null ? formatClock(remainingSec) : '-'}
        </Badge>
      </div>

      {student.status === 'in_progress' && (
        <div className="flex flex-col gap-1">
          <span className="text-[11px] font-bold text-ink-soft">
            시간추가{extraTimeSec > 0 ? ` (+${Math.round(extraTimeSec / 60)}분 적용됨)` : ''}
          </span>
          <div className="flex flex-wrap justify-center gap-1.5">
            {EXTRA_TIME_OPTIONS.map((opt) => (
              <button
                key={opt.seconds}
                type="button"
                onClick={() => onExtendTime(opt.seconds)}
                className="whitespace-nowrap rounded-full border border-line px-1.5 py-0.5 text-[10px] font-bold text-ink-soft transition-colors duration-150 hover:border-accent hover:bg-accent-soft hover:text-accent-ink"
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="mt-auto flex gap-2 pt-1">
        <button
          type="button"
          disabled={!canView}
          onClick={onView}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-full border border-line py-1.5 text-xs font-bold text-ink-soft transition-colors duration-150 hover:border-accent hover:bg-accent-soft hover:text-accent-ink disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-line disabled:hover:bg-transparent disabled:hover:text-ink-soft"
        >
          <IconEye className="h-3.5 w-3.5" />
          화면 보기
        </button>
        {canRevive ? (
          <button
            type="button"
            onClick={onRevive}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-full border border-line py-1.5 text-xs font-bold text-ink-soft transition-colors duration-150 hover:border-good hover:bg-good/10 hover:text-good"
          >
            <IconUndo className="h-3.5 w-3.5" />
            되살리기
          </button>
        ) : (
          <button
            type="button"
            disabled={!canForceEnd}
            onClick={onForceEnd}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-full border border-line py-1.5 text-xs font-bold text-ink-soft transition-colors duration-150 hover:border-danger hover:bg-danger/10 hover:text-danger disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-line disabled:hover:bg-transparent disabled:hover:text-ink-soft"
          >
            <IconStopCircle className="h-3.5 w-3.5" />
            강제 종료
          </button>
        )}
      </div>
    </Card>
  );
}

export function ExamMonitor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const examId = Number(id);
  const [data, setData] = useState<ExamMonitorData | null>(null);
  const [viewingSessionId, setViewingSessionId] = useState<number | null>(null);
  const [pulse, setPulse] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [codeCopied, setCodeCopied] = useState(false);
  const pulseTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function copyCode(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      setCodeCopied(true);
      setTimeout(() => setCodeCopied(false), 1500);
    } catch {
      alert('복사하지 못했습니다. 코드를 직접 선택해 복사해주세요.');
    }
  }

  const load = useCallback(() => {
    api
      .get<ExamMonitorData>(`/exams/${examId}/monitor`)
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : '불러오지 못했습니다. 서버가 최신 버전으로 실행 중인지 확인해주세요.');
      });
  }, [examId]);

  // 실시간 반영: 학생 쪽에서 상태가 바뀔 때마다 서버가 socket으로 알려주면 바로 다시
  // 불러온다. 혹시 소켓 연결이 끊겨도 화면이 멈추지 않도록 주기적으로도 다시 불러온다.
  useEffect(() => {
    load();
    const socket = getSocket();
    socket.emit('monitor:join', examId);

    function onUpdate() {
      load();
      setPulse(true);
      if (pulseTimeout.current) clearTimeout(pulseTimeout.current);
      pulseTimeout.current = setTimeout(() => setPulse(false), 900);
    }
    socket.on('monitor:update', onUpdate);
    socket.on('connect', load);

    const fallbackInterval = setInterval(load, 10000);

    return () => {
      socket.emit('monitor:leave', examId);
      socket.off('monitor:update', onUpdate);
      socket.off('connect', load);
      clearInterval(fallbackInterval);
      if (pulseTimeout.current) clearTimeout(pulseTimeout.current);
    };
  }, [examId, load]);

  async function extendTime(sessionId: number, seconds: number) {
    try {
      await api.post(`/exams/${examId}/sessions/${sessionId}/extend-time`, { seconds });
      load();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : '시간 추가 중 오류가 발생했습니다.');
    }
  }

  async function forceEnd(sessionId: number, rollNumber: number) {
    if (!confirm(`${rollNumber}번 학생의 시험을 지금 강제로 종료할까요? 되돌릴 수 없습니다.`)) return;
    try {
      await api.post(`/exams/${examId}/sessions/${sessionId}/force-submit`);
      load();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : '강제 종료 중 오류가 발생했습니다.');
    }
  }

  // 같은 번호로 다른 기기가 참여를 시도했다가 "이미 참여 중인 기기가 있다"고 막힌 경우를
  // 위한 예외 통로 - 원래 기기가 고장났다는 등 정당한 사유일 때만 눌러야 한다. 한 번
  // 누르면 다음 참여 시도 한 번만 통과되고 다시 잠긴다.
  async function allowRejoin(sessionId: number, rollNumber: number) {
    if (
      !confirm(
        `${rollNumber}번 학생이 다른 기기로 다시 참여하도록 허용할까요?\n원래 쓰던 기기가 응시 중이면 그 기기와 답이 섞일 수 있으니, 정말 기기를 바꿔야 하는 경우에만 눌러주세요.`,
      )
    ) {
      return;
    }
    try {
      await api.post(`/exams/${examId}/sessions/${sessionId}/allow-rejoin`);
      alert('허용했습니다. 학생이 다시 참여를 시도하면 이번 한 번만 통과됩니다.');
    } catch (err) {
      alert(err instanceof ApiError ? err.message : '재참여 허용 중 오류가 발생했습니다.');
    }
  }

  // 강제 종료(화면 이탈 감지 또는 교사가 직접 종료)된 학생을 다시 응시 중으로 되살린다 -
  // 화면 이탈은 첫 번째부터 바로 종료되므로, 학생이 실수였다고 소명하면 이 버튼으로
  // 이어서 풀게 해준다. 서버가 시작 시각을 지금으로 다시 잡아서 처음 제한시간만큼 새로
  // 주므로, 되살리자마자 시간 초과로 다시 종료되는 일은 없다.
  async function revive(sessionId: number, rollNumber: number) {
    if (
      !confirm(
        `${rollNumber}번 학생을 다시 응시 중 상태로 되살릴까요?\n경고 횟수는 0으로 초기화되고, 제한시간은 지금부터 다시 시작됩니다.`,
      )
    ) {
      return;
    }
    try {
      await api.post(`/exams/${examId}/sessions/${sessionId}/revive`);
      load();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : '되살리는 중 오류가 발생했습니다.');
    }
  }

  async function startExam(waitingStudents: MonitorStudent[], alreadyStarted: boolean) {
    const waitingCount = waitingStudents.length;
    const rolls = waitingStudents.map((student) => `${student.roll_number}번`).join(', ') || '없음';
    const message = alreadyStarted
      ? `아직 대기 중인 학생 ${waitingCount}명을 지금 시작할까요?`
      : waitingCount > 0
        ? `접속 학생을 확인해주세요.\n\n${rolls}\n\n총 ${waitingCount}명이 맞으면 시험을 시작합니다. 늦게 들어온 학생은 입장 코드 확인 후 즉시 시작됩니다.`
        : '현재 접속한 학생이 없습니다. 그래도 시험을 시작할까요? 이후 입장 코드를 입력한 학생은 즉시 시작됩니다.';
    if (!confirm(message)) return;
    try {
      await api.post(`/exams/${examId}/start`);
      load();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : '시작 중 오류가 발생했습니다.');
    }
  }

  async function endExam(activeCount: number) {
    const message =
      activeCount > 0
        ? `시험을 전체 종료할까요? 아직 대기·응시 중인 학생 ${activeCount}명이 지금까지 낸 답까지만 인정되어 즉시 제출 처리됩니다.\n종료된 학생은 카드의 "되살리기"로 한 명씩 다시 응시 중 상태로 되돌릴 수 있습니다.`
        : '시험을 종료할까요? 종료 이후 새로 참여를 시도하는 학생은 들어올 수 없습니다.\n"시험 다시 열기"로 언제든 다시 참여를 받을 수 있습니다.';
    if (!confirm(message)) return;
    try {
      await api.post(`/exams/${examId}/end-all`);
      navigate('/exam-monitor');
    } catch (err) {
      alert(err instanceof ApiError ? err.message : '종료 중 오류가 발생했습니다.');
    }
  }

  // "시험 전체 종료"를 취소하고 다시 참여를 받는다 - 종료 이후 새로 참여를 시도한 학생도
  // 다시 들어올 수 있게 될 뿐, 이미 강제 종료된 학생 개개인을 되살리는 것과는 무관하다
  // (그건 학생 카드의 "되살리기"로 따로 한다).
  async function reopenExam() {
    if (
      !confirm(
        '시험을 다시 열까요? 종료 이후 참여를 시도한 학생도 다시 들어와 응시할 수 있게 됩니다.\n이미 강제 종료된 학생을 이어서 풀게 하려면 그 학생 카드의 "되살리기"를 따로 눌러주세요.',
      )
    ) {
      return;
    }
    try {
      await api.post(`/exams/${examId}/reopen`);
      load();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : '다시 여는 중 오류가 발생했습니다.');
    }
  }

  if (!data) {
    return (
      <div className="p-10 text-sm">
        {error ? (
          <div className="flex flex-col items-start gap-2">
            <p className="font-bold text-danger">{error}</p>
            <button className="text-xs font-bold text-accent hover:underline" onClick={load}>
              다시 시도
            </button>
          </div>
        ) : (
          <p className="text-ink-soft">불러오는 중...</p>
        )}
      </div>
    );
  }

  const joinedCount = data.students.filter((s) => s.session_id != null).length;
  const inProgressCount = data.students.filter((s) => s.status === 'in_progress').length;
  const submittedCount = data.students.filter((s) => s.status === 'submitted' || s.status === 'force_submitted').length;
  const flaggedCount = data.students.filter((s) => (s.warning_count ?? 0) > 0).length;
  const waitingCount = data.students.filter((s) => s.status === 'joined').length;
  const waitingStudents = data.students.filter((s) => s.status === 'joined');
  const activeCount = data.students.filter((s) => s.status === 'joined' || s.status === 'in_progress').length;
  const examStarted = !!data.exam.started_at;
  // "시험 전체 종료" 버튼을 누른 게 1차 기준(exam.ends_at)이지만, 그 뒤에 지각 학생이
  // 새로 입장하는 등 실제로 응시 중인 학생이 생기면 - ends_at이 남아있어도 - 감독중으로
  // 본다. 교사 액션이 기준이되 화면이 거짓말하지 않도록 실제 현황이 최종 안전망이다.
  const examEnded = !!data.exam.ends_at && activeCount === 0;
  const isMonitoring = examStarted && !examEnded;

  return (
    <div className="mx-auto max-w-6xl px-6 py-12">
      <button className="text-xs font-bold text-ink-soft transition-colors duration-150 hover:text-accent" onClick={() => navigate('/exam-monitor')}>
        ← 시험 감독
      </button>

      <div className="animate-fade-in-up mt-3 flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-bold tracking-tight text-ink">{data.exam.title}</h1>
        <span
          className={`h-2 w-2 rounded-full transition-colors duration-300 ${isMonitoring ? 'bg-good' : 'bg-line'} ${pulse ? 'animate-pulse' : ''}`}
          title={isMonitoring ? '감독중' : '감독중 아님'}
        />
        {/* 대기중/감독중/종료됨 - 교사가 한눈에 지금 상태를 알 수 있어야 해서 항상 같은
            자리에 뱃지로 명확히 표시한다("실시간 감독 중"이 종료 후에도 그대로 떠 있던 게
            헷갈렸던 원인이었다). */}
        {examEnded ? (
          <Badge tone="danger">시험 종료됨</Badge>
        ) : examStarted ? (
          <Badge tone="good">감독중</Badge>
        ) : (
          <Badge tone="neutral">학생 입장 대기 중</Badge>
        )}

        {data.exam.admission_code && (
          <div className="flex items-center gap-1.5 rounded-full border border-line px-3 py-1">
            <span className="text-[11px] font-bold text-ink-soft">입장 코드</span>
            <span className="font-mono text-sm font-black tracking-[0.18em] text-accent-ink">
              {data.exam.admission_code}
            </span>
            <button
              type="button"
              className="text-[11px] font-bold text-accent"
              onClick={() => copyCode(data.exam.admission_code!)}
            >
              {codeCopied ? '복사됨!' : '복사'}
            </button>
          </div>
        )}

        <div className="ml-auto flex items-center gap-2">
          {!examEnded && (
            <>
              {!examStarted ? (
                <Button onClick={() => startExam(waitingStudents, false)}>접속 학생 확인 후 시작</Button>
              ) : waitingCount > 0 ? (
                <Button onClick={() => startExam(waitingStudents, true)}>대기 중인 학생 시작 ({waitingCount}명)</Button>
              ) : (
                <Badge tone="good">모든 학생 시작함</Badge>
              )}
              {/* 지금 대기·응시 중인 학생이 없어도(예: 아무도 안 들어왔거나 다들 이미
                  제출함) 종료 버튼은 항상 눌려야 한다 - 이 버튼의 핵심 역할은 "이후 새로
                  들어오는 학생을 막는 문 닫기"라, 지금 활성 학생 수와는 무관하다. */}
              <Button variant="danger" onClick={() => endExam(activeCount)}>
                시험 전체 종료
              </Button>
            </>
          )}
          {examEnded && (
            <Button variant="secondary" onClick={reopenExam}>
              시험 다시 열기
            </Button>
          )}
        </div>
      </div>

      <div className="mt-6">
        <StatCardRow>
          <StatCard label="입장" value={`${joinedCount} / ${data.students.length}명`} />
          <StatCard label="응시 중" value={`${inProgressCount}명`} tone="good" />
          <StatCard label="제출 완료" value={`${submittedCount}명`} />
          <StatCard label="경고 발생" value={`${flaggedCount}명`} tone={flaggedCount > 0 ? 'danger' : 'neutral'} />
        </StatCardRow>
      </div>

      {data.students.length === 0 ? (
        <Card className="mt-6 text-center text-sm text-ink-soft">등록된 학생이 없습니다. 학생 관리에서 먼저 명단을 등록해주세요.</Card>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {data.students.map((s, i) => (
            <StudentCard
              key={s.roll_number}
              student={s}
              questionCount={data.exam.question_count}
              timeLimitSec={data.exam.time_limit_sec}
              index={i}
              onView={() => s.session_id != null && setViewingSessionId(s.session_id)}
              onForceEnd={() => s.session_id != null && forceEnd(s.session_id, s.roll_number)}
              onExtendTime={(seconds) => s.session_id != null && extendTime(s.session_id, seconds)}
              onRevive={() => s.session_id != null && revive(s.session_id, s.roll_number)}
            />
          ))}
        </div>
      )}

      {viewingSessionId != null && (
        <SessionDetailModal
          examId={examId}
          sessionId={viewingSessionId}
          questionCount={data.exam.question_count}
          examTitle={data.exam.title}
          onClose={() => setViewingSessionId(null)}
          live
          onForceEnd={(sessionId) => {
            const student = data.students.find((s) => s.session_id === sessionId);
            if (student) forceEnd(sessionId, student.roll_number).then(() => setViewingSessionId(null));
          }}
          onAllowRejoin={(sessionId) => {
            const student = data.students.find((s) => s.session_id === sessionId);
            if (student) allowRejoin(sessionId, student.roll_number);
          }}
          onRevive={(sessionId) => {
            const student = data.students.find((s) => s.session_id === sessionId);
            if (student) revive(sessionId, student.roll_number).then(() => setViewingSessionId(null));
          }}
        />
      )}
    </div>
  );
}
