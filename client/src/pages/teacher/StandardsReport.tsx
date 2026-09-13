import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api/client';
import type { RosterEntry, StandardAccuracy } from '../../types';
import { Card } from '../../components/Card';
import { AccuracyRow } from '../../components/AccuracyRow';
import { StatCard, StatCardRow } from '../../components/StatCard';
import { downloadWorkbook } from '../../lib/exportXlsx';

function formatMs(ms: number | null) {
  if (ms == null) return '-';
  return `${Math.round(ms / 1000)}초`;
}

export function StandardsReport() {
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [rollNumber, setRollNumber] = useState<string>('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [data, setData] = useState<StandardAccuracy[]>([]);
  const [sortLowFirst, setSortLowFirst] = useState(false);
  const [subjectFilter, setSubjectFilter] = useState<string | null>(null);

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
  }, [rollNumber, from, to]);

  const subjects = useMemo(() => [...new Set(data.map((s) => s.subject_name))], [data]);
  const filteredData = subjectFilter ? data.filter((s) => s.subject_name === subjectFilter) : data;

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

  function exportExcel() {
    const who = rollNumber ? `${rollNumber}번` : '전체';
    const subjectSuffix = subjectFilter ? `_${subjectFilter}` : '';
    downloadWorkbook(`학생별_리포트_${who}${subjectSuffix}.xlsx`, [
      {
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

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <div className="animate-fade-in-up flex items-center gap-2">
        <h1 className="text-2xl font-bold tracking-tight text-ink">학생별 리포트</h1>
        {filteredData.length > 0 && (
          <button className="ml-auto text-xs font-bold text-accent hover:underline" onClick={exportExcel}>
            엑셀로 다운로드
          </button>
        )}
      </div>

      {subjects.length > 1 && (
        <div className="animate-fade-in-up mt-4 flex flex-wrap gap-1 rounded-full bg-bg p-1">
          <button
            className={`rounded-full px-3 py-1.5 text-sm font-bold transition-colors duration-150 ${
              subjectFilter === null ? 'bg-panel text-ink shadow-sm' : 'text-ink-soft'
            }`}
            onClick={() => setSubjectFilter(null)}
          >
            전체
          </button>
          {subjects.map((s) => (
            <button
              key={s}
              className={`rounded-full px-3 py-1.5 text-sm font-bold transition-colors duration-150 ${
                subjectFilter === s ? 'bg-panel text-ink shadow-sm' : 'text-ink-soft'
              }`}
              onClick={() => setSubjectFilter(s)}
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-end gap-2">
        <label className="flex items-center gap-2">
          <span className="text-xs font-bold text-ink-soft">학생</span>
          <select
            className="rounded-xl border border-line bg-panel px-3 py-2 text-sm text-ink outline-none focus:border-accent"
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
        </label>
        <label className="flex items-center gap-2">
          <span className="text-xs font-bold text-ink-soft">시작일</span>
          <input
            type="date"
            className="rounded-xl border border-line bg-panel px-3 py-2 text-sm text-ink outline-none focus:border-accent"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label className="flex items-center gap-2">
          <span className="text-xs font-bold text-ink-soft">종료일</span>
          <input
            type="date"
            className="rounded-xl border border-line bg-panel px-3 py-2 text-sm text-ink outline-none focus:border-accent"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
        {(from || to) && (
          <button
            className="text-xs font-bold text-ink-soft hover:text-accent"
            onClick={() => {
              setFrom('');
              setTo('');
            }}
          >
            기간 초기화
          </button>
        )}
        <button
          className="ml-auto text-xs font-bold text-ink-soft hover:text-accent"
          onClick={() => setSortLowFirst((v) => !v)}
        >
          {sortLowFirst ? '푼 문제 수순으로 보기' : '정답률 낮은 순으로 보기'}
        </button>
      </div>

      <div className="animate-fade-in-up mt-4" style={{ animationDelay: '40ms' }}>
        <StatCardRow>
          <StatCard label="집계된 성취기준 수" value={`${filteredData.length}개`} />
          <StatCard label="누적 푼 문제 수" value={`${totalAttempted}문제`} />
          <StatCard label="누적 정답률" value={`${overallPct}%`} />
        </StatCardRow>
      </div>

      {grouped.length === 0 ? (
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
            <h2 className="text-sm font-bold text-ink">{subjectName}</h2>
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
