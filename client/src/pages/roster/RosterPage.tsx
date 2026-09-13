import { useEffect, useState } from 'react';
import { api, ApiError } from '../../api/client';
import type { RosterEntry } from '../../types';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { downloadWorkbook } from '../../lib/exportXlsx';

export function RosterPage() {
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [rollNumber, setRollNumber] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function reload() {
    api.get<RosterEntry[]>('/roster').then(setRoster);
  }

  useEffect(reload, []);

  async function addStudent() {
    const roll = Number(rollNumber);
    if (!Number.isInteger(roll) || roll <= 0) {
      setError('출석번호는 1 이상의 숫자여야 합니다.');
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await api.post('/roster', { roll_number: roll, name: name.trim() || null });
      setRollNumber('');
      setName('');
      reload();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '등록 중 오류가 발생했습니다.');
    } finally {
      setSaving(false);
    }
  }

  async function removeStudent(roll: number) {
    if (!confirm(`${roll}번을 명단에서 삭제할까요?`)) return;
    await api.delete(`/roster/${roll}`);
    reload();
  }

  function exportExcel() {
    downloadWorkbook('학생명단.xlsx', [
      {
        name: '학생명단',
        rows: roster.map((r) => ({ 출석번호: r.roll_number, 이름: r.name ?? '' })),
      },
    ]);
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-10">
      <h1 className="text-xl font-bold text-ink">학생 관리</h1>

      <Card className="mt-6">
        <h2 className="text-sm font-bold text-ink">학생 추가</h2>
        <div className="mt-3 flex items-end gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-bold text-ink-soft">출석번호</span>
            <input
              type="number"
              min={1}
              className="w-24 rounded-xl border border-line bg-bg px-3 py-2 text-sm text-ink outline-none focus:border-accent"
              value={rollNumber}
              onChange={(e) => setRollNumber(e.target.value)}
            />
          </label>
          <label className="flex flex-1 flex-col gap-1">
            <span className="text-xs font-bold text-ink-soft">이름(선택)</span>
            <input
              className="w-full rounded-xl border border-line bg-bg px-3 py-2 text-sm text-ink outline-none focus:border-accent"
              placeholder="예: 김민준"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <Button disabled={!rollNumber || saving} onClick={addStudent}>
            추가
          </Button>
        </div>
        {error && <p className="mt-2 text-xs font-bold text-danger">{error}</p>}
      </Card>

      <div className="mt-8">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-ink">등록된 학생 ({roster.length}명)</h2>
          {roster.length > 0 && (
            <button className="text-xs font-bold text-accent hover:underline" onClick={exportExcel}>
              엑셀로 다운로드
            </button>
          )}
        </div>
        {roster.length === 0 ? (
          <p className="mt-3 text-sm text-ink-soft">아직 등록된 학생이 없습니다.</p>
        ) : (
          <Card className="mt-3 p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs font-bold text-ink-soft">
                  <th className="px-4 py-2.5">출석번호</th>
                  <th className="px-4 py-2.5">이름</th>
                  <th className="px-4 py-2.5"></th>
                </tr>
              </thead>
              <tbody>
                {roster.map((r) => (
                  <tr key={r.roll_number} className="border-b border-line last:border-0">
                    <td className="px-4 py-2.5 font-bold text-ink">{r.roll_number}</td>
                    <td className="px-4 py-2.5 text-ink-soft">{r.name || '-'}</td>
                    <td className="px-4 py-2.5 text-right">
                      <button
                        className="text-xs text-ink-soft hover:text-danger"
                        onClick={() => removeStudent(r.roll_number)}
                      >
                        삭제
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </div>
    </div>
  );
}
