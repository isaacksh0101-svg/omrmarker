import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api/client';
import type { Exam, ExamResultsData, QuestionBreakdown } from '../../types';
import { Card } from '../../components/Card';
import { Badge } from '../../components/Badge';
import { AccuracyRow } from '../../components/AccuracyRow';
import { StatCard, StatCardRow } from '../../components/StatCard';
import { downloadWorkbook } from '../../lib/exportXlsx';

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

// 리포트 표 안에서 자리를 너무 많이 차지하지 않도록 "2026. 9. 14. 오전 12:35:13" 대신
// "9/14 12:35"처럼 짧게 표시한다.
function formatSubmittedAt(iso: string) {
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${hh}:${min}`;
}

export function ExamResults() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [exam, setExam] = useState<Exam | null>(null);
  const [data, setData] = useState<ExamResultsData | null>(null);
  const [expandedQuestionId, setExpandedQuestionId] = useState<number | null>(null);
  const [breakdowns, setBreakdowns] = useState<Record<number, QuestionBreakdown>>({});
  const [loadingBreakdownId, setLoadingBreakdownId] = useState<number | null>(null);

  useEffect(() => {
    api.get<Exam>(`/exams/${id}`).then(setExam);
  }, [id]);

  // 학생이 응시 중일 때 교사가 이 화면을 계속 열어두고 지켜보는 경우가 많아서, 새로
  // 제출되는 대로 화면에 바로 반영되도록 주기적으로 다시 불러온다.
  useEffect(() => {
    let cancelled = false;
    function load() {
      api.get<ExamResultsData>(`/exams/${id}/results`).then((d) => {
        if (!cancelled) setData(d);
      });
    }
    load();
    const interval = setInterval(load, 4000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [id]);

  async function toggleQuestion(questionId: number) {
    if (expandedQuestionId === questionId) {
      setExpandedQuestionId(null);
      return;
    }
    setExpandedQuestionId(questionId);
    if (breakdowns[questionId]) return;
    setLoadingBreakdownId(questionId);
    try {
      const breakdown = await api.get<QuestionBreakdown>(`/exams/${id}/questions/${questionId}/breakdown`);
      setBreakdowns((prev) => ({ ...prev, [questionId]: breakdown }));
    } finally {
      setLoadingBreakdownId(null);
    }
  }

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

  function exportExcel() {
    downloadWorkbook(`${exam!.title}_결과.xlsx`, [
      {
        name: '학생별 점수',
        rows: data!.sessions.map((s) => ({
          번호: s.roll_number,
          이름: s.name ?? '',
          상태: STATUS_LABEL[s.status] ?? s.status,
          점수: s.score ?? '',
          만점: s.max_score ?? '',
          제출시각: s.submitted_at ? new Date(s.submitted_at).toLocaleString('ko-KR') : '',
          화면이탈횟수: s.warning_count,
          확인필요: s.isOutlier ? s.outlierReasons.join(', ') : '',
        })),
      },
      {
        name: '문항별 정답률',
        rows: data!.questionStats.map((q) => ({
          문항번호: q.order_index + 1,
          문제: q.prompt,
          정답수: q.correct_count,
          전체: q.answered_count,
          정답률: q.answered_count > 0 ? `${Math.round((q.correct_count / q.answered_count) * 100)}%` : '',
          평균소요시간: formatMs(q.avg_time_spent_ms),
        })),
      },
      {
        name: '성취기준별 정답률',
        rows: data!.standardsAccuracy.map((s) => ({
          코드: s.code,
          내용: s.statement,
          정답수: s.correct_count,
          전체: s.attempted_count,
          정답률: `${Math.round(s.accuracy * 100)}%`,
          평균풀이시간: formatMs(s.avg_time_spent_ms),
        })),
      },
    ]);
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <button className="text-xs font-bold text-ink-soft transition-colors duration-150 hover:text-accent" onClick={() => navigate(-1)}>
        ← 뒤로
      </button>
      <div className="animate-fade-in-up mt-3 flex items-center gap-2">
        <h1 className="text-2xl font-bold tracking-tight text-ink">{exam.title}</h1>
        <Badge tone="neutral">결과</Badge>
        <button className="ml-auto text-xs font-bold text-accent hover:underline" onClick={exportExcel}>
          엑셀로 다운로드
        </button>
      </div>

      <div className="animate-fade-in-up mt-7" style={{ animationDelay: '40ms' }}>
        <StatCardRow>
          <StatCard label="응시 인원" value={`${data.sessions.length}명`} />
          <StatCard label="제출 완료" value={`${submitted.length}명`} />
          <StatCard label="평균 정답률" value={`${avgScorePct}%`} />
          <StatCard label="문항당 평균 소요시간" value={formatMs(avgTimeMs)} />
        </StatCardRow>
      </div>

      {(data.slowestQuestions.length > 0 || data.lowestAccuracyQuestions.length > 0) && (
        <Card className="animate-fade-in-up mt-6" style={{ animationDelay: '80ms' }}>
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

      <Card className="animate-fade-in-up mt-4" style={{ animationDelay: '110ms' }}>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-ink">문항별 정답률</h2>
          <p className="text-xs text-ink-soft">문항을 누르면 학생별 소요시간을 볼 수 있어요.</p>
        </div>
        <div className="mt-2 divide-y divide-line">
          {data.questionStats.map((q) => {
            const breakdown = breakdowns[q.question_id];
            const expanded = expandedQuestionId === q.question_id;
            return (
              <div key={q.question_id}>
                <AccuracyRow
                  label={`${q.order_index + 1}번`}
                  sublabel={
                    q.prompt
                      ? `${q.prompt.slice(0, 40)}${q.prompt.length > 40 ? '…' : ''} · 평균 ${formatMs(q.avg_time_spent_ms)}`
                      : `평균 ${formatMs(q.avg_time_spent_ms)}`
                  }
                  correct={q.correct_count}
                  total={q.answered_count}
                  onClick={() => toggleQuestion(q.question_id)}
                />
                {expanded && (
                  <div className="animate-fade-in-up mb-2 rounded-xl bg-bg p-3">
                    {loadingBreakdownId === q.question_id ? (
                      <p className="text-xs text-ink-soft">불러오는 중...</p>
                    ) : !breakdown || breakdown.students.length === 0 ? (
                      <p className="text-xs text-ink-soft">아직 이 문항에 응답한 학생이 없습니다.</p>
                    ) : (
                      <div className="flex flex-col divide-y divide-line">
                        {breakdown.students.map((s) => (
                          <div key={s.roll_number} className="flex items-center gap-2 py-1.5 text-xs">
                            <span className="w-8 shrink-0 font-bold text-ink">{s.roll_number}</span>
                            <span className="w-16 shrink-0 truncate text-ink-soft">{s.name || '-'}</span>
                            <span
                              className={`flex-1 truncate ${
                                s.is_correct ? 'text-ink-soft' : 'font-bold text-danger'
                              }`}
                            >
                              {s.selected_choice_text ?? s.short_answer_text ?? '-'}
                            </span>
                            <span
                              className={`shrink-0 font-bold ${s.is_correct ? 'text-ink-soft' : 'text-danger'}`}
                            >
                              {formatMs(s.time_spent_ms)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      <Card className="animate-fade-in-up mt-4" style={{ animationDelay: '140ms' }}>
        <h2 className="text-sm font-bold text-ink">성취기준별 정답률 (이 시험)</h2>
        {data.standardsAccuracy.length === 0 ? (
          <p className="mt-2 text-sm text-ink-soft">
            제출된 응답 중 성취기준이 태깅된 문항이 없습니다. 문항에 성취기준을 태깅하면 여기에
            정답률이 집계됩니다.
          </p>
        ) : (
          <div className="mt-2 divide-y divide-line">
            {data.standardsAccuracy.map((s) => (
              <AccuracyRow
                key={s.code}
                label={`[${s.code}]`}
                sublabel={s.statement}
                extra={`평균 ${formatMs(s.avg_time_spent_ms)}`}
                correct={s.correct_count}
                total={s.attempted_count}
              />
            ))}
          </div>
        )}
      </Card>

      <Card className="animate-fade-in-up mt-4 overflow-hidden p-0" style={{ animationDelay: '170ms' }}>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs font-bold text-ink-soft">
              <th className="whitespace-nowrap px-3 py-2.5">번호</th>
              <th className="whitespace-nowrap px-3 py-2.5">이름</th>
              <th className="whitespace-nowrap px-3 py-2.5">상태</th>
              <th className="whitespace-nowrap px-3 py-2.5">점수</th>
              <th className="whitespace-nowrap px-3 py-2.5">제출시각</th>
              <th className="whitespace-nowrap px-3 py-2.5">확인 필요</th>
            </tr>
          </thead>
          <tbody>
            {data.sessions.map((s) => (
              <tr key={s.roll_number} className="border-b border-line last:border-0">
                <td className="whitespace-nowrap px-3 py-2.5 font-bold text-ink">{s.roll_number}</td>
                <td className="max-w-[7rem] truncate px-3 py-2.5 text-ink-soft">{s.name || '-'}</td>
                <td className="whitespace-nowrap px-3 py-2.5 text-ink-soft">{STATUS_LABEL[s.status] ?? s.status}</td>
                <td className="whitespace-nowrap px-3 py-2.5 text-ink-soft">
                  {s.status === 'submitted' ? `${s.score} / ${s.max_score}` : '-'}
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-ink-soft">
                  {s.submitted_at ? formatSubmittedAt(s.submitted_at) : '-'}
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex flex-wrap gap-1">
                    {s.isOutlier && <Badge tone="warn">{s.outlierReasons.join(', ')}</Badge>}
                    {s.warning_count > 0 && <Badge tone="danger">화면 이탈 {s.warning_count}회</Badge>}
                  </div>
                </td>
              </tr>
            ))}
            {data.sessions.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-4 text-center text-ink-soft">
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
