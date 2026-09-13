import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import type { Exam } from '../../types';
import { Card } from '../../components/Card';
import { Badge } from '../../components/Badge';
import { IconMonitor } from '../../components/icons';

const GRADE_LABEL: Record<string, string> = {
  elem_1_2: '1~2학년군',
  elem_3_4: '3~4학년군',
  elem_5_6: '5~6학년군',
};

export function ExamMonitorPicker() {
  const navigate = useNavigate();
  const [exams, setExams] = useState<Exam[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    api
      .get<Exam[]>('/exams')
      .then(setExams)
      .finally(() => setLoaded(true));
  }, []);

  const monitorable = exams.filter((e) => e.status === 'finalized');

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <div className="animate-fade-in-up flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-accent-soft text-accent-ink">
          <IconMonitor className="h-5 w-5" />
        </span>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink">시험 감독</h1>
          <p className="mt-0.5 text-xs text-ink-soft">감독할 시험을 선택하면 학생들의 실시간 응시 현황을 볼 수 있어요.</p>
        </div>
      </div>

      <div className="mt-7 flex flex-col gap-2">
        {loaded && monitorable.length === 0 && (
          <Card className="animate-fade-in-up text-center text-sm text-ink-soft">
            확정된 시험이 없습니다. 시험을 확정하면 여기서 감독할 수 있어요.
          </Card>
        )}
        {monitorable.map((exam, i) => (
          <Card
            key={exam.id}
            className="animate-fade-in-up flex cursor-pointer items-center justify-between transition-all duration-200 hover:-translate-y-0.5 hover:border-accent hover:shadow-md"
            style={{ animationDelay: `${Math.min(i, 8) * 35}ms` }}
            onClick={() => navigate(`/exam-monitor/${exam.id}`)}
          >
            <div>
              <p className="text-sm font-bold text-ink">{exam.title}</p>
              <p className="mt-0.5 text-xs text-ink-soft">
                {GRADE_LABEL[exam.grade_cluster] || exam.grade_cluster} · {exam.subject_id} ·{' '}
                {Math.round(exam.time_limit_sec / 60)}분
              </p>
            </div>
            <Badge tone="good">감독하기</Badge>
          </Card>
        ))}
      </div>
    </div>
  );
}
