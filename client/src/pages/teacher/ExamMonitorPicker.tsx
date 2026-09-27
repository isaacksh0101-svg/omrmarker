import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../../api/client';
import type { Exam, LanInfo } from '../../types';
import { Card } from '../../components/Card';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { PageHeader } from '../../components/PageHeader';
import { IconMonitor } from '../../components/icons';
import { Pagination } from '../../components/Pagination';

const PAGE_SIZE = 8;

const GRADE_LABEL: Record<string, string> = {
  elem_1_2: '1~2학년군',
  elem_3_4: '3~4학년군',
  elem_5_6: '5~6학년군',
};

export function ExamMonitorPicker() {
  const navigate = useNavigate();
  const [exams, setExams] = useState<Exam[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [page, setPage] = useState(1);
  const [selecting, setSelecting] = useState(false);
  const [showEnded, setShowEnded] = useState(false);
  const [activatingId, setActivatingId] = useState<number | null>(null);
  const [endingId, setEndingId] = useState<number | null>(null);
  const [regeneratingId, setRegeneratingId] = useState<number | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [lanInfo, setLanInfo] = useState<LanInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<Exam[]>('/exams').then(setExams).finally(() => setLoaded(true));
    api.get<LanInfo>('/lan-info').then(setLanInfo).catch(() => {});
  }, []);

  const activeExams = exams
    .filter((e) => e.status === 'finalized' && e.supervised_at && !e.ends_at)
    .sort((a, b) => (a.supervision_order ?? 0) - (b.supervision_order ?? 0));
  const readyExams = exams.filter((e) => e.status === 'finalized' && !e.supervised_at && !e.ends_at);
  const endedExams = exams.filter((e) => e.status === 'finalized' && !e.supervised_at && !!e.ends_at);
  // 종료된 시험은 계속 쌓이므로 기본 목록에서는 숨기되, 필요할 때만 펼쳐서 기존 감독
  // 화면과 결과에 접근할 수 있게 한다.
  const monitorable = showEnded ? [...readyExams, ...endedExams] : readyExams;
  const totalPages = Math.ceil(monitorable.length / PAGE_SIZE);
  const safePage = Math.min(page, Math.max(1, totalPages));
  const pagedExams = monitorable.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  function openSelection() {
    setSelecting(true);
    setShowEnded(false);
    setPage(1);
  }

  async function selectExam(exam: Exam) {
    setActivatingId(exam.id);
    setError(null);
    try {
      const activated = exam.ends_at
        ? await api.post<Exam>(`/exams/${exam.id}/reopen`)
        : await api.post<Exam>(`/exams/${exam.id}/supervise`);
      setExams((current) => current.map((item) => (item.id === exam.id ? { ...item, ...activated } : item)));
      setSelecting(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '감독할 시험을 등록하지 못했습니다.');
    } finally {
      setActivatingId(null);
    }
  }

  async function endExam(exam: Exam) {
    const message = exam.started_at
      ? `“${exam.title}” 시험을 종료할까요?\n대기·응시 중인 학생은 지금까지 제출한 답안으로 즉시 마감됩니다.`
      : `“${exam.title}” 시험 감독을 종료할까요?\n아직 입장 대기 중인 학생도 더 이상 이 시험에 참여할 수 없습니다.`;
    if (!confirm(message)) return;

    setEndingId(exam.id);
    setError(null);
    try {
      await api.post(`/exams/${exam.id}/end-all`);
      setExams((current) =>
        current.map((item) =>
          item.id === exam.id ? { ...item, supervised_at: null, ends_at: new Date().toISOString() } : item,
        ),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '시험을 종료하지 못했습니다.');
    } finally {
      setEndingId(null);
    }
  }

  async function copyText(value: string, key: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      setError('복사하지 못했습니다. 화면의 값을 직접 선택해 복사해주세요.');
    }
  }

  async function regenerateCode(exam: Exam) {
    if (!confirm(`“${exam.title}”의 입장 코드를 새로 만들까요? 기존 코드는 즉시 사용할 수 없게 됩니다.`)) return;
    setRegeneratingId(exam.id);
    setError(null);
    try {
      const result = await api.post<{ admission_code: string }>(`/exams/${exam.id}/admission-code`);
      setExams((current) =>
        current.map((item) => (item.id === exam.id ? { ...item, admission_code: result.admission_code } : item)),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '입장 코드를 변경하지 못했습니다.');
    } finally {
      setRegeneratingId(null);
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <PageHeader
        icon={IconMonitor}
        title="시험 감독"
        right={selecting ? (
          <button className="text-xs font-bold text-ink-soft hover:text-ink" onClick={() => setSelecting(false)}>
            선택 취소
          </button>
        ) : undefined}
      />

      <Card className="mt-5 flex items-center gap-4 p-4">
        {lanInfo?.qr && lanInfo.accessReady && (
          <img src={lanInfo.qr} alt="학생 접속 QR 코드" className="h-32 w-32 shrink-0 rounded-xl border border-line" />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-ink">학생 접속 안내</p>
          {!lanInfo ? (
            <p className="mt-1 text-xs text-ink-soft">접속 주소를 불러오는 중...</p>
          ) : lanInfo.accessReady ? (
            <>
              <p className="mt-1 truncate text-xs text-ink-soft" title={lanInfo.studentUrl}>{lanInfo.studentUrl}</p>
              <button className="mt-1 text-xs font-bold text-accent" onClick={() => copyText(lanInfo.studentUrl, 'url')}>
                {copied === 'url' ? '링크 복사됨!' : '학생 접속 링크 복사'}
              </button>
            </>
          ) : (
            <p className="mt-1 text-xs font-bold text-warning">
              학생 접속용 네트워크를 선택해주세요.{' '}
              <Link to="/settings" className="underline">환경설정 열기</Link>
            </p>
          )}
        </div>
      </Card>

      {!selecting && activeExams.length === 0 && (
        <Card className="animate-fade-in-up mt-7 flex flex-col items-center py-12 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent-soft text-accent">
            <IconMonitor className="h-6 w-6" />
          </div>
          <p className="mt-4 text-base font-bold text-ink">감독할 시험을 선택해 주세요</p>
          <p className="mt-1 text-sm text-ink-soft">선택한 시험은 학생 화면에 순서대로 표시됩니다.</p>
          <Button className="mt-5" onClick={openSelection}>
            감독할 시험 선택
          </Button>
        </Card>
      )}

      {!selecting && activeExams.length > 0 && (
        <div className="mt-7">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-bold text-ink">감독중인 시험</p>
              <p className="mt-0.5 text-xs text-ink-soft">학생은 아래 순서대로 시험을 이어서 응시합니다.</p>
            </div>
            <Button variant="secondary" onClick={openSelection}>
              시험 추가
            </Button>
          </div>
          <div className="mt-3 flex flex-col gap-2">
            {activeExams.map((exam, index) => (
              <Card
                key={exam.id}
                className="animate-fade-in-up flex cursor-pointer items-center justify-between transition-all hover:-translate-y-0.5 hover:border-accent hover:shadow-md"
                onClick={() => navigate(`/exam-monitor/${exam.id}`)}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-good/10 text-xs font-bold text-good">
                    {index + 1}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-ink">{exam.title}</p>
                    <p className="mt-0.5 text-xs text-ink-soft">
                      {Math.round(exam.time_limit_sec / 60)}분 · {exam.started_at ? '진행 중' : '입장 대기 중'}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span className="text-[11px] font-bold text-ink-soft">입장 코드</span>
                      <span className="font-mono text-base font-black tracking-[0.18em] text-accent-ink">
                        {exam.admission_code || '------'}
                      </span>
                      {exam.admission_code && (
                        <button
                          className="text-[11px] font-bold text-accent"
                          onClick={(event) => {
                            event.stopPropagation();
                            copyText(exam.admission_code!, `code-${exam.id}`);
                          }}
                        >
                          {copied === `code-${exam.id}` ? '복사됨!' : '복사'}
                        </button>
                      )}
                      <button
                        className="text-[11px] font-bold text-ink-soft hover:text-accent"
                        disabled={regeneratingId === exam.id}
                        onClick={(event) => {
                          event.stopPropagation();
                          regenerateCode(exam);
                        }}
                      >
                        {regeneratingId === exam.id ? '변경 중...' : '코드 변경'}
                      </button>
                    </div>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={(event) => {
                      event.stopPropagation();
                      navigate(`/exam-monitor/${exam.id}`);
                    }}
                  >
                    감독 화면
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    disabled={endingId === exam.id}
                    onClick={(event) => {
                      event.stopPropagation();
                      endExam(exam);
                    }}
                  >
                    {endingId === exam.id ? '종료 중...' : '시험 종료'}
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {selecting && loaded && (monitorable.length > 0 || endedExams.length > 0) && (
        <div className="animate-fade-in-up mt-7 flex items-center justify-between gap-3">
          <p className="text-sm font-bold text-ink-soft">감독할 시험지를 선택하세요.</p>
          {endedExams.length > 0 && (
            <button
              className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-bold transition-colors ${
                showEnded ? 'bg-danger/10 text-danger' : 'border border-line bg-panel text-ink-soft hover:border-accent hover:text-accent'
              }`}
              onClick={() => {
                setShowEnded((value) => !value);
                setPage(1);
              }}
            >
              {showEnded ? '종료된 시험 숨기기' : `종료된 시험 보기 (${endedExams.length})`}
            </button>
          )}
        </div>
      )}

      {selecting && <div className={`flex flex-col gap-2 ${loaded && (monitorable.length > 0 || endedExams.length > 0) ? 'mt-2' : 'mt-7'}`}>
        {loaded && monitorable.length === 0 && (
          <Card className="animate-fade-in-up text-center text-sm text-ink-soft">
            {endedExams.length > 0
              ? '새로 감독할 시험이 없습니다. 종료된 시험을 보려면 위 버튼을 눌러주세요.'
              : '확정된 시험이 없습니다. 시험을 확정하면 여기서 감독할 수 있어요.'}
          </Card>
        )}
        {pagedExams.map((exam, i) => (
          <Card
            key={exam.id}
            className="animate-fade-in-up flex cursor-pointer items-center justify-between transition-all duration-200 hover:-translate-y-0.5 hover:border-accent hover:shadow-md"
            style={{ animationDelay: `${Math.min(i, 8) * 35}ms` }}
            onClick={() => {
              if (activatingId) return;
              selectExam(exam);
            }}
          >
            <div>
              <div className="flex items-center gap-1.5">
                <span
                  className={`h-2 w-2 shrink-0 rounded-full transition-colors duration-300 ${
                    exam.ends_at ? 'bg-danger' : exam.started_at ? 'bg-good' : 'bg-line'
                  }`}
                  title={exam.ends_at ? '종료됨' : exam.started_at ? '감독중' : '감독중 아님'}
                />
                <p className="text-sm font-bold text-ink">{exam.title}</p>
              </div>
              <p className="mt-0.5 text-xs text-ink-soft">
                {GRADE_LABEL[exam.grade_cluster] || exam.grade_cluster} · {exam.subject_id} ·{' '}
                {Math.round(exam.time_limit_sec / 60)}분
              </p>
            </div>
            <Badge tone={exam.ends_at ? 'danger' : 'good'}>
              {activatingId === exam.id ? '등록 중...' : exam.ends_at ? '다시 감독하기' : '감독하기'}
            </Badge>
          </Card>
        ))}
      </div>}
      {selecting && <Pagination page={safePage} totalPages={totalPages} onChange={setPage} />}
      {error && <p className="mt-3 text-sm font-bold text-danger">{error}</p>}
    </div>
  );
}
