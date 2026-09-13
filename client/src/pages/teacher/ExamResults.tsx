import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api/client';
import type { Exam, ExamResultsData } from '../../types';
import { Card } from '../../components/Card';
import { Badge } from '../../components/Badge';
import { AccuracyRow } from '../../components/AccuracyRow';
import { StatCard, StatCardRow } from '../../components/StatCard';

const STATUS_LABEL: Record<string, string> = {
  joined: '참여함',
  in_progress: '응시 중',
  submitted: '제출 완료',
  force_submitted: '강제 제출',
  disqualified: '실격',
};

function formatMs(ms: number | null) {
  if (ms == null) return '-';
  return `${Math.round(ms / 1000)}초`;
}

export function ExamResults() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [exam, setExam] = useState<Exam | null>(null);
  const [data, setData] = useState<ExamResultsData | null>(null);

  useEffect(() => {
    api.get<Exam>(`/exams/${id}`).then(setExam);
    api.get<ExamResultsData>(`/exams/${id}/results`).then(setData);
  }, [id]);

  if (!exam || !data) return <div className="p-10 text-sm text-ink-soft">불러오는 중...</div>;

  const submitted = data.sessions.filter((s) => s.status === 'submitted');
  const avgScorePct =
    submitted.length > 0
      ? Math.round(
          (submitted.reduce((sum, s) => sum + (s.max_score ? (s.score ?? 0) / s.max_score : 0), 0) /
            submitted.length) *
            100,
        )
      : 0;
  const avgTimeMs = (() => {
    const withTime = data.questionStats.filter((q) => q.avg_time_spent_ms != null);
    if (withTime.length === 0) return null;
    return withTime.reduce((sum, q) => sum + (q.avg_time_spent_ms ?? 0), 0) / withTime.length;
  })();

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <button className="text-xs font-bold text-ink-soft hover:text-accent" onClick={() => navigate('/')}>
        ← 대시보드
      </button>
      <div className="mt-3 flex items-center gap-2">
        <h1 className="text-xl font-bold text-ink">{exam.title}</h1>
        <Badge tone="neutral">결과</Badge>
      </div>

      <div className="mt-6">
        <StatCardRow>
          <StatCard label="응시 인원" value={`${data.sessions.length}명`} />
          <StatCard label="제출 완료" value={`${submitted.length}명`} />
          <StatCard label="평균 정답률" value={`${avgScorePct}%`} />
          <StatCard label="문항당 평균 소요시간" value={formatMs(avgTimeMs)} />
        </StatCardRow>
      </div>

      {(data.slowestQuestions.length > 0 || data.lowestAccuracyQuestions.length > 0) && (
        <Card className="mt-6">
          <h2 className="text-sm font-bold text-ink">주목할 문항</h2>
          <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <p className="text-xs font-bold text-ink-soft">소요시간이 길었던 문항</p>
              <ul className="mt-1.5 flex flex-col gap-1">
                {data.slowestQuestions.map((q) => (
                  <li key={q.question_id} className="text-sm text-ink">
                    {q.order_index + 1}번 · 평균 {formatMs(q.avg_time_spent_ms)}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-xs font-bold text-ink-soft">정답률이 낮았던 문항</p>
              <ul className="mt-1.5 flex flex-col gap-1">
                {data.lowestAccuracyQuestions.map((q) => (
                  <li key={q.question_id} className="text-sm text-ink">
                    {q.order_index + 1}번 · {Math.round((q.correct_count / q.answered_count) * 100)}%
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Card>
      )}

      <Card className="mt-4">
        <h2 className="text-sm font-bold text-ink">문항별 정답률</h2>
        <div className="mt-2 divide-y divide-line">
          {data.questionStats.map((q) => (
            <AccuracyRow
              key={q.question_id}
              label={`${q.order_index + 1}번`}
              sublabel={
                q.prompt
                  ? `${q.prompt.slice(0, 40)}${q.prompt.length > 40 ? '…' : ''} · 평균 ${formatMs(q.avg_time_spent_ms)}`
                  : `평균 ${formatMs(q.avg_time_spent_ms)}`
              }
              correct={q.correct_count}
              total={q.answered_count}
            />
          ))}
        </div>
      </Card>

      <Card className="mt-4">
        <h2 className="text-sm font-bold text-ink">성취기준별 정답률 (이 시험)</h2>
        {data.standardsAccuracy.length === 0 ? (
          <p className="mt-2 text-sm text-ink-soft">아직 제출된 응답이 없습니다.</p>
        ) : (
          <div className="mt-2 divide-y divide-line">
            {data.standardsAccuracy.map((s) => (
              <AccuracyRow
                key={s.code}
                label={`[${s.code}]`}
                sublabel={s.statement}
                correct={s.correct_count}
                total={s.attempted_count}
              />
            ))}
          </div>
        )}
      </Card>

      <Card className="mt-4 p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs font-bold text-ink-soft">
              <th className="px-4 py-2.5">번호</th>
              <th className="px-4 py-2.5">이름</th>
              <th className="px-4 py-2.5">상태</th>
              <th className="px-4 py-2.5">점수</th>
              <th className="px-4 py-2.5">제출시각</th>
              <th className="px-4 py-2.5">확인 필요</th>
            </tr>
          </thead>
          <tbody>
            {data.sessions.map((s) => (
              <tr key={s.roll_number} className="border-b border-line last:border-0">
                <td className="px-4 py-2.5 font-bold text-ink">{s.roll_number}</td>
                <td className="px-4 py-2.5 text-ink-soft">{s.name || '-'}</td>
                <td className="px-4 py-2.5 text-ink-soft">{STATUS_LABEL[s.status] ?? s.status}</td>
                <td className="px-4 py-2.5 text-ink-soft">
                  {s.status === 'submitted' ? `${s.score} / ${s.max_score}` : '-'}
                </td>
                <td className="px-4 py-2.5 text-ink-soft">
                  {s.submitted_at ? new Date(s.submitted_at).toLocaleString('ko-KR') : '-'}
                </td>
                <td className="px-4 py-2.5">
                  {s.isOutlier && <Badge tone="warn">{s.outlierReasons.join(', ')}</Badge>}
                </td>
              </tr>
            ))}
            {data.sessions.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-4 text-center text-ink-soft">
                  아직 참여한 학생이 없습니다.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
