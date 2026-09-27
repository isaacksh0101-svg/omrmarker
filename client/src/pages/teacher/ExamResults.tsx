import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api/client';
import type { Exam, ExamResultsData, QuestionBreakdown, QuestionStat } from '../../types';
import { Card } from '../../components/Card';
import { Badge } from '../../components/Badge';
import { AccuracyRow } from '../../components/AccuracyRow';
import { StatCard, StatCardRow } from '../../components/StatCard';
import { Pagination } from '../../components/Pagination';
import { IconChevronRight } from '../../components/icons';
import { downloadWorkbook } from '../../lib/exportXlsx';

// 서버(assessmentInsights.js)의 MIN_SAMPLE_SIZE와 맞춘 값 - 이 밑으로는 이상치/변별도
// 계산 자체를 서버에서 안 하므로, 화면에서도 왜 지표가 비어 보이는지 미리 안내한다.
const MIN_SAMPLE_SIZE = 8;
// 시험 문항은 보통 10문항 단위로 익숙해서(10, 20, 30...) 다른 목록의 8개 대신 10개로 끊는다.
const QUESTION_PAGE_SIZE = 10;
// StandardsReport.tsx와 같은 기준 - 성취기준 카드는 설명 문장이 길어 4개가 한 화면에 맞다.
const STANDARDS_PAGE_SIZE = 4;
// 한 반이 보통 20~25명이라 대부분은 1페이지에 다 들어가고, 그보다 큰 반만 2페이지로 넘어간다.
const STUDENT_PAGE_SIZE = 20;

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

// 배지 문구는 짧게 유지하고, 판단 근거가 된 실제 수치는 마우스를 올렸을 때만 보여준다.
function insightTooltip(q: QuestionStat, code: string): string | undefined {
  const accuracyPct = q.answered_count > 0 ? Math.round((q.correct_count / q.answered_count) * 100) : 0;
  switch (code) {
    case 'low_discrimination':
      return q.discrimination != null
        ? `점수가 높은 학생과 낮은 학생의 정답 차이가 크지 않습니다(변별도 ${q.discrimination.toFixed(2)}). 문항 난이도나 정답 설정을 확인해보세요.`
        : undefined;
    case 'difficult_slow':
    case 'fast_wrong':
    case 'accurate_slow':
      return `정답률 ${accuracyPct}% · 평균 ${formatMs(q.avg_time_spent_ms)}`;
    case 'time_variable':
      return q.time_iqr_ms != null ? `학생 간 소요시간 편차(IQR) ${formatMs(q.time_iqr_ms)}` : undefined;
    default:
      return undefined;
  }
}

function insightBadges(q: QuestionStat) {
  return q.insight_codes.map((code, i) => ({ text: q.insight_reasons[i], title: insightTooltip(q, code) }));
}

// 무거운 카드 제목을 눌러 접었다 펼 수 있게 하는 공통 헤더 - 오른쪽에 필터 같은 컨트롤을
// 따로 둘 수 있도록, 제목 영역만 버튼으로 감싼다(전체 헤더를 버튼으로 감싸면 그 컨트롤들의
// 클릭이 같이 접기/펼치기를 발동시켜 버린다).
function SectionHeader({
  title,
  description,
  open,
  onToggle,
  right,
}: {
  title: string;
  description?: string;
  open: boolean;
  onToggle: () => void;
  right?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <button type="button" className="flex min-w-0 items-center gap-2 text-left" onClick={onToggle}>
        <IconChevronRight className={`h-4 w-4 shrink-0 text-ink-soft transition-transform duration-150 ${open ? 'rotate-90' : ''}`} />
        <div className="min-w-0">
          <h2 className="text-sm font-bold text-ink">{title}</h2>
          {description && <p className="mt-0.5 text-xs text-ink-soft">{description}</p>}
        </div>
      </button>
      {right}
    </div>
  );
}

interface ReviewDetail {
  assignment: { status: 'assigned' | 'in_progress' | 'completed'; completed_at: string | null };
  questions: Array<{
    question_id: number;
    order_index: number;
    original_choice_text: string | null;
    original_short_answer: string | null;
    review_choice_text: string | null;
    review_short_answer: string | null;
    review_is_correct: number | null;
    review_attempts: number | null;
  }>;
}

