import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import type { RosterEntry, StandardAccuracy, StandardsTrendPoint, StudentExamSummary } from '../../types';
import { Card } from '../../components/Card';
import { Badge } from '../../components/Badge';
import { AccuracyRow } from '../../components/AccuracyRow';
import { CompareBar } from '../../components/CompareBar';
import { TimeUnitBars } from '../../components/TimeUnitBars';
import { TrendChart, type TrendChartPoint } from '../../components/TrendChart';
import { StatCard, StatCardRow } from '../../components/StatCard';
import { PageHeader } from '../../components/PageHeader';
import { IconChart } from '../../components/icons';
import { displaySubjectName } from '../../lib/subjectName';
import { downloadWorkbook } from '../../lib/exportXlsx';

const GRADE_LABEL: Record<string, string> = {
  elem_1_2: '1~2학년군',
  elem_3_4: '3~4학년군',
  elem_5_6: '5~6학년군',
};

function formatMs(ms: number | null) {
  if (ms == null) return '-';
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `${totalSec}초`;
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return sec === 0 ? `${min}분` : `${min}분 ${sec}초`;
}

interface CompareItem {
  code: string;
  statement: string;
  subject_name: string;
  classAccuracy: number;
  classAttempted: number;
  classAvgTimeMs: number | null;
  myAccuracy: number | null;
  myAttempted: number;
  myAvgTimeMs: number | null;
}

