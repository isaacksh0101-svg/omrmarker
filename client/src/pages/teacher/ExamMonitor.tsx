import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../../api/client';
import { getSocket } from '../../lib/socket';
import type { ExamMonitorData, MonitorStudent, SessionMonitorDetail, SessionStatus } from '../../types';
import { Card } from '../../components/Card';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { StatCard, StatCardRow } from '../../components/StatCard';
import { MathText } from '../../components/MathText';
import { IconEye, IconStopCircle, IconUndo } from '../../components/icons';

type Tone = 'neutral' | 'good' | 'warn' | 'danger';

const STATUS_META: Record<SessionStatus, { label: string; tone: Tone; dot: string }> = {
  joined: { label: '참여함(대기중)', tone: 'neutral', dot: 'bg-ink-soft' },
  in_progress: { label: '응시 중', tone: 'good', dot: 'bg-good' },
  submitted: { label: '제출 완료', tone: 'neutral', dot: 'bg-ink-soft' },
  force_submitted: { label: '강제 종료됨', tone: 'danger', dot: 'bg-danger' },
  disqualified: { label: '실격', tone: 'danger', dot: 'bg-danger' },
};

const NOT_JOINED_META = { label: '입장 전', tone: 'neutral' as Tone, dot: 'bg-line' };

// force_submitted면 왜 종료됐는지(교사가 직접 종료했는지, 화면 이탈이 감지돼 자동으로
// 종료됐는지)까지 라벨에 같이 보여준다 - 학생이 "소명"하러 왔을 때 교사가 근거를 바로 볼 수 있게.
function statusMeta(status: SessionStatus | null, disqualifyReason?: string | null) {
  if (!status) return NOT_JOINED_META;
  if (status === 'force_submitted' && disqualifyReason === 'screen_leave') {
    return { label: '자동 종료됨(화면 이탈 감지)', tone: 'danger' as Tone, dot: 'bg-danger' };
  }
  if (status === 'force_submitted' && disqualifyReason === 'teacher_manual') {
    return { label: '강제 종료됨(교사)', tone: 'danger' as Tone, dot: 'bg-danger' };
  }
  return STATUS_META[status];
}

function formatMs(ms: number | null) {
  if (ms == null) return '-';
  return `${Math.round(ms / 1000)}초`;
}

const EXTRA_TIME_OPTIONS = [
  { label: '+1분', seconds: 60 },
  { label: '+5분', seconds: 300 },
  { label: '+10분', seconds: 600 },
];

