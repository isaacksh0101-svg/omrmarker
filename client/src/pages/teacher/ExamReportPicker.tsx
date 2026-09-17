import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../../api/client';
import type { Exam, Subject } from '../../types';
import { Card } from '../../components/Card';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { PageHeader } from '../../components/PageHeader';
import { IconDocument } from '../../components/icons';
import { displaySubjectName } from '../../lib/subjectName';

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
  const [showArchived, setShowArchived] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  // 선택 삭제 모드 - 켜져 있는 동안엔 카드를 눌러도 결과로 안 들어가고 선택만 토글된다.
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);

  useEffect(() => {
    api.get<Exam[]>('/exams').then(setExams);
    api.get<Subject[]>('/standards/subjects').then(setSubjects);
  }, []);

  async function permanentlyDelete(exam: Exam, e: React.MouseEvent) {
    e.stopPropagation();
    if (
      !confirm(
        `"${exam.title}" 시험을 영구 삭제할까요?\n이 시험에 대한 학생 응시 기록까지 전부 사라지며 되돌릴 수 없습니다.`,
      )
    ) {
      return;
    }
    setDeletingId(exam.id);
    try {
      await api.delete(`/exams/${exam.id}/permanent`);
      setExams((prev) => prev.filter((e2) => e2.id !== exam.id));
    } catch (err) {
      alert(err instanceof ApiError ? err.message : '삭제 중 오류가 발생했습니다.');
    } finally {
      setDeletingId(null);
    }
  }

  function toggleSelect(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function exitSelectMode() {
    setSelectMode(false);
    setSelectedIds(new Set());
  }

  async function bulkDelete() {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    if (
      !confirm(
        `선택한 시험 ${ids.length}개를 영구 삭제할까요?\n이 시험들에 대한 학생 응시 기록까지 전부 사라지며 되돌릴 수 없습니다.`,
      )
    ) {
      return;
    }
    setBulkDeleting(true);
    try {
      await Promise.all(ids.map((id) => api.delete(`/exams/${id}/permanent`)));
      setExams((prev) => prev.filter((e2) => !selectedIds.has(e2.id)));
      exitSelectMode();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : '삭제 중 오류가 발생했습니다.');
    } finally {
      setBulkDeleting(false);
    }
  }

  // 드롭다운에는 실제로 시험이 있는 과목만 보여준다 - 텅 빈 과목까지 나열하면 고를 게
  // 없는 항목들만 늘어난다.
  const availableSubjects = useMemo(() => {
    const ids = new Set(exams.map((e) => e.subject_id));
    return subjects.filter((s) => ids.has(s.subject_id));
  }, [exams, subjects]);

  const visibleExams = useMemo(() => {
    return exams.filter((exam) => {
      if (!showArchived && exam.status === 'archived') return false;
      if (subjectFilter !== 'all' && exam.subject_id !== subjectFilter) return false;
      const examDate = exam.created_at.slice(0, 10);
      if (dateFrom && examDate < dateFrom) return false;
      if (dateTo && examDate > dateTo) return false;
      return true;
    });
  }, [exams, showArchived, subjectFilter, dateFrom, dateTo]);

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <PageHeader
        icon={IconDocument}
        title="시험별 리포트"
        right={
          !selectMode ? (
            exams.length > 0 && (
              <button className="text-xs font-bold text-ink-soft hover:text-ink" onClick={() => setSelectMode(true)}>
                선택 삭제
              </button>
            )
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-ink-soft">{selectedIds.size}개 선택됨</span>
              <button className="text-xs font-bold text-ink-soft hover:text-ink" onClick={exitSelectMode}>
                취소
              </button>
              <Button variant="danger" disabled={selectedIds.size === 0 || bulkDeleting} onClick={bulkDelete}>
                {bulkDeleting ? '삭제 중...' : `영구 삭제 (${selectedIds.size})`}
              </Button>
            </div>
          )
        }
      />

      {exams.length > 0 && (
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

          <label className="ml-auto flex items-center gap-1.5 font-bold text-ink-soft">
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
            삭제된 시험도 표시
          </label>
        </div>
      )}

      <div className="mt-4 flex flex-col gap-2">
        {exams.length === 0 ? (
          <p className="text-sm text-ink-soft">아직 만든 시험이 없습니다.</p>
        ) : visibleExams.length === 0 ? (
          <p className="text-sm text-ink-soft">조건에 맞는 시험이 없습니다.</p>
        ) : (
          visibleExams.map((exam, i) => {
            // 삭제(보관 처리)된 시험도 한때 확정되어 결과가 쌓였다면 계속 리포트를 볼 수 있어야 한다.
            const viewable = exam.status === 'finalized' || exam.status === 'archived';
            const selected = selectedIds.has(exam.id);
            return (
              <Card
                key={exam.id}
                className={`animate-fade-in-up flex items-center justify-between gap-3 transition-all duration-200 ${
                  selectMode
                    ? `cursor-pointer ${selected ? 'border-accent bg-accent-soft' : 'hover:border-accent/40'}`
                    : viewable
                      ? 'cursor-pointer hover:-translate-y-0.5 hover:border-accent/60 hover:shadow-[0_4px_12px_rgba(16,24,40,0.08)]'
                      : 'opacity-60'
                }`}
                style={{ animationDelay: `${Math.min(i, 12) * 25}ms` }}
                onClick={() => (selectMode ? toggleSelect(exam.id) : viewable && navigate(`/exams/${exam.id}/results`))}
              >
                <div className="flex min-w-0 items-center gap-3">
                  {selectMode && (
                    <span
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 text-[11px] font-bold transition-colors duration-150 ${
                        selected ? 'border-accent bg-accent text-white' : 'border-line text-transparent'
                      }`}
                    >
                      ✓
                    </span>
                  )}
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 text-sm font-bold text-ink">
                      <span className="truncate">{exam.title}</span>
                      {exam.status === 'archived' && <Badge tone="neutral">삭제됨</Badge>}
                    </p>
                    <p className="mt-0.5 text-xs text-ink-soft">
                      {GRADE_LABEL[exam.grade_cluster] || exam.grade_cluster} · {exam.subject_id} ·{' '}
                      {exam.created_at.slice(0, 10)}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge tone={viewable ? 'good' : 'neutral'}>
                    {viewable ? '결과 보기' : '확정 후 리포트를 볼 수 있습니다'}
                  </Badge>
                  {!selectMode && (
                    <button
                      className="text-xs font-bold text-ink-soft hover:text-danger disabled:opacity-50"
                      disabled={deletingId === exam.id}
                      onClick={(e) => permanentlyDelete(exam, e)}
                    >
                      영구 삭제
                    </button>
                  )}
                </div>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}
