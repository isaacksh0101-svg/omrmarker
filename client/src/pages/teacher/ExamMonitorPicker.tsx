import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import type { Exam } from '../../types';
import { Card } from '../../components/Card';
import { Badge } from '../../components/Badge';
import { PageHeader } from '../../components/PageHeader';
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
    const load = () => api.get<Exam[]>('/exams').then(setExams).finally(() => setLoaded(true));
    load();
    // 목록에 머무는 동안에도 감독중 표시가 최신 상태를 보여주도록 주기적으로 새로고침한다.
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, []);

  const monitorable = exams.filter((e) => e.status === 'finalized');

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <PageHeader icon={IconMonitor} title="시험 감독" />

      {loaded && monitorable.length > 0 && (
        <p className="animate-fade-in-up mt-7 text-sm font-bold text-ink-soft">감독할 시험지를 선택하세요.</p>
      )}

      <div className={`flex flex-col gap-2 ${loaded && monitorable.length > 0 ? 'mt-2' : 'mt-7'}`}>
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
              <div className="flex items-center gap-1.5">
                <span
                  className={`h-2 w-2 shrink-0 rounded-full transition-colors duration-300 ${
                    exam.started_at && !exam.ends_at ? 'bg-good' : 'bg-line'
                  }`}
                  title={exam.started_at && !exam.ends_at ? '감독중' : '감독중 아님'}
                />
                <p className="text-sm font-bold text-ink">{exam.title}</p>
              </div>
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
