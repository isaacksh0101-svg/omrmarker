import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import type { Exam } from '../../types';
import { Card } from '../../components/Card';
import { Badge } from '../../components/Badge';

const GRADE_LABEL: Record<string, string> = {
  elem_1_2: '1~2학년군',
  elem_3_4: '3~4학년군',
  elem_5_6: '5~6학년군',
};

export function ExamReportPicker() {
  const navigate = useNavigate();
  const [exams, setExams] = useState<Exam[]>([]);

  useEffect(() => {
    api.get<Exam[]>('/exams').then(setExams);
  }, []);

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="text-xl font-bold text-ink">시험별 리포트</h1>

      <div className="mt-6 flex flex-col gap-2">
        {exams.length === 0 && <p className="text-sm text-ink-soft">아직 만든 시험이 없습니다.</p>}
        {exams.map((exam) => {
          const finalized = exam.status === 'finalized';
          return (
            <Card
              key={exam.id}
              className={`flex items-center justify-between ${
                finalized ? 'cursor-pointer hover:border-accent' : 'opacity-60'
              }`}
              onClick={() => finalized && navigate(`/exams/${exam.id}/results`)}
            >
              <div>
                <p className="text-sm font-bold text-ink">{exam.title}</p>
                <p className="mt-0.5 text-xs text-ink-soft">
                  {GRADE_LABEL[exam.grade_cluster] || exam.grade_cluster} · {exam.subject_id}
                </p>
              </div>
              <Badge tone={finalized ? 'good' : 'neutral'}>
                {finalized ? '결과 보기' : '확정 후 리포트를 볼 수 있습니다'}
              </Badge>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
