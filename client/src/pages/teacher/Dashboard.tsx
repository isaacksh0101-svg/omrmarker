import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../../api/client';
import type { Exam, Subject } from '../../types';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { PageHeader } from '../../components/PageHeader';
import { IconDashboard } from '../../components/icons';
import { displaySubjectName } from '../../lib/subjectName';

const GRADE_LABEL: Record<string, string> = {
  elem_1_2: '1~2학년군',
  elem_3_4: '3~4학년군',
  elem_5_6: '5~6학년군',
};

export function Dashboard() {
  const navigate = useNavigate();
  const [exams, setExams] = useState<Exam[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [subjectFilter, setSubjectFilter] = useState<string>('all');
  const [creating, setCreating] = useState(false);
  // 선택 삭제 모드 - 켜져 있는 동안엔 카드를 눌러도 시험으로 안 들어가고 선택만 토글된다.
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [form, setForm] = useState({
    title: '',
    subject_id: '',
    grade_cluster: 'elem_5_6',
    time_limit_minutes: 20,
    mode: 'online' as 'online' | 'paper_marking',
  });

  useEffect(() => {
    api.get<Exam[]>('/exams').then(setExams);
    api.get<Subject[]>('/standards/subjects').then((list) => {
      setSubjects(list);
      setForm((f) => ({ ...f, subject_id: f.subject_id || list[0]?.subject_id || '' }));
    });
  }, []);

  async function createExam() {
    if (!form.title.trim()) return;
    setCreating(true);
    try {
      const exam = await api.post<Exam>('/exams', {
        title: form.title.trim(),
        subject_id: form.subject_id,
        grade_cluster: form.grade_cluster,
        time_limit_sec: Math.max(1, form.time_limit_minutes) * 60,
        mode: form.mode,
      });
      navigate(`/exams/${exam.id}`);
    } finally {
      setCreating(false);
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
    if (!confirm(`선택한 시험지 ${ids.length}개를 삭제할까요?\n목록에서 사라지지만, 이미 응시한 결과는 계속 보관되어 시험별 리포트에서 확인할 수 있습니다.`)) {
      return;
    }
    setBulkDeleting(true);
    try {
      await Promise.all(ids.map((id) => api.delete(`/exams/${id}`)));
      setExams((prev) => prev.filter((e2) => !selectedIds.has(e2.id)));
      exitSelectMode();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : '삭제 중 오류가 발생했습니다.');
    } finally {
      setBulkDeleting(false);
    }
  }

  // 만들기 화면에는 아직 작성 중인 시험만 둔다 - 확정된 뒤에는 "시험지 관리" 화면에서
  // 찾아 쓴다. 그래야 오래 쓰다 보면 쌓이는 지난 시험지들이 여기서 어지럽히지 않는다.
  const draftExams = exams.filter((exam) => exam.status === 'draft');
  const visibleExams = draftExams.filter(
    (exam) => subjectFilter === 'all' || exam.subject_id === subjectFilter,
  );

  // 시험지가 하나도 없는 과목까지 필터에 다 늘어놓으면 정작 쓸 수 있는 과목은 적은데도
  // 목록이 길어져 찾기 불편하다 - 실제로 시험이 있는 과목만 골라서 보여준다.
  const activeSubjectIds = new Set(draftExams.map((exam) => exam.subject_id));
  const usedSubjects = subjects.filter((s) => activeSubjectIds.has(s.subject_id));

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <PageHeader icon={IconDashboard} title="시험지 만들기" />

      <Card className="animate-fade-in-up mt-7">
        <h2 className="text-sm font-bold text-ink">새 시험 만들기</h2>

        <div className="mt-3 flex flex-col gap-1">
          <span className="text-xs font-bold text-ink-soft">응시 방식</span>
          <div className="grid grid-cols-2 gap-2">
            <button
              className={`rounded-2xl border px-3.5 py-2.5 text-left text-sm transition-all duration-200 ${
                form.mode === 'online'
                  ? 'border-accent bg-accent-soft text-accent-ink'
                  : 'border-line bg-bg text-ink-soft hover:border-accent/40'
              }`}
              onClick={() => setForm({ ...form, mode: 'online' })}
            >
              <p className="font-bold">온라인 응시</p>
              <p className="mt-0.5 text-xs">화면에서 문제를 읽고 풉니다</p>
            </button>
            <button
              className={`rounded-2xl border px-3.5 py-2.5 text-left text-sm transition-all duration-200 ${
                form.mode === 'paper_marking'
                  ? 'border-accent bg-accent-soft text-accent-ink'
                  : 'border-line bg-bg text-ink-soft hover:border-accent/40'
              }`}
              onClick={() => setForm({ ...form, mode: 'paper_marking' })}
            >
              <p className="font-bold">종이 시험지 + 마킹만</p>
              <p className="mt-0.5 text-xs">종이로 풀고 답만 프로그램에 입력</p>
            </button>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 sm:col-span-2">
            <span className="text-xs font-bold text-ink-soft">시험 제목</span>
            <input
              className="rounded-xl border border-line bg-bg px-3 py-2 text-sm text-ink outline-none focus:border-accent"
              placeholder="예: 5학년 2학기 수학 단원평가"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-bold text-ink-soft">교과</span>
            <select
              className="rounded-xl border border-line bg-bg px-3 py-2 text-sm text-ink outline-none focus:border-accent"
              value={form.subject_id}
              onChange={(e) => setForm({ ...form, subject_id: e.target.value })}
            >
              {subjects.map((s) => (
                <option key={s.subject_id} value={s.subject_id}>
                  {displaySubjectName(s.subject_name)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-bold text-ink-soft">학년군</span>
            <select
              className="rounded-xl border border-line bg-bg px-3 py-2 text-sm text-ink outline-none focus:border-accent"
              value={form.grade_cluster}
              onChange={(e) => setForm({ ...form, grade_cluster: e.target.value })}
            >
              {Object.entries(GRADE_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-bold text-ink-soft">제한시간(분)</span>
            <input
              type="number"
              min={1}
              className="rounded-xl border border-line bg-bg px-3 py-2 text-sm text-ink outline-none focus:border-accent"
              value={form.time_limit_minutes}
              onChange={(e) => setForm({ ...form, time_limit_minutes: Number(e.target.value) })}
            />
          </label>
        </div>
        <Button className="mt-4" disabled={!form.title.trim() || creating} onClick={createExam}>
          만들기
        </Button>
      </Card>

      <div className="animate-fade-in-up mt-9" style={{ animationDelay: '60ms' }}>
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-bold text-ink">작성 중인 시험</h2>
          {!selectMode ? (
            draftExams.length > 0 && (
              <button
                className="text-xs font-bold text-ink-soft hover:text-ink"
                onClick={() => setSelectMode(true)}
              >
                선택 삭제
              </button>
            )
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-ink-soft">{selectedIds.size}개 선택됨</span>
              <button className="text-xs font-bold text-ink-soft hover:text-ink" onClick={exitSelectMode}>
                취소
              </button>
              <Button
                variant="danger"
                size="sm"
                disabled={selectedIds.size === 0 || bulkDeleting}
                onClick={bulkDelete}
              >
                {bulkDeleting ? '삭제 중...' : `삭제 (${selectedIds.size})`}
              </Button>
            </div>
          )}
        </div>

        {usedSubjects.length > 1 && (
          <select
            className="mt-3 rounded-xl border border-line bg-bg px-3 py-1.5 text-xs font-bold text-ink outline-none focus:border-accent"
            value={subjectFilter}
            onChange={(e) => setSubjectFilter(e.target.value)}
          >
            <option value="all">전체 교과</option>
            {usedSubjects.map((s) => (
              <option key={s.subject_id} value={s.subject_id}>
                {displaySubjectName(s.subject_name)}
              </option>
            ))}
          </select>
        )}

        {draftExams.length === 0 ? (
          <p className="mt-3 text-sm text-ink-soft">아직 작성 중인 시험이 없습니다.</p>
        ) : visibleExams.length === 0 ? (
          <p className="mt-3 text-sm text-ink-soft">이 교과로 만든 시험이 없습니다.</p>
        ) : (
          <div className="mt-3 flex flex-col gap-2">
            {visibleExams.map((exam, i) => {
              const selected = selectedIds.has(exam.id);
              return (
                <Card
                  key={exam.id}
                  className={`animate-fade-in-up flex cursor-pointer items-center justify-between transition-all duration-200 ${
                    selectMode
                      ? selected
                        ? 'border-accent bg-accent-soft'
                        : 'hover:border-accent/40'
                      : 'hover:-translate-y-0.5 hover:border-accent/60 hover:shadow-[0_4px_12px_rgba(16,24,40,0.08)]'
                  }`}
                  style={{ animationDelay: `${Math.min(i, 12) * 30}ms` }}
                  onClick={() => (selectMode ? toggleSelect(exam.id) : navigate(`/exams/${exam.id}`))}
                >
                  <div className="flex items-center gap-3">
                    {selectMode && (
                      <span
                        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 text-[11px] font-bold transition-colors duration-150 ${
                          selected ? 'border-accent bg-accent text-white' : 'border-line text-transparent'
                        }`}
                      >
                        ✓
                      </span>
                    )}
                    <div>
                      <p className="text-sm font-bold text-ink">{exam.title}</p>
                      <p className="mt-0.5 text-xs text-ink-soft">
                        {GRADE_LABEL[exam.grade_cluster] || exam.grade_cluster} · {exam.subject_id} ·{' '}
                        {Math.round(exam.time_limit_sec / 60)}분 ·{' '}
                        {exam.mode === 'paper_marking' ? '종이+마킹' : '온라인'}
                      </p>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
