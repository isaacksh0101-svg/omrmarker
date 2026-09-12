import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import type { Exam, Subject } from '../../types';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { Badge } from '../../components/Badge';

const GRADE_LABEL: Record<string, string> = {
  elem_1_2: '1~2학년군',
  elem_3_4: '3~4학년군',
  elem_5_6: '5~6학년군',
};

const STATUS_BADGE: Record<Exam['status'], { label: string; tone: 'neutral' | 'good' }> = {
  draft: { label: '작성 중', tone: 'neutral' },
  finalized: { label: '확정됨', tone: 'good' },
  archived: { label: '보관됨', tone: 'neutral' },
};

export function Dashboard() {
  const navigate = useNavigate();
  const [exams, setExams] = useState<Exam[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [creating, setCreating] = useState(false);
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

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-xl font-bold text-ink">OMR프로그램</h1>
      <p className="mt-1 text-sm text-ink-soft">시험을 만들고, 채점하고, 성취기준별로 분석합니다.</p>

      <Card className="mt-6">
        <h2 className="text-sm font-bold text-ink">새 시험 만들기</h2>

        <div className="mt-3 flex flex-col gap-1">
          <span className="text-xs font-bold text-ink-soft">응시 방식</span>
          <div className="grid grid-cols-2 gap-2">
            <button
              className={`rounded-xl border px-3 py-2 text-left text-sm ${
                form.mode === 'online'
                  ? 'border-accent bg-accent-soft text-accent-ink'
                  : 'border-line bg-bg text-ink-soft'
              }`}
              onClick={() => setForm({ ...form, mode: 'online' })}
            >
              <p className="font-bold">온라인 응시</p>
              <p className="mt-0.5 text-xs">화면에서 문제를 읽고 풉니다</p>
            </button>
            <button
              className={`rounded-xl border px-3 py-2 text-left text-sm ${
                form.mode === 'paper_marking'
                  ? 'border-accent bg-accent-soft text-accent-ink'
                  : 'border-line bg-bg text-ink-soft'
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
                  {s.subject_name}
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

      <div className="mt-8">
        <h2 className="text-sm font-bold text-ink">시험 목록</h2>
        {exams.length === 0 ? (
          <p className="mt-3 text-sm text-ink-soft">아직 만든 시험이 없습니다.</p>
        ) : (
          <div className="mt-3 flex flex-col gap-2">
            {exams.map((exam) => (
              <Card
                key={exam.id}
                className="flex cursor-pointer items-center justify-between hover:border-accent"
                onClick={() => navigate(`/exams/${exam.id}`)}
              >
                <div>
                  <p className="text-sm font-bold text-ink">{exam.title}</p>
                  <p className="mt-0.5 text-xs text-ink-soft">
                    {GRADE_LABEL[exam.grade_cluster] || exam.grade_cluster} · {exam.subject_id} ·{' '}
                    {Math.round(exam.time_limit_sec / 60)}분 ·{' '}
                    {exam.mode === 'paper_marking' ? '종이+마킹' : '온라인'}
                  </p>
                </div>
                <Badge tone={STATUS_BADGE[exam.status].tone}>{STATUS_BADGE[exam.status].label}</Badge>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
