import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../../api/client';
import type { Exam, Subject } from '../../types';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { PageHeader } from '../../components/PageHeader';
import { Pagination } from '../../components/Pagination';
import { IconChevronRight, IconDocument } from '../../components/icons';
import { displaySubjectName } from '../../lib/subjectName';

const PAGE_SIZE = 8;

const GRADE_LABEL: Record<string, string> = {
  elem_1_2: '1~2학년군', elem_3_4: '3~4학년군', elem_5_6: '5~6학년군',
};

export function ExamManagement() {
  const navigate = useNavigate();
  const [exams, setExams] = useState<Exam[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [subjectFilter, setSubjectFilter] = useState('all');
  const [showArchived, setShowArchived] = useState(false);
  const [page, setPage] = useState(1);
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [hiding, setHiding] = useState(false);
  const [restoring, setRestoring] = useState(false);

  useEffect(() => {
    api.get<Exam[]>('/exams').then(setExams);
    api.get<Subject[]>('/standards/subjects').then(setSubjects);
  }, []);

  const visibleExams = useMemo(() => exams.filter((exam) => {
    if (!showArchived && exam.status === 'archived') return false;
    return subjectFilter === 'all' || exam.subject_id === subjectFilter;
  }), [exams, showArchived, subjectFilter]);
  const usedSubjects = subjects.filter((subject) => exams.some((exam) => exam.subject_id === subject.subject_id));
  const totalPages = Math.ceil(visibleExams.length / PAGE_SIZE);
  const safePage = Math.min(page, Math.max(1, totalPages));
  const pagedExams = visibleExams.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  useEffect(() => setPage(1), [subjectFilter, showArchived]);

  async function unhide(exam: Exam, event: React.MouseEvent) {
    event.stopPropagation();
    try {
      const updated = await api.post<Exam>(`/exams/${exam.id}/unarchive`);
      setExams((current) => current.map((item) => item.id === exam.id ? updated : item));
    } catch (error) {
      alert(error instanceof ApiError ? error.message : '다시 보이기 중 오류가 발생했습니다.');
    }
  }

  function toggleSelect(id: number) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function exitSelectMode() {
    setSelecting(false);
    setSelectedIds(new Set());
  }

  async function deleteSelected() {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    if (!confirm(`선택한 시험지 ${ids.length}개를 영구 삭제할까요?\n학생 응시 기록과 결과도 함께 삭제되며 되돌릴 수 없습니다.`)) return;
    setDeleting(true);
    try {
      await Promise.all(ids.map((id) => api.delete(`/exams/${id}/permanent`)));
      setExams((current) => current.filter((exam) => !selectedIds.has(exam.id)));
      exitSelectMode();
    } catch (error) {
      alert(error instanceof ApiError ? error.message : '삭제 중 오류가 발생했습니다.');
    } finally {
      setDeleting(false);
    }
  }

  const hideableSelectedIds = [...selectedIds].filter((id) => {
    const exam = exams.find((item) => item.id === id);
    return exam && exam.status !== 'archived' && !exam.supervised_at;
  });
  const archivedSelectedIds = [...selectedIds].filter((id) =>
    exams.some((exam) => exam.id === id && exam.status === 'archived'),
  );

  async function hideSelected() {
    if (hideableSelectedIds.length === 0) return;
    if (!confirm(`선택한 시험지 ${hideableSelectedIds.length}개를 숨길까요?\n응시 기록과 결과는 삭제되지 않으며 “숨김 항목 보기”에서 다시 보이게 할 수 있습니다.`)) return;
    setHiding(true);
    try {
      await Promise.all(hideableSelectedIds.map((id) => api.delete(`/exams/${id}`)));
      const hiddenIds = new Set(hideableSelectedIds);
      setExams((current) => current.map((exam) => hiddenIds.has(exam.id) ? { ...exam, status: 'archived' } : exam));
      exitSelectMode();
    } catch (error) {
      alert(error instanceof ApiError ? error.message : '숨기는 중 오류가 발생했습니다.');
    } finally {
      setHiding(false);
    }
  }

  async function restoreSelected() {
    if (archivedSelectedIds.length === 0) return;
    setRestoring(true);
    try {
      const restored = await Promise.all(
        archivedSelectedIds.map((id) => api.post<Exam>(`/exams/${id}/unarchive`)),
      );
      const restoredById = new Map(restored.map((exam) => [exam.id, exam]));
      setExams((current) => current.map((exam) => restoredById.get(exam.id) ?? exam));
      exitSelectMode();
    } catch (error) {
      alert(error instanceof ApiError ? error.message : '다시 보이게 하는 중 오류가 발생했습니다.');
    } finally {
      setRestoring(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <PageHeader
        icon={IconDocument}
        title="시험지 관리"
        right={
          selecting ? (
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-ink-soft">{selectedIds.size}개 선택됨</span>
              <button className="text-xs font-bold text-ink-soft hover:text-ink" onClick={exitSelectMode}>취소</button>
              <Button variant="secondary" size="sm" disabled={hideableSelectedIds.length === 0 || hiding || deleting || restoring} onClick={hideSelected}>
                {hiding ? '숨기는 중...' : `숨기기 (${hideableSelectedIds.length})`}
              </Button>
              {archivedSelectedIds.length > 0 && (
                <Button variant="secondary" size="sm" disabled={restoring || hiding || deleting} onClick={restoreSelected}>
                  {restoring ? '복원 중...' : `다시 보이기 (${archivedSelectedIds.length})`}
                </Button>
              )}
              <Button variant="danger" size="sm" disabled={selectedIds.size === 0 || deleting || hiding || restoring} onClick={deleteSelected}>
                {deleting ? '삭제 중...' : `삭제 (${selectedIds.size})`}
              </Button>
            </div>
          ) : exams.length > 0 ? (
            <button className="text-xs font-bold text-ink-soft hover:text-danger" onClick={() => setSelecting(true)}>
              선택 관리
            </button>
          ) : null
        }
      />
      <p className="mt-2 text-xs text-ink-soft">만들어 둔 시험지를 열어 문항·정답·성취기준을 확인하고 수정할 수 있습니다.</p>

      <div className="mt-5 flex flex-wrap items-center gap-2 text-xs">
        <select
          value={subjectFilter}
          onChange={(event) => setSubjectFilter(event.target.value)}
          className="rounded-lg border border-line bg-panel px-2 py-1.5 text-ink outline-none focus:border-accent"
        >
          <option value="all">전체 과목</option>
          {usedSubjects.map((subject) => (
            <option key={subject.subject_id} value={subject.subject_id}>{displaySubjectName(subject.subject_name)}</option>
          ))}
        </select>
        <label className="ml-auto flex items-center gap-1.5 font-bold text-ink-soft">
          <input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} />
          숨김 항목 보기
        </label>
      </div>

      <div className="mt-4 flex flex-col gap-2">
        {pagedExams.map((exam, index) => (
          <Card
            key={exam.id}
            className={`group animate-fade-in-up flex cursor-pointer items-center justify-between gap-3 transition-all ${
              selectedIds.has(exam.id) ? 'border-accent bg-accent-soft' : 'hover:-translate-y-0.5 hover:border-accent/60'
            }`}
            style={{ animationDelay: `${Math.min(index, 12) * 25}ms` }}
            onClick={() => selecting ? toggleSelect(exam.id) : exam.status !== 'archived' && navigate(`/exam-management/${exam.id}`)}
          >
            <div className="flex min-w-0 items-center gap-3">
              {selecting && (
                <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 text-[11px] font-bold ${
                  selectedIds.has(exam.id) ? 'border-accent bg-accent text-white' : 'border-line text-transparent'
                }`}>✓</span>
              )}
              <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p className="truncate text-sm font-bold text-ink">{exam.title}</p>
                <Badge tone={exam.status === 'draft' ? 'warn' : 'neutral'}>
                  {exam.status === 'draft' ? '작성 중' : exam.status === 'archived' ? '숨김' : '확정'}
                </Badge>
              </div>
              <p className="mt-0.5 text-xs text-ink-soft">
                {GRADE_LABEL[exam.grade_cluster] || exam.grade_cluster} · {exam.subject_id} · {Math.round(exam.time_limit_sec / 60)}분
              </p>
              {exam.memo && <p className="mt-1 truncate text-xs text-ink-soft">{exam.memo}</p>}
              </div>
            </div>
            {!selecting && (exam.status === 'archived' ? (
              <button className="shrink-0 text-xs font-bold text-accent" onClick={(event) => unhide(exam, event)}>다시 보이기</button>
            ) : (
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent-ink transition-colors duration-150 group-hover:bg-accent group-hover:text-white">
                <IconChevronRight className="h-4 w-4" />
              </span>
            ))}
          </Card>
        ))}
        {visibleExams.length === 0 && <p className="text-sm text-ink-soft">조건에 맞는 시험지가 없습니다.</p>}
      </div>
      <Pagination page={safePage} totalPages={totalPages} onChange={setPage} />
    </div>
  );
}
