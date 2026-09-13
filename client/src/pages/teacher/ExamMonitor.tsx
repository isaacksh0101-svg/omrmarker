import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../../api/client';
import { getSocket } from '../../lib/socket';
import type { ExamMonitorData, MonitorStudent, SessionMonitorDetail, SessionStatus } from '../../types';
import { Card } from '../../components/Card';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { StatCard, StatCardRow } from '../../components/StatCard';
import { IconEye, IconStopCircle } from '../../components/icons';

type Tone = 'neutral' | 'good' | 'warn' | 'danger';

const STATUS_META: Record<SessionStatus, { label: string; tone: Tone; dot: string }> = {
  joined: { label: '참여함(대기중)', tone: 'neutral', dot: 'bg-ink-soft' },
  in_progress: { label: '응시 중', tone: 'good', dot: 'bg-good' },
  submitted: { label: '제출 완료', tone: 'neutral', dot: 'bg-ink-soft' },
  force_submitted: { label: '강제 종료됨', tone: 'danger', dot: 'bg-danger' },
  disqualified: { label: '실격', tone: 'danger', dot: 'bg-danger' },
};

const NOT_JOINED_META = { label: '입장 전', tone: 'neutral' as Tone, dot: 'bg-line' };

function statusMeta(status: SessionStatus | null) {
  if (!status) return NOT_JOINED_META;
  return STATUS_META[status];
}

function formatMs(ms: number | null) {
  if (ms == null) return '-';
  return `${Math.round(ms / 1000)}초`;
}

function StudentCard({
  student,
  questionCount,
  maxWarnings,
  index,
  onView,
  onForceEnd,
}: {
  student: MonitorStudent;
  questionCount: number;
  maxWarnings: number;
  index: number;
  onView: () => void;
  onForceEnd: () => void;
}) {
  const meta = statusMeta(student.status);
  const canView = student.session_id != null;
  const canForceEnd = student.status === 'joined' || student.status === 'in_progress';
  const warnCount = student.warning_count ?? 0;
  const warnTone: Tone = warnCount === 0 ? 'neutral' : warnCount >= maxWarnings ? 'danger' : 'warn';
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
        <button
          type="button"
          disabled={!canForceEnd}
          onClick={onForceEnd}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-full border border-line py-1.5 text-xs font-bold text-ink-soft transition-colors duration-150 hover:border-danger hover:bg-danger/10 hover:text-danger disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-line disabled:hover:bg-transparent disabled:hover:text-ink-soft"
        >
          <IconStopCircle className="h-3.5 w-3.5" />
          강제 종료
        </button>
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
}: {
  examId: number;
  sessionId: number;
  questionCount: number;
  onClose: () => void;
  onForceEnd: (sessionId: number) => void;
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

  const meta = detail ? statusMeta(detail.session.status) : null;
  const canForceEnd = detail?.session.status === 'joined' || detail?.session.status === 'in_progress';

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
                  {detail.currentQuestion.prompt && (
                    <p className="mt-2 whitespace-pre-wrap text-sm font-bold text-ink">
                      {detail.currentQuestion.prompt}
                    </p>
                  )}
                  {detail.currentQuestion.type === 'mc' && (
                    <div className="mt-2 flex flex-col gap-1.5">
                      {detail.currentQuestion.choices.map((c) => (
                        <div
                          key={c.id}
                          className="flex items-center justify-between rounded-lg border border-line bg-panel px-2.5 py-1.5 text-xs text-ink"
                        >
                          <span>{c.text}</span>
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
          <div className="border-t border-line px-5 py-3">
            <Button variant="danger" className="w-full" onClick={() => onForceEnd(sessionId)}>
              이 학생 시험 강제 종료
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

  async function forceEnd(sessionId: number, rollNumber: number) {
    if (!confirm(`${rollNumber}번 학생의 시험을 지금 강제로 종료할까요? 되돌릴 수 없습니다.`)) return;
    try {
      await api.post(`/exams/${examId}/sessions/${sessionId}/force-submit`);
      load();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : '강제 종료 중 오류가 발생했습니다.');
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
        `시험을 전체 종료할까요? 아직 대기·응시 중인 학생 ${activeCount}명이 지금까지 낸 답까지만 인정되어 즉시 제출 처리됩니다. 되돌릴 수 없습니다.`,
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
  const examStarted = !!data.exam.started_at;

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
        <span className="text-xs text-ink-soft">실시간 감독 중</span>

        <div className="ml-auto flex items-center gap-2">
          {waitingCount > 0 ? (
            <Button onClick={() => startExam(waitingCount, examStarted)}>
              {examStarted ? `대기 중인 학생 시작 (${waitingCount}명)` : '시험 시작'}
            </Button>
          ) : examStarted ? (
            <Badge tone="good">모든 학생 시작함</Badge>
          ) : (
            <Badge tone="neutral">입장한 학생이 없습니다</Badge>
          )}
          <Button
            variant="danger"
            disabled={activeCount === 0}
            title={activeCount === 0 ? '대기·응시 중인 학생이 없습니다.' : undefined}
            onClick={() => endExam(activeCount)}
          >
            시험 전체 종료
          </Button>
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
              maxWarnings={data.max_warnings}
              index={i}
              onView={() => s.session_id != null && setViewingSessionId(s.session_id)}
              onForceEnd={() => s.session_id != null && forceEnd(s.session_id, s.roll_number)}
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
        />
      )}
    </div>
  );
}