function StudentCard({
  student,
  questionCount,
  index,
  onView,
  onForceEnd,
  onExtendTime,
  onRevive,
}: {
  student: MonitorStudent;
  questionCount: number;
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
  const warnCount = student.warning_count ?? 0;
  const warnTone: Tone = warnCount > 0 ? 'danger' : 'neutral';
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
        <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-bold text-accent-ink">
          {student.roll_number}
          {student.status === 'in_progress' && (
            <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 animate-pulse rounded-full bg-good ring-2 ring-panel" />
          )}
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
        <span className="text-xs font-bold text-ink-soft">누적 경고</span>
        <Badge tone={warnTone}>{warnCount}회</Badge>
      </div>

      {student.status === 'in_progress' && (
        <div className="flex items-center justify-between gap-1.5">
          <span className="shrink-0 whitespace-nowrap text-[11px] font-bold text-ink-soft">
            시간추가{extraTimeSec > 0 ? ` +${Math.round(extraTimeSec / 60)}분` : ''}
          </span>
          <div className="flex shrink-0 gap-1">
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

function StudentDetailModal({
  examId,
  sessionId,
  questionCount,
  onClose,
  onForceEnd,
  onAllowRejoin,
  onRevive,
}: {
  examId: number;
  sessionId: number;
  questionCount: number;
  onClose: () => void;
  onForceEnd: (sessionId: number) => void;
  onAllowRejoin: (sessionId: number) => void;
  onRevive: (sessionId: number) => void;
}) {
  const [detail, setDetail] = useState<SessionMonitorDetail | null>(null);

  const load = useCallback(() => {
    api.get<SessionMonitorDetail>(`/exams/${examId}/sessions/${sessionId}/monitor`).then(setDetail);
  }, [examId, sessionId]);

  useEffect(() => {
    load();
    const interval = setInterval(load, 3000);
    return () => clearInterval(interval);
  }, [load]);

  const meta = detail ? statusMeta(detail.session.status, detail.session.disqualify_reason) : null;
  const canForceEnd = detail?.session.status === 'joined' || detail?.session.status === 'in_progress';
  const canRevive = detail?.session.status === 'force_submitted';

  return (
    <div
      className="animate-overlay-in fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4"
      onClick={onClose}
    >
      <div
        className="animate-scale-in flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-panel shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div>
            <p className="text-sm font-bold text-ink">
              {detail?.student?.roll_number}번 {detail?.student?.name || ''}
            </p>
            {meta && (
              <div className="mt-0.5 flex items-center gap-1.5">
                <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
                <span className="text-xs text-ink-soft">{meta.label}</span>
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full px-2 py-1 text-xs font-bold text-ink-soft transition-colors duration-150 hover:bg-panel hover:text-ink"
          >
            닫기
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {!detail ? (
            <p className="text-sm text-ink-soft">불러오는 중...</p>
          ) : (
            <>
              {detail.currentQuestion && (
                <div className="animate-fade-in-up rounded-xl border border-line bg-bg p-3.5">
                  <p className="text-xs font-bold text-accent-ink">
                    지금 보고 있는 화면 · {detail.currentQuestion.index + 1} / {detail.currentQuestion.total}
                  </p>
                  {detail.currentQuestion.prompt_image_path ? (
                    <img
                      src={`/uploads/${detail.currentQuestion.prompt_image_path}`}
                      alt="문항 이미지"
                      className="mt-2 max-w-full rounded-lg border border-line"
                    />
                  ) : (
                    detail.currentQuestion.prompt && (
                      <p className="mt-2 whitespace-pre-wrap text-sm font-bold text-ink">
                        <MathText text={detail.currentQuestion.prompt} />
                      </p>
                    )
                  )}
                  {detail.currentQuestion.type === 'mc' && (
                    <div className="mt-2 flex flex-col gap-1.5">
                      {detail.currentQuestion.choices.map((c) => (
                        <div
                          key={c.id}
                          className="flex items-center justify-between rounded-lg border border-line bg-panel px-2.5 py-1.5 text-xs text-ink"
                        >
                          <span>
                            <MathText text={c.text} />
                          </span>
                          {c.is_correct && <span className="text-[10px] font-bold text-good">정답(교사용)</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {(detail.session.status === 'submitted' || detail.session.status === 'force_submitted') && (
                <div className="rounded-xl border border-line bg-bg p-3.5">
                  <p className="text-xs font-bold text-ink-soft">최종 점수</p>
                  <p className="mt-1 text-lg font-bold text-ink">
                    {detail.session.score ?? 0} / {detail.session.max_score ?? 0}
                  </p>
                </div>
              )}

              <p className="mt-4 text-xs font-bold text-ink-soft">
                지금까지 응답 ({detail.history.length} / {questionCount})
              </p>
              {detail.history.length === 0 ? (
                <p className="mt-1.5 text-xs text-ink-soft">아직 제출한 답이 없습니다.</p>
              ) : (
                <div className="mt-1.5 flex flex-col divide-y divide-line">
                  {detail.history.map((h) => (
                    <div key={h.order_index} className="flex items-center gap-2 py-2">
                      <span
                        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                          h.is_correct ? 'bg-good/15 text-good' : 'bg-danger/15 text-danger'
                        }`}
                      >
                        {h.order_index + 1}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-xs text-ink-soft">
                        {h.selected_choice_text ?? h.short_answer_text ?? '-'}
                      </span>
                      <span className="shrink-0 text-[11px] text-ink-soft">{formatMs(h.time_spent_ms)}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {canForceEnd && (
          <div className="flex flex-col gap-2 border-t border-line px-5 py-3">
            <Button variant="secondary" className="w-full" onClick={() => onAllowRejoin(sessionId)}>
              재참여 허용 (다른 기기로 이어가기)
            </Button>
            <Button variant="danger" className="w-full" onClick={() => onForceEnd(sessionId)}>
              이 학생 시험 강제 종료
            </Button>
          </div>
        )}
        {canRevive && (
          <div className="border-t border-line px-5 py-3">
            <Button variant="secondary" className="w-full" onClick={() => onRevive(sessionId)}>
              강제 종료 취소하고 되살리기
            </Button>
          </div>
        )}
      </div>
    </div>
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
  const pulseTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  async function startExam(waitingCount: number, alreadyStarted: boolean) {
    const message = alreadyStarted
      ? `아직 대기 중인 학생 ${waitingCount}명을 지금 시작할까요?`
      : `지금 시험을 시작할까요? 입장한 학생 ${waitingCount}명의 화면에 바로 첫 문항이 표시됩니다.`;
    if (!confirm(message)) return;
    try {
      await api.post(`/exams/${examId}/start`);
      load();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : '시작 중 오류가 발생했습니다.');
    }
  }

  async function endExam(activeCount: number) {
    if (
      !confirm(
        `시험을 전체 종료할까요? 아직 대기·응시 중인 학생 ${activeCount}명이 지금까지 낸 답까지만 인정되어 즉시 제출 처리됩니다.\n종료 후에도 "전체 되살리기"로 다시 응시 중 상태로 되돌릴 수 있습니다.`,
      )
    ) {
      return;
    }
    try {
      await api.post(`/exams/${examId}/end-all`);
      load();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : '종료 중 오류가 발생했습니다.');
    }
  }

  // "시험 전체 종료"를 취소하고 다시 감독중 상태로 되돌린다 - 강제 제출됐던 학생들을
  // 응시 중으로 되살리는 동시에, 감독 화면 상단도 "종료됨"에서 "감독중"으로 돌아간다.
  async function restartExam(forceSubmittedCount: number) {
    const message =
      forceSubmittedCount > 0
        ? `강제 종료됐던 학생 ${forceSubmittedCount}명을 응시 중으로 되돌리고 시험을 재시작할까요?\n각자 경고 횟수는 0으로 초기화되고, 제한시간은 지금부터 다시 시작됩니다.`
        : '시험을 재시작할까요? 감독 화면이 다시 "감독중" 상태로 돌아갑니다.';
    if (!confirm(message)) return;
    try {
      await api.post(`/exams/${examId}/revive-all`);
      load();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : '재시작 중 오류가 발생했습니다.');
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
  const activeCount = data.students.filter((s) => s.status === 'joined' || s.status === 'in_progress').length;
  const forceSubmittedCount = data.students.filter((s) => s.status === 'force_submitted').length;
  const examStarted = !!data.exam.started_at;
  // "시험 전체 종료" 버튼을 누른 게 1차 기준(exam.ends_at)이지만, 그 뒤에 지각 학생이
  // 새로 입장하는 등 실제로 응시 중인 학생이 생기면 - ends_at이 남아있어도 - 감독중으로
  // 본다. 교사 액션이 기준이되 화면이 거짓말하지 않도록 실제 현황이 최종 안전망이다.
  const examEnded = !!data.exam.ends_at && activeCount === 0;

  return (
    <div className="mx-auto max-w-6xl px-6 py-12">
      <button className="text-xs font-bold text-ink-soft transition-colors duration-150 hover:text-accent" onClick={() => navigate('/exam-monitor')}>
        ← 시험 감독
      </button>

      <div className="animate-fade-in-up mt-3 flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-bold tracking-tight text-ink">{data.exam.title}</h1>
        <span
          className={`h-2 w-2 rounded-full transition-colors duration-300 ${pulse ? 'bg-good' : 'bg-line'}`}
          title="실시간 연결됨"
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

        <div className="ml-auto flex items-center gap-2">
          {waitingCount > 0 ? (
            <Button onClick={() => startExam(waitingCount, examStarted)}>
              {examStarted ? `대기 중인 학생 시작 (${waitingCount}명)` : '시험 시작'}
            </Button>
          ) : examStarted && !examEnded ? (
            <Badge tone="good">모든 학생 시작함</Badge>
          ) : !examEnded ? (
            <Badge tone="neutral">입장한 학생이 없습니다</Badge>
          ) : null}
          {!examEnded && (
            <Button
              variant="danger"
              disabled={activeCount === 0}
              title={activeCount === 0 ? '대기·응시 중인 학생이 없습니다.' : undefined}
              onClick={() => endExam(activeCount)}
            >
              시험 전체 종료
            </Button>
          )}
          {examEnded && (
            <Button variant="secondary" onClick={() => restartExam(forceSubmittedCount)}>
              시험 재시작{forceSubmittedCount > 0 ? ` (${forceSubmittedCount}명)` : ''}
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
        <StudentDetailModal
          examId={examId}
          sessionId={viewingSessionId}
          questionCount={data.exam.question_count}
          onClose={() => setViewingSessionId(null)}
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
