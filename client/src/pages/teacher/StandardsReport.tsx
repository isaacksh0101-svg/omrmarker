import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api/client';
import type { RosterEntry, StandardAccuracy } from '../../types';
import { Card } from '../../components/Card';
import { AccuracyRow } from '../../components/AccuracyRow';
import { CompareBar } from '../../components/CompareBar';
import { TimeUnitBars } from '../../components/TimeUnitBars';
import { StatCard, StatCardRow } from '../../components/StatCard';
import { PageHeader } from '../../components/PageHeader';
import { IconChart } from '../../components/icons';
import { displaySubjectName } from '../../lib/subjectName';
import { downloadWorkbook } from '../../lib/exportXlsx';

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
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [rollNumber, setRollNumber] = useState<string>('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [data, setData] = useState<StandardAccuracy[]>([]);
  const [classData, setClassData] = useState<StandardAccuracy[]>([]);
  const [sortLowFirst, setSortLowFirst] = useState(false);
  const [subjectFilter, setSubjectFilter] = useState<string>('all');

  useEffect(() => {
    api.get<RosterEntry[]>('/roster').then(setRoster);
  }, []);

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

  const comparing = rollNumber !== '';

  // 드롭다운에는 실제로 데이터가 있는 과목만 보여준다. 비교 모드에서는 학급 전체 기준
  // (더 넓은 범위)을, 아니면 지금 보이는 데이터 기준으로 목록을 만든다.
  const subjects = useMemo(() => {
    const source = comparing ? classData : data;
    return [...new Set(source.map((s) => s.subject_name))];
  }, [comparing, classData, data]);

  const filteredData = subjectFilter === 'all' ? data : data.filter((s) => s.subject_name === subjectFilter);

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
