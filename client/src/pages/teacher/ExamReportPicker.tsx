import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../../api/client';
import type { Exam, Subject } from '../../types';
import { Card } from '../../components/Card';
import { Badge } from '../../components/Badge';
import { PageHeader } from '../../components/PageHeader';
import { Pagination } from '../../components/Pagination';
import { IconChart } from '../../components/icons';
import { displaySubjectName } from '../../lib/subjectName';

const PAGE_SIZE = 8;

const GRADE_LABEL: Record<string, string> = {
  elem_1_2: '1~2학년군',
  elem_3_4: '3~4학년군',
  elem_5_6: '5~6학년군',
};

export function ExamReportPicker() {
  const navigate = useNavigate();
  const [exams, setExams] = useState<Exam[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [subjectFilter, setSubjectFilter] = useState<string>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [editingMemoId, setEditingMemoId] = useState<number | null>(null);
  const [memoDraft, setMemoDraft] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => {
    api.get<Exam[]>('/exams').then(setExams);
    api.get<Subject[]>('/standards/subjects').then(setSubjects);
  }, []);

  function startEditMemo(exam: Exam, e: React.MouseEvent) {
    e.stopPropagation();
    setEditingMemoId(exam.id);
    setMemoDraft(exam.memo ?? '');
  }

  function cancelEditMemo() {
    setEditingMemoId(null);
  }

  async function saveMemo(examId: number) {
    try {
      const updated = await api.put<Exam>(`/exams/${examId}/memo`, { memo: memoDraft });
      setExams((prev) => prev.map((e2) => (e2.id === examId ? updated : e2)));
    } catch (err) {
      alert(err instanceof ApiError ? err.message : '메모 저장 중 오류가 발생했습니다.');
    } finally {
      setEditingMemoId(null);
    }
  }

  // 관리 화면은 확정된(+숨긴) 시험만 다룬다 - 아직 작성 중인 시험은 "시험지 만들기"
  // 화면 몫이라 여기 안 섞는다.
  const manageableExams = useMemo(
    () => exams.filter((exam) => exam.status !== 'draft' && exam.status !== 'archived'),
    [exams],
  );

  // 드롭다운에는 실제로 시험이 있는 과목만 보여준다 - 텅 빈 과목까지 나열하면 고를 게
  // 없는 항목들만 늘어난다.
  const availableSubjects = useMemo(() => {
    const ids = new Set(manageableExams.map((e) => e.subject_id));
    return subjects.filter((s) => ids.has(s.subject_id));
  }, [manageableExams, subjects]);

  const visibleExams = useMemo(() => {
    return manageableExams.filter((exam) => {
      if (subjectFilter !== 'all' && exam.subject_id !== subjectFilter) return false;
      const examDate = exam.created_at.slice(0, 10);
      if (dateFrom && examDate < dateFrom) return false;
      if (dateTo && examDate > dateTo) return false;
      return true;
    });
  }, [manageableExams, subjectFilter, dateFrom, dateTo]);
  const totalPages = Math.ceil(visibleExams.length / PAGE_SIZE);
  const safePage = Math.min(page, Math.max(1, totalPages));
  const pagedExams = visibleExams.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  useEffect(() => setPage(1), [subjectFilter, dateFrom, dateTo]);

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <PageHeader icon={IconChart} title="시험별 분석" />

      {manageableExams.length > 0 && (
        <div className="animate-fade-in-up mt-5 flex flex-wrap items-center gap-2 text-xs">
          <select
            value={subjectFilter}
            onChange={(e) => setSubjectFilter(e.target.value)}
            className="rounded-lg border border-line bg-panel px-2 py-1.5 text-ink outline-none focus:border-accent"
          >
            <option value="all">전체 과목</option>
            {availableSubjects.map((s) => (
              <option key={s.subject_id} value={s.subject_id}>
                {displaySubjectName(s.subject_name)}
              </option>
            ))}
          </select>

          <span className="ml-2 font-bold text-ink-soft">기간</span>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="rounded-lg border border-line bg-panel px-2 py-1 text-ink outline-none focus:border-accent"
          />
          <span className="text-ink-soft">~</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="rounded-lg border border-line bg-panel px-2 py-1 text-ink outline-none focus:border-accent"
          />
          {(dateFrom || dateTo) && (
            <button
              className="font-bold text-accent hover:underline"
              onClick={() => {
                setDateFrom('');
                setDateTo('');
              }}
            >
              초기화
            </button>
          )}

        </div>
      )}

      <div className="mt-4 flex flex-col gap-2">
        {manageableExams.length === 0 ? (
          <p className="text-sm text-ink-soft">확정된 시험이 없습니다. 시험을 확정하면 여기서 관리할 수 있어요.</p>
        ) : visibleExams.length === 0 ? (
          <p className="text-sm text-ink-soft">조건에 맞는 시험이 없습니다.</p>
        ) : (
          pagedExams.map((exam, i) => {
            const editingMemo = editingMemoId === exam.id;
            return (
              <Card
                key={exam.id}
                className="animate-fade-in-up flex cursor-pointer items-center justify-between gap-3 transition-all duration-200 hover:-translate-y-0.5 hover:border-accent/60 hover:shadow-[0_4px_12px_rgba(16,24,40,0.08)]"
                style={{ animationDelay: `${Math.min(i, 12) * 25}ms` }}
                onClick={() => navigate(`/exams/${exam.id}/results`)}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 text-sm font-bold text-ink">
                      <span className="truncate">{exam.title}</span>
                    </p>
                    <p className="mt-0.5 text-xs text-ink-soft">
                      {GRADE_LABEL[exam.grade_cluster] || exam.grade_cluster} · {exam.subject_id} ·{' '}
                      {exam.created_at.slice(0, 10)}
                    </p>
                    {editingMemo ? (
                      <div className="mt-1 flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                        <input
                          autoFocus
                          className="w-full max-w-[220px] rounded-lg border border-line bg-bg px-2 py-1 text-xs text-ink outline-none focus:border-accent"
                          value={memoDraft}
                          maxLength={200}
                          placeholder="메모 (예: 작년 5-2 그대로 재사용)"
                          onChange={(e) => setMemoDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') saveMemo(exam.id);
                            if (e.key === 'Escape') cancelEditMemo();
                          }}
                        />
                        <button className="shrink-0 text-xs font-bold text-accent" onClick={() => saveMemo(exam.id)}>
                          저장
                        </button>
                        <button
                          className="shrink-0 text-xs font-bold text-ink-soft"
                          onClick={cancelEditMemo}
                        >
                          취소
                        </button>
                      </div>
                    ) : (
                      <button
                        className="mt-1 block max-w-full truncate text-left text-xs text-ink-soft hover:text-accent"
                        onClick={(e) => startEditMemo(exam, e)}
                      >
                        {exam.memo || '+ 메모 추가'}
                      </button>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge tone="good">결과 보기</Badge>
                </div>
              </Card>
            );
          })
        )}
      </div>
      <Pagination page={safePage} totalPages={totalPages} onChange={setPage} />
    </div>
  );
}