export function ExamResults() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [exam, setExam] = useState<Exam | null>(null);
  const [data, setData] = useState<ExamResultsData | null>(null);
  const [expandedQuestionId, setExpandedQuestionId] = useState<number | null>(null);
  const [breakdowns, setBreakdowns] = useState<Record<number, QuestionBreakdown>>({});
  const [loadingBreakdownId, setLoadingBreakdownId] = useState<number | null>(null);
  const [questionSort, setQuestionSort] = useState<'number' | 'accuracy' | 'time' | 'discrimination'>('number');
  const [notableOnly, setNotableOnly] = useState(false);
  const [questionPage, setQuestionPage] = useState(1);
  const [answerFilter, setAnswerFilter] = useState<'all' | 'correct' | 'wrong'>('all');
  const [choiceFilter, setChoiceFilter] = useState<number | null>(null);
  const [studentFilter, setStudentFilter] = useState<'all' | 'attention' | 'unfinished' | 'forced'>('all');
  const [studentPage, setStudentPage] = useState(1);
  const [standardsPage, setStandardsPage] = useState(1);
  const [reviewDetail, setReviewDetail] = useState<{ rollNumber: number; data: ReviewDetail } | null>(null);
  // 정보량이 많은 화면이라 무거운 카드 3개는 접었다 펼 수 있게 한다 - 가장 자주 보는
  // "문항 분석"·"학생 결과"는 기본으로 펼쳐두고, 성취기준 태깅이 없으면 비어 있는 경우가
  // 많은 "성취기준별 정답률"은 기본으로 접어둔다.
  const [showQuestions, setShowQuestions] = useState(true);
  const [showStandards, setShowStandards] = useState(false);
  const [showStudents, setShowStudents] = useState(true);

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

  // 시험 진행 중에도 펼쳐 둔 문항의 학생 목록이 오래된 상태로 남지 않도록 메인 결과와
  // 같은 주기로 갱신한다. 닫힌 문항은 호출하지 않아 불필요한 요청은 만들지 않는다.
  useEffect(() => {
    if (expandedQuestionId == null) return;
    let cancelled = false;
    const refresh = () => {
      api.get<QuestionBreakdown>(`/exams/${id}/questions/${expandedQuestionId}/breakdown`).then((breakdown) => {
        if (!cancelled) setBreakdowns((prev) => ({ ...prev, [expandedQuestionId]: breakdown }));
      });
    };
    const interval = window.setInterval(refresh, 4000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [id, expandedQuestionId]);

  async function loadBreakdown(questionId: number) {
    if (breakdowns[questionId]) return;
    setLoadingBreakdownId(questionId);
    try {
      const breakdown = await api.get<QuestionBreakdown>(`/exams/${id}/questions/${questionId}/breakdown`);
      setBreakdowns((prev) => ({ ...prev, [questionId]: breakdown }));
    } finally {
      setLoadingBreakdownId(null);
    }
  }

  async function openQuestion(questionId: number, scroll = false) {
    setExpandedQuestionId(questionId);
    setAnswerFilter('all');
    setChoiceFilter(null);
    if (scroll) {
      // "주목할 문항"에서 눌러 들어올 때는 "문항 분석" 카드가 접혀 있을 수도, 그 문항이
      // 지금 정렬/필터 기준으로 다른 페이지에 있을 수도 있다 - 둘 다 미리 맞춰둬야 아래
      // scrollIntoView로 찾는 요소가 실제로 화면에 그려져 있다.
      setShowQuestions(true);
      const targetIndex = visibleQuestions.findIndex((q) => q.question_id === questionId);
      if (targetIndex >= 0) setQuestionPage(Math.floor(targetIndex / QUESTION_PAGE_SIZE) + 1);
    }
    await loadBreakdown(questionId);
    if (scroll) {
      window.setTimeout(() => {
        document.getElementById(`question-analysis-${questionId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 0);
    }
  }

  useEffect(() => setQuestionPage(1), [notableOnly, questionSort]);
  useEffect(() => setStudentPage(1), [studentFilter]);

  async function toggleQuestion(questionId: number) {
    if (expandedQuestionId === questionId) {
      setExpandedQuestionId(null);
      return;
    }
    await openQuestion(questionId);
  }

  if (!exam || !data) return <div className="p-10 text-sm text-ink-soft">불러오는 중...</div>;

  const submitted = data.sessions.filter((s) => s.status === 'submitted');
  const forced = data.sessions.filter((s) => s.status === 'force_submitted');
  const completedCount = submitted.length + forced.length;
  const hasActiveSessions = data.sessions.some((s) => s.status === 'joined' || s.status === 'in_progress');
  const avgScorePct =
    submitted.length > 0
      ? Math.round(
          (submitted.reduce((sum, s) => sum + (s.max_score ? (s.score ?? 0) / s.max_score : 0), 0) /
            submitted.length) *
            100,
        )
      : 0;
  const notableQuestions = data.questionStats.filter((q) => q.insight_reasons.length > 0);
  const medianQuestionTimeMs = (() => {
    const values = data.questionStats
      .map((q) => q.median_time_spent_ms)
      .filter((value): value is number => value != null)
      .sort((a, b) => a - b);
    if (values.length === 0) return null;
    const middle = Math.floor(values.length / 2);
    return values.length % 2 === 0 ? (values[middle - 1] + values[middle]) / 2 : values[middle];
  })();
  const visibleQuestions = data.questionStats
    .filter((q) => !notableOnly || q.insight_reasons.length > 0)
    .sort((a, b) => {
      if (questionSort === 'accuracy') {
        const aAccuracy = a.answered_count > 0 ? a.correct_count / a.answered_count : 1;
        const bAccuracy = b.answered_count > 0 ? b.correct_count / b.answered_count : 1;
        return aAccuracy - bAccuracy || a.order_index - b.order_index;
      }
      if (questionSort === 'time') {
        return (b.median_time_spent_ms ?? -1) - (a.median_time_spent_ms ?? -1) || a.order_index - b.order_index;
      }
      if (questionSort === 'discrimination') {
        return (a.discrimination ?? Number.POSITIVE_INFINITY) - (b.discrimination ?? Number.POSITIVE_INFINITY)
          || a.order_index - b.order_index;
      }
      return a.order_index - b.order_index;
    });
  const questionTotalPages = Math.ceil(visibleQuestions.length / QUESTION_PAGE_SIZE);
  const safeQuestionPage = Math.min(questionPage, Math.max(1, questionTotalPages));
  const pagedQuestions = visibleQuestions.slice(
    (safeQuestionPage - 1) * QUESTION_PAGE_SIZE,
    safeQuestionPage * QUESTION_PAGE_SIZE,
  );
  const visibleSessions = data.sessions.filter((session) => {
    if (studentFilter === 'attention') return session.isOutlier;
    if (studentFilter === 'unfinished') return session.status === 'joined' || session.status === 'in_progress';
    if (studentFilter === 'forced') return session.status === 'force_submitted';
    return true;
  });
  const studentTotalPages = Math.ceil(visibleSessions.length / STUDENT_PAGE_SIZE);
  const safeStudentPage = Math.min(studentPage, Math.max(1, studentTotalPages));
  const pagedSessions = visibleSessions.slice(
    (safeStudentPage - 1) * STUDENT_PAGE_SIZE,
    safeStudentPage * STUDENT_PAGE_SIZE,
  );
  const standardsTotalPages = Math.ceil(data.standardsAccuracy.length / STANDARDS_PAGE_SIZE);
  const safeStandardsPage = Math.min(standardsPage, Math.max(1, standardsTotalPages));
  const pagedStandardsAccuracy = data.standardsAccuracy.slice(
    (safeStandardsPage - 1) * STANDARDS_PAGE_SIZE,
    safeStandardsPage * STANDARDS_PAGE_SIZE,
  );

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
          중앙소요시간: formatMs(q.median_time_spent_ms),
          변별도: q.discrimination?.toFixed(2) ?? '',
          확인필요: q.insight_reasons.join(', '),
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

  async function openReviewDetail(sessionId: number, rollNumber: number) {
    try {
      const detail = await api.get<ReviewDetail>(`/exams/${id}/sessions/${sessionId}/review-assignment`);
      setReviewDetail({ rollNumber, data: detail });
    } catch (error) {
      alert(error instanceof Error ? error.message : '재풀이 결과를 불러오지 못했습니다.');
    }
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
          <StatCard label="시험 종료" value={`${completedCount}/${data.sessions.length}명`} />
          <StatCard label="평균 정답률" value={`${avgScorePct}%`} />
          <StatCard label="문항 소요시간 중앙값" value={formatMs(medianQuestionTimeMs)} />
        </StatCardRow>
      </div>

      {(hasActiveSessions || forced.length > 0 || (submitted.length > 0 && submitted.length < MIN_SAMPLE_SIZE)) && (
        <div className="animate-fade-in-up mt-3 flex flex-wrap items-center gap-1.5">
          {hasActiveSessions && (
            <Badge tone="good" title="추가로 제출되는 대로 아래 수치가 계속 바뀝니다.">
              진행 중 · 잠정값
            </Badge>
          )}
          {!hasActiveSessions && forced.length > 0 && (
            <Badge tone="neutral" title="중단된 시점 때문에 총점이 왜곡될 수 있어 문항 통계·이상치 분석 기준에서 뺐습니다.">
              강제 제출 {forced.length}명 제외
            </Badge>
          )}
          {submitted.length > 0 && submitted.length < MIN_SAMPLE_SIZE && (
            <Badge
              tone="warn"
              title="표본이 적으면 한두 명의 값에 통계가 쉽게 흔들려서, 변별도·이상치 계산 자체를 생략했습니다. 아래 정답률·소요시간도 참고용으로만 봐주세요."
            >
              표본 {submitted.length}명 · 변별도·이상치 생략
            </Badge>
          )}
        </div>
      )}

      {notableQuestions.length > 0 && (
        <Card className="animate-fade-in-up mt-6" style={{ animationDelay: '80ms' }}>
          <h2 className="text-sm font-bold text-ink">주목할 문항</h2>
          <div className="mt-2 divide-y divide-line">
            {notableQuestions.map((q) => (
              <button
                key={q.question_id}
                type="button"
                className="flex w-full flex-wrap items-center gap-2 py-2 text-left text-sm transition-colors hover:text-accent"
                onClick={() => openQuestion(q.question_id, true)}
              >
                <span className="font-bold text-ink">{q.order_index + 1}번</span>
                <span className="text-xs text-ink-soft">
                  평균 {formatMs(q.avg_time_spent_ms)} · 정답률{' '}
                  {q.answered_count > 0 ? Math.round((q.correct_count / q.answered_count) * 100) : 0}%
                </span>
                <div className="ml-auto flex flex-wrap justify-end gap-1">
                  {insightBadges(q).map((b) => (
                    <Badge key={b.text} tone="warn" title={b.title}>{b.text}</Badge>
                  ))}
                </div>
              </button>
            ))}
          </div>
        </Card>
      )}

      <Card className="animate-fade-in-up mt-4" style={{ animationDelay: '110ms' }}>
        <SectionHeader
          title="문항 분석"
          description="문항을 누르면 선택지 분포와 학생별 응답을 볼 수 있어요."
          open={showQuestions}
          onToggle={() => setShowQuestions((v) => !v)}
          right={
            <div className="flex flex-wrap items-center justify-end gap-2 text-xs">
              <label className="flex items-center gap-1 font-bold text-ink-soft">
                <input type="checkbox" checked={notableOnly} onChange={(e) => setNotableOnly(e.target.checked)} />
                확인 필요만
              </label>
              <select
                value={questionSort}
                onChange={(e) => setQuestionSort(e.target.value as typeof questionSort)}
                className="rounded-lg border border-line bg-panel px-2 py-1.5 text-ink outline-none focus:border-accent"
              >
                <option value="number">문항 번호순</option>
                <option value="accuracy">정답률 낮은 순</option>
                <option value="time">중앙 시간 긴 순</option>
                <option value="discrimination">변별도 낮은 순</option>
              </select>
            </div>
          }
        />
        {showQuestions && (
        <>
        <div className="mt-2 divide-y divide-line">
          {pagedQuestions.map((q) => {
            const breakdown = breakdowns[q.question_id];
            const expanded = expandedQuestionId === q.question_id;
            const filteredStudents = (breakdown?.students ?? []).filter((student) => {
              if (answerFilter === 'correct' && !student.is_correct) return false;
              if (answerFilter === 'wrong' && student.is_correct) return false;
              if (choiceFilter != null && student.selected_choice_id !== choiceFilter) return false;
              return true;
            });
            return (
              <div key={q.question_id} id={`question-analysis-${q.question_id}`}>
                <AccuracyRow
                  label={`${q.order_index + 1}번`}
                  sublabel={
                    q.prompt
                      ? `${q.prompt.slice(0, 40)}${q.prompt.length > 40 ? '…' : ''}`
                      : '문제 내용 없음'
                  }
                  metric={formatMs(q.median_time_spent_ms)}
                  metricLabel="중앙 시간"
                  metricDetail={`평균 ${formatMs(q.avg_time_spent_ms)}`}
                  insights={insightBadges(q)}
                  correct={q.correct_count}
                  total={q.answered_count}
                  countLabel={`${q.correct_count}/${q.answered_count}명`}
                  onClick={() => toggleQuestion(q.question_id)}
                />
                {expanded && (
                  <div className="animate-fade-in-up mb-2 rounded-xl bg-bg p-3">
                    {q.choice_distribution.length > 0 && (() => {
                      const choices = exam!.questions?.find((eq) => eq.id === q.question_id)?.choices ?? [];
                      const totalSelected = q.choice_distribution.reduce((sum, c) => sum + c.count, 0);
                      if (totalSelected === 0) return null;
                      const maxWrongCount = Math.max(
                        0,
                        ...q.choice_distribution
                          .filter((entry) => !choices.find((choice) => choice.id === entry.choice_id)?.is_correct)
                          .map((entry) => entry.count),
                      );
                      return (
                        <div className="mb-3 border-b border-line pb-3">
                          <p className="mb-2 text-xs font-bold text-ink-soft">선택지 분포</p>
                          <div className="flex flex-col gap-1.5">
                          {q.choice_distribution.map((c, i) => {
                            const choice = choices.find((ch) => ch.id === c.choice_id);
                            const pct = Math.round((c.count / totalSelected) * 100);
                            const isMainDistractor = !choice?.is_correct && c.count > 0 && c.count === maxWrongCount;
                            return (
                              <button
                                key={c.choice_id}
                                type="button"
                                className={`grid grid-cols-[3rem_1fr_4.5rem] items-center gap-2 rounded-lg px-2 py-1 text-left text-xs transition-colors hover:bg-panel ${
                                  choiceFilter === c.choice_id ? 'bg-accent-soft ring-1 ring-accent/30' : ''
                                }`}
                                onClick={() => setChoiceFilter((current) => current === c.choice_id ? null : c.choice_id)}
                              >
                                <span className={choice?.is_correct ? 'font-bold text-good' : 'text-ink'}>
                                  {i + 1}번 {choice?.is_correct ? '정답' : isMainDistractor ? '주요 오답' : ''}
                                </span>
                                <span className="h-2 overflow-hidden rounded-full bg-line">
                                  <span
                                    className={`block h-full rounded-full ${choice?.is_correct ? 'bg-good' : 'bg-accent'}`}
                                    style={{ width: `${pct}%` }}
                                  />
                                </span>
                                <span className="text-right text-ink-soft">{c.count}명 · {pct}%</span>
                              </button>
                            );
                          })}
                          </div>
                          {choiceFilter != null && (
                            <p className="mt-1.5 text-[11px] text-accent-ink">선택한 보기의 학생만 표시 중입니다.</p>
                          )}
                        </div>
                      );
                    })()}
                    {loadingBreakdownId === q.question_id ? (
                      <p className="text-xs text-ink-soft">불러오는 중...</p>
                    ) : !breakdown || breakdown.students.length === 0 ? (
                      <p className="text-xs text-ink-soft">아직 이 문항에 응답한 학생이 없습니다.</p>
                    ) : (
                      <>
                        <div className="mb-2 flex items-center gap-1 text-[11px]">
                          {(['all', 'wrong', 'correct'] as const).map((filter) => (
                            <button
                              key={filter}
                              type="button"
                              className={`rounded-full px-2 py-1 font-bold ${
                                answerFilter === filter ? 'bg-accent text-white' : 'bg-panel text-ink-soft'
                              }`}
                              onClick={() => setAnswerFilter(filter)}
                            >
                              {filter === 'all' ? '전체' : filter === 'wrong' ? '오답만' : '정답만'}
                            </button>
                          ))}
                          <span className="ml-auto text-ink-soft">{filteredStudents.length}명</span>
                        </div>
                        <div className="flex flex-col divide-y divide-line">
                        {filteredStudents.map((s) => (
                          <div key={s.roll_number} className="flex items-center gap-2 py-1.5 text-xs">
                            <span className="w-8 shrink-0 font-bold text-ink">{s.roll_number}</span>
                            <span className="w-16 shrink-0 truncate text-ink-soft">{s.name || '-'}</span>
                            <span className={`shrink-0 font-bold ${s.is_correct ? 'text-ink-soft' : 'text-danger'}`}>
                              {s.is_correct ? '정답' : '오답'}
                            </span>
                            <span className="shrink-0 text-ink-soft">{formatMs(s.time_spent_ms)}</span>
                            {s.isOutlier && <Badge tone="warn">{s.outlierReason}</Badge>}
                            <button
                              className="ml-auto shrink-0 font-bold text-accent hover:underline"
                              onClick={() => navigate(`/exams/${id}/sessions/${s.session_id}`)}
                            >
                              상세 보기
                            </button>
                          </div>
                        ))}
                        {filteredStudents.length === 0 && (
                          <p className="py-3 text-center text-xs text-ink-soft">조건에 맞는 학생이 없습니다.</p>
                        )}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <Pagination page={safeQuestionPage} totalPages={questionTotalPages} onChange={setQuestionPage} />
        </>
        )}
      </Card>

      <Card className="animate-fade-in-up mt-4" style={{ animationDelay: '140ms' }}>
        <SectionHeader title="성취기준별 정답률" open={showStandards} onToggle={() => setShowStandards((v) => !v)} />
        {showStandards && (
          data.standardsAccuracy.length === 0 ? (
            <p className="mt-2 text-sm text-ink-soft">
              제출된 응답 중 성취기준이 태깅된 문항이 없습니다. 문항에 성취기준을 태깅하면 여기에
              정답률이 집계됩니다.
            </p>
          ) : (
            <>
              <div className="mt-2 divide-y divide-line">
                {pagedStandardsAccuracy.map((s) => (
                  <AccuracyRow
                    key={s.code}
                    label={`[${s.code}]`}
                    sublabel={s.statement}
                    metric={formatMs(s.avg_time_spent_ms)}
                    correct={s.correct_count}
                    total={s.attempted_count}
                    countLabel={`${s.correct_count}/${s.attempted_count}회`}
                  />
                ))}
              </div>
              <Pagination page={safeStandardsPage} totalPages={standardsTotalPages} onChange={setStandardsPage} />
            </>
          )
        )}
      </Card>

      <Card className="animate-fade-in-up mt-4 overflow-hidden p-0" style={{ animationDelay: '170ms' }}>
        <div className="border-b border-line px-3 py-3">
          <SectionHeader
            title="학생 결과"
            description="학생을 누르면 답안과 필기를 확인할 수 있어요."
            open={showStudents}
            onToggle={() => setShowStudents((v) => !v)}
            right={
              <select
                value={studentFilter}
                onChange={(e) => setStudentFilter(e.target.value as typeof studentFilter)}
                className="rounded-lg border border-line bg-panel px-2 py-1.5 text-xs text-ink outline-none focus:border-accent"
              >
                <option value="all">전체 학생</option>
                <option value="attention">확인 필요</option>
                <option value="unfinished">미제출·응시 중</option>
                <option value="forced">강제 제출</option>
              </select>
            }
          />
        </div>
        {showStudents && (
        <>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-center text-xs font-bold text-ink-soft">
              <th className="whitespace-nowrap px-3 py-2.5">번호</th>
              <th className="whitespace-nowrap px-3 py-2.5">이름</th>
              <th className="whitespace-nowrap px-3 py-2.5">상태</th>
              <th className="whitespace-nowrap px-3 py-2.5">점수</th>
              <th className="whitespace-nowrap px-3 py-2.5">제출시각</th>
              <th className="whitespace-nowrap px-3 py-2.5">확인 필요</th>
              <th className="whitespace-nowrap px-3 py-2.5">오답 재풀이</th>
            </tr>
          </thead>
          <tbody>
            {pagedSessions.map((s) => (
              <tr
                key={s.roll_number}
                className={`border-b border-line text-center last:border-0 ${
                  s.session_id != null ? 'cursor-pointer hover:bg-bg' : ''
                }`}
                onClick={() => s.session_id != null && navigate(`/exams/${id}/sessions/${s.session_id}`)}
              >
                <td className="whitespace-nowrap px-3 py-2.5 font-bold text-ink">{s.roll_number}</td>
                <td className="max-w-[7rem] truncate px-3 py-2.5 text-ink-soft">{s.name || '-'}</td>
                <td className="whitespace-nowrap px-3 py-2.5 text-ink-soft">{STATUS_LABEL[s.status] ?? s.status}</td>
                <td className="whitespace-nowrap px-3 py-2.5 text-ink-soft">
                  {s.status === 'submitted' || s.status === 'force_submitted' ? `${s.score} / ${s.max_score}` : '-'}
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-ink-soft">
                  {s.submitted_at ? formatSubmittedAt(s.submitted_at) : '-'}
                </td>
                <td className="px-3 py-2.5">
                  {s.isOutlier && <Badge tone="warn">{s.outlierReasons.join(', ')}</Badge>}
                </td>
                <td className="whitespace-nowrap px-3 py-2.5">
                  {s.session_id != null && (s.status === 'submitted' || s.status === 'force_submitted') && (
                    <div className="flex items-center justify-center gap-1.5">
                      {s.review_status ? (
                        <>
                          <button type="button" className="rounded-lg bg-good/10 px-2.5 py-1.5 text-xs font-bold text-good hover:bg-good/20" onClick={(event) => { event.stopPropagation(); openReviewDetail(s.session_id!, s.roll_number); }}>
                            {s.review_status === 'completed' ? `완료 ${s.review_correct}/${s.review_total}` : s.review_status === 'in_progress' ? `진행 ${s.review_answered}/${s.review_total}` : `미시작 0/${s.review_total}`}
                          </button>
                          {s.review_max_attempts != null && s.review_max_attempts >= 2 && (
                            <Badge tone="warn" title="한 번에 못 맞힌 문항이 있어요 - 찍어서 맞혔을 수도 있으니 눌러서 확인해보세요.">
                              최다 {s.review_max_attempts}회
                            </Badge>
                          )}
                        </>
                      ) : <span className="text-xs text-ink-soft">오답 없음</span>}
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {visibleSessions.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-4 text-center text-ink-soft">
                  {data.sessions.length === 0 ? '아직 참여한 학생이 없습니다.' : '조건에 맞는 학생이 없습니다.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <Pagination page={safeStudentPage} totalPages={studentTotalPages} onChange={setStudentPage} />
        </>
        )}
      </Card>
      {reviewDetail && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setReviewDetail(null)}>
        <Card className="max-h-[85vh] w-full max-w-xl overflow-y-auto" onClick={(event) => event.stopPropagation()}>
          <div className="flex items-start justify-between gap-3">
            <div><h2 className="text-lg font-bold text-ink">{reviewDetail.rollNumber}번 오답 재풀이</h2><p className="mt-1 text-xs text-ink-soft">최초 답안과 재풀이 답안을 비교합니다.</p></div>
            <button className="text-sm font-bold text-ink-soft" onClick={() => setReviewDetail(null)}>닫기</button>
          </div>
          <div className="mt-4 divide-y divide-line">{reviewDetail.data.questions.map((question) => {
            const original = question.original_choice_text ?? question.original_short_answer ?? '-';
            const reviewed = question.review_choice_text ?? question.review_short_answer ?? '아직 풀지 않음';
            return <div key={question.question_id} className="flex items-center gap-3 py-3 text-sm">
              <span className="w-12 shrink-0 font-bold text-ink">{question.order_index + 1}번</span>
              <div className="min-w-0 flex-1"><p className="truncate text-xs text-ink-soft">최초: {original}</p><p className="truncate font-bold text-ink">재풀이: {reviewed}</p></div>
              {question.review_attempts != null && question.review_attempts >= 2 && (
                <span className="shrink-0 text-xs font-bold text-warn" title="찍어서 맞혔을 수도 있어요.">{question.review_attempts}회 시도</span>
              )}
              {question.review_is_correct == null ? <Badge tone="neutral">미완료</Badge> : <Badge tone={question.review_is_correct ? 'good' : 'danger'}>{question.review_is_correct ? '교정 완료' : '재오답'}</Badge>}
            </div>;
          })}</div>
          {reviewDetail.data.assignment.completed_at && <p className="mt-3 text-xs text-ink-soft">완료: {new Date(reviewDetail.data.assignment.completed_at).toLocaleString('ko-KR')}</p>}
        </Card>
      </div>}
    </div>
  );
}