export function StandardsReport() {
  const navigate = useNavigate();
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [rollNumber, setRollNumber] = useState<string>('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [data, setData] = useState<StandardAccuracy[]>([]);
  const [classData, setClassData] = useState<StandardAccuracy[]>([]);
  const [sortLowFirst, setSortLowFirst] = useState(false);
  const [subjectFilter, setSubjectFilter] = useState<string>('all');
  const [studentExams, setStudentExams] = useState<StudentExamSummary[]>([]);
  // 정답률 추이 차트 - 기본은 과목 전체 평균, trendCode를 고르면 그 성취기준 하나로 좁힌다.
  const [trendCode, setTrendCode] = useState<string>('');
  const [classTrend, setClassTrend] = useState<StandardsTrendPoint[]>([]);
  const [myTrend, setMyTrend] = useState<StandardsTrendPoint[]>([]);

  useEffect(() => {
    api.get<RosterEntry[]>('/roster').then(setRoster);
  }, []);

  // 학생을 고르면 그 학생이 실제로 낸 시험들(문항별 상세를 열어볼 수 있는 목록)도 같이 불러온다.
  useEffect(() => {
    if (!rollNumber) {
      setStudentExams([]);
      return;
    }
    api.get<StudentExamSummary[]>(`/roster/${rollNumber}/exams`).then(setStudentExams);
  }, [rollNumber]);

  useEffect(() => {
    const params = new URLSearchParams();
    if (rollNumber) params.set('roll_number', rollNumber);
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    const query = params.toString() ? `?${params.toString()}` : '';
    api.get<StandardAccuracy[]>(`/standards/report${query}`).then(setData);

    // 특정 학생을 골랐을 때는 "반 평균"과 비교해서 보여줘야 하므로, 같은 기간의 학급
    // 전체 집계도 함께 불러온다. rollNumber가 없을 때는 비교 화면 자체를 안 그리므로
    // (compareItems가 comparing===false면 항상 빈 배열) classData를 굳이 비울 필요는 없다.
    if (rollNumber) {
      const classParams = new URLSearchParams();
      if (from) classParams.set('from', from);
      if (to) classParams.set('to', to);
      const classQuery = classParams.toString() ? `?${classParams.toString()}` : '';
      api.get<StandardAccuracy[]>(`/standards/report${classQuery}`).then(setClassData);
    }
  }, [rollNumber, from, to]);

  // 과목을 바꾸면 이전 과목의 성취기준 코드가 더 이상 의미 없으므로 드릴다운을 초기화한다.
  useEffect(() => {
    setTrendCode('');
  }, [subjectFilter]);

  useEffect(() => {
    const params = new URLSearchParams();
    if (subjectFilter !== 'all') {
      // subjectFilter는 화면에 보이는 subject_name("사회")이지 exams.subject_id("SO" 같은
      // 코드)가 아니다 - 서버는 실제 subject_id로 필터링하므로 여기서 변환해줘야 한다.
      const source = rollNumber ? classData : data;
      const subjectId = source.find((s) => s.subject_name === subjectFilter)?.subject_id;
      if (subjectId) params.set('subject_id', subjectId);
    }
    if (trendCode) params.set('code', trendCode);
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    const query = params.toString() ? `?${params.toString()}` : '';
    api.get<StandardsTrendPoint[]>(`/standards/trend${query}`).then(setClassTrend);

    if (rollNumber) {
      const mineParams = new URLSearchParams(params);
      mineParams.set('roll_number', rollNumber);
      api.get<StandardsTrendPoint[]>(`/standards/trend?${mineParams.toString()}`).then(setMyTrend);
    } else {
      setMyTrend([]);
    }
  }, [subjectFilter, trendCode, rollNumber, from, to, data, classData]);

  const comparing = rollNumber !== '';

  // 드롭다운에는 실제로 데이터가 있는 과목만 보여준다. 비교 모드에서는 학급 전체 기준
  // (더 넓은 범위)을, 아니면 지금 보이는 데이터 기준으로 목록을 만든다.
  const subjects = useMemo(() => {
    const source = comparing ? classData : data;
    return [...new Set(source.map((s) => s.subject_name))];
  }, [comparing, classData, data]);

  const filteredData = subjectFilter === 'all' ? data : data.filter((s) => s.subject_name === subjectFilter);

  // 추이 차트의 "성취기준으로 좁혀보기" 드롭다운 옵션 - 지금 필터에 걸리는 성취기준만 보여준다.
  const trendStandardOptions = useMemo(() => {
    const source = comparing ? classData : data;
    const byCode = new Map<string, StandardAccuracy>();
    for (const s of source) {
      if (subjectFilter !== 'all' && s.subject_name !== subjectFilter) continue;
      byCode.set(s.code, s);
    }
    return [...byCode.values()].sort((a, b) => a.code.localeCompare(b.code));
  }, [comparing, classData, data, subjectFilter]);

  // 반 평균(classTrend)과 내 추이(myTrend)를 exam_id 기준으로 합쳐 차트 한 줄씩 만든다.
  const chartPoints: TrendChartPoint[] = useMemo(() => {
    const byExam = new Map<number, TrendChartPoint>();
    for (const p of classTrend) {
      byExam.set(p.exam_id, {
        key: String(p.exam_id),
        date: p.date,
        title: p.title,
        classAcc: p.accuracy,
        classAttempted: p.attempted_count,
        mineAcc: null,
        mineAttempted: 0,
      });
    }
    for (const p of myTrend) {
      const existing = byExam.get(p.exam_id);
      if (existing) {
        existing.mineAcc = p.accuracy;
        existing.mineAttempted = p.attempted_count;
      } else {
        // 이론상 학생이 응시한 시험은 항상 classTrend에도 잡혀야 하지만(같은 조건으로
        // 조회하므로), 혹시 어긋나는 경우를 대비해 내 수치로라도 점을 만들어 둔다.
        byExam.set(p.exam_id, {
          key: String(p.exam_id),
          date: p.date,
          title: p.title,
          classAcc: p.accuracy,
          classAttempted: p.attempted_count,
          mineAcc: p.accuracy,
          mineAttempted: p.attempted_count,
        });
      }
    }
    return [...byExam.values()].sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key));
  }, [classTrend, myTrend]);

  const compareItems: CompareItem[] = useMemo(() => {
    if (!comparing) return [];
    const byCodeMine = new Map(data.map((s) => [s.code, s]));
    return classData
      .filter((c) => subjectFilter === 'all' || c.subject_name === subjectFilter)
      .map((c) => {
        const mine = byCodeMine.get(c.code);
        return {
          code: c.code,
          statement: c.statement,
          subject_name: c.subject_name,
          classAccuracy: c.accuracy,
          classAttempted: c.attempted_count,
          classAvgTimeMs: c.avg_time_spent_ms,
          myAccuracy: mine ? mine.accuracy : null,
          myAttempted: mine ? mine.attempted_count : 0,
          myAvgTimeMs: mine ? mine.avg_time_spent_ms : null,
        };
      });
  }, [comparing, data, classData, subjectFilter]);

  const totalAttempted = filteredData.reduce((sum, s) => sum + s.attempted_count, 0);
  const totalCorrect = filteredData.reduce((sum, s) => sum + s.correct_count, 0);
  const overallPct = totalAttempted > 0 ? Math.round((totalCorrect / totalAttempted) * 100) : 0;

  const grouped = useMemo(() => {
    const sorted = [...filteredData].sort((a, b) =>
      sortLowFirst ? a.accuracy - b.accuracy : b.attempted_count - a.attempted_count,
    );
    const bySubject = new Map<string, StandardAccuracy[]>();
    for (const s of sorted) {
      const list = bySubject.get(s.subject_name) ?? [];
      list.push(s);
      bySubject.set(s.subject_name, list);
    }
    return [...bySubject.entries()];
  }, [filteredData, sortLowFirst]);

  const groupedCompare = useMemo(() => {
    const sorted = [...compareItems].sort((a, b) =>
      sortLowFirst ? (a.myAccuracy ?? 0) - (b.myAccuracy ?? 0) : b.classAttempted - a.classAttempted,
    );
    const bySubject = new Map<string, CompareItem[]>();
    for (const item of sorted) {
      const list = bySubject.get(item.subject_name) ?? [];
      list.push(item);
      bySubject.set(item.subject_name, list);
    }
    return [...bySubject.entries()];
  }, [compareItems, sortLowFirst]);

  function exportExcel() {
    const who = rollNumber ? `${rollNumber}번` : '전체';
    const subjectSuffix = subjectFilter !== 'all' ? `_${subjectFilter}` : '';
    downloadWorkbook(`학생별_리포트_${who}${subjectSuffix}.xlsx`, [
      comparing
        ? {
            name: '성취기준별 비교',
            rows: compareItems.map((s) => ({
              교과: s.subject_name,
              코드: s.code,
              내용: s.statement,
              반평균_정답률: `${Math.round(s.classAccuracy * 100)}%`,
              내_정답률: s.myAccuracy == null ? '-' : `${Math.round(s.myAccuracy * 100)}%`,
              반평균_풀이시간: formatMs(s.classAvgTimeMs),
              내_풀이시간: formatMs(s.myAvgTimeMs),
            })),
          }
        : {
            name: '성취기준별 정답률',
            rows: filteredData.map((s) => ({
              교과: s.subject_name,
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

  const hasExportable = comparing ? compareItems.length > 0 : filteredData.length > 0;

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <PageHeader
        icon={IconChart}
        title="학생별 리포트"
        right={
          hasExportable && (
            <button className="text-xs font-bold text-accent hover:underline" onClick={exportExcel}>
              엑셀로 다운로드
            </button>
          )
        }
      />

      <div className="animate-fade-in-up mt-5 flex flex-wrap items-center gap-2 text-xs">
        <span className="font-bold text-ink-soft">학생</span>
        <select
          className="rounded-lg border border-line bg-panel px-2 py-1.5 text-ink outline-none focus:border-accent"
          value={rollNumber}
          onChange={(e) => setRollNumber(e.target.value)}
        >
          <option value="">전체</option>
          {roster.map((r) => (
            <option key={r.roll_number} value={r.roll_number}>
              {r.roll_number}번{r.name ? ` · ${r.name}` : ''}
            </option>
          ))}
        </select>

        <select
          value={subjectFilter}
          onChange={(e) => setSubjectFilter(e.target.value)}
          className="rounded-lg border border-line bg-panel px-2 py-1.5 text-ink outline-none focus:border-accent"
        >
          <option value="all">전체 과목</option>
          {subjects.map((s) => (
            <option key={s} value={s}>
              {displaySubjectName(s)}
            </option>
          ))}
        </select>

        <span className="ml-2 font-bold text-ink-soft">기간</span>
        <input
          type="date"
          className="rounded-lg border border-line bg-panel px-2 py-1.5 text-ink outline-none focus:border-accent"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
        <span className="text-ink-soft">~</span>
        <input
          type="date"
          className="rounded-lg border border-line bg-panel px-2 py-1.5 text-ink outline-none focus:border-accent"
          value={to}
          onChange={(e) => setTo(e.target.value)}
        />
        {(from || to) && (
          <button
            className="font-bold text-accent hover:underline"
            onClick={() => {
              setFrom('');
              setTo('');
            }}
          >
            초기화
          </button>
        )}

        <button
          className="ml-auto font-bold text-ink-soft hover:text-accent"
          onClick={() => setSortLowFirst((v) => !v)}
        >
          {sortLowFirst ? '푼 문제 수순으로 보기' : '정답률 낮은 순으로 보기'}
        </button>
      </div>

      {!comparing && (
        <div className="animate-fade-in-up mt-4" style={{ animationDelay: '40ms' }}>
          <StatCardRow>
            <StatCard label="집계된 성취기준 수" value={`${filteredData.length}개`} />
            <StatCard label="누적 푼 문제 수" value={`${totalAttempted}문제`} />
            <StatCard label="누적 정답률" value={`${overallPct}%`} />
          </StatCardRow>
        </div>
      )}

      {comparing && studentExams.length > 0 && (
        <Card className="animate-fade-in-up mt-4" style={{ animationDelay: '40ms' }}>
          <h2 className="text-sm font-bold text-ink">이 학생이 응시한 시험</h2>
          <div className="mt-2 flex flex-col divide-y divide-line">
            {studentExams.map((se) => (
              <button
                key={se.session_id}
                type="button"
                className="flex items-center justify-between gap-3 py-2.5 text-left transition-colors duration-150 hover:text-accent"
                onClick={() => navigate(`/exams/${se.exam_id}/sessions/${se.session_id}`)}
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-ink">{se.title}</p>
                  <p className="mt-0.5 text-xs text-ink-soft">
                    {GRADE_LABEL[se.grade_cluster] || se.grade_cluster} · {se.subject_id}
                    {se.submitted_at ? ` · ${se.submitted_at.slice(0, 10)}` : ''}
                  </p>
                </div>
                <Badge tone="neutral">{se.max_score != null ? `${se.score ?? 0} / ${se.max_score}` : '-'}</Badge>
              </button>
            ))}
          </div>
        </Card>
      )}

      <Card className="animate-fade-in-up mt-4" style={{ animationDelay: '60ms' }}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-bold text-ink">정답률 변화 추이</h2>
          {trendStandardOptions.length > 0 && (
            <select
              value={trendCode}
              onChange={(e) => setTrendCode(e.target.value)}
              className="max-w-[60%] rounded-lg border border-line bg-panel px-2 py-1.5 text-xs text-ink outline-none focus:border-accent"
            >
              <option value="">
                {subjectFilter === 'all' ? '전체 평균' : `${displaySubjectName(subjectFilter)} 전체 평균`}
              </option>
              {trendStandardOptions.map((s) => (
                <option key={s.code} value={s.code}>
                  [{s.code}] {s.statement}
                </option>
              ))}
            </select>
          )}
        </div>
        {chartPoints.length < 2 ? (
          <p className="mt-3 text-xs text-ink-soft">
            추이를 보려면 같은 조건에 해당하는 시험 결과가 2개 이상 있어야 합니다.
          </p>
        ) : (
          <TrendChart points={chartPoints} showMine={comparing} />
        )}
      </Card>

      {comparing ? (
        groupedCompare.length === 0 ? (
          <p className="mt-8 text-sm text-ink-soft">
            제출된 응답 중 성취기준이 태깅된 문항이 없습니다. 시험 문항에 성취기준을 태깅하면
            여기에 반 평균 대비 비교가 표시됩니다.
          </p>
        ) : (
          groupedCompare.map(([subjectName, items], i) => (
            <Card
              key={subjectName}
              className="animate-fade-in-up mt-4"
              style={{ animationDelay: `${80 + Math.min(i, 10) * 30}ms` }}
            >
              <h2 className="text-sm font-bold text-ink">{displaySubjectName(subjectName)}</h2>
              <div className="mt-2 flex flex-col divide-y divide-line">
                {items.map((item) => (
                  <div key={item.code} className="grid grid-cols-1 gap-3 py-3 sm:grid-cols-[1fr_9rem_9rem]">
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-ink">[{item.code}]</p>
                      <p className="mt-0.5 truncate text-xs text-ink-soft">{item.statement}</p>
                      {item.myAttempted === 0 && (
                        <p className="mt-0.5 text-[11px] font-bold text-warn">아직 풀어본 문제가 없어요</p>
                      )}
                    </div>
                    <div>
                      <p className="mb-1 text-[10px] font-bold text-ink-soft">정답률</p>
                      <CompareBar
                        classValue={item.classAccuracy}
                        myValue={item.myAccuracy}
                        maxValue={1}
                        formatValue={(v) => `${Math.round(v * 100)}%`}
                      />
                    </div>
                    <div>
                      <p className="mb-1 text-[10px] font-bold text-ink-soft">풀이 시간</p>
                      <TimeUnitBars
                        classValue={item.classAvgTimeMs ?? 0}
                        myValue={item.myAvgTimeMs}
                        formatValue={formatMs}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          ))
        )
      ) : grouped.length === 0 ? (
        <p className="mt-8 text-sm text-ink-soft">
          제출된 응답 중 성취기준이 태깅된 문항이 없습니다. 시험 문항에 성취기준을 태깅하면
          여기에 정답률이 집계됩니다.
        </p>
      ) : (
        grouped.map(([subjectName, items], i) => (
          <Card
            key={subjectName}
            className="animate-fade-in-up mt-4"
            style={{ animationDelay: `${80 + Math.min(i, 10) * 30}ms` }}
          >
            <h2 className="text-sm font-bold text-ink">{displaySubjectName(subjectName)}</h2>
            <div className="mt-2 divide-y divide-line">
              {items.map((s) => (
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
          </Card>
        ))
      )}
    </div>
  );
}
