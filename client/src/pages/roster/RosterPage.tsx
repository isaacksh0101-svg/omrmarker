import { useEffect, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { api, ApiError } from '../../api/client';
import type { RosterEntry } from '../../types';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { PageHeader } from '../../components/PageHeader';
import { IconUsers } from '../../components/icons';
import { downloadWorkbook } from '../../lib/exportXlsx';

function NameCell({ roll, name, onSaved }: { roll: number; name: string | null; onSaved: () => void }) {
  const [value, setValue] = useState(name ?? '');
  useEffect(() => setValue(name ?? ''), [name]);

  async function save() {
    if (value === (name ?? '')) return;
    await api.post('/roster', { roll_number: roll, name: value.trim() || null });
    onSaved();
  }

  return (
    <input
      className="w-full rounded-lg border border-transparent px-1.5 py-1 text-sm text-ink-soft outline-none hover:border-line focus:border-accent focus:bg-bg"
      placeholder="이름 입력"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={save}
    />
  );
}

export function RosterPage() {
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [rollNumber, setRollNumber] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [bulkCount, setBulkCount] = useState('');
  const [bulkSaving, setBulkSaving] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [selectedRolls, setSelectedRolls] = useState<Set<number>>(new Set());
  const [deletingLearningData, setDeletingLearningData] = useState(false);
  const [learningDataDeleteMode, setLearningDataDeleteMode] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  async function addBulk() {
    const count = Number(bulkCount);
    if (!Number.isInteger(count) || count <= 0) {
      setError('학생 수는 1 이상의 숫자여야 합니다.');
      return;
    }
    setError(null);
    setBulkSaving(true);
    try {
      // 이미 등록된 번호는 건드리지 않는다 - upsert라서 그냥 밀어넣으면 기존에 입력해둔 이름이
      // null로 덮어써진다.
      const existing = new Set(roster.map((r) => r.roll_number));
      for (let roll = 1; roll <= count; roll++) {
        if (existing.has(roll)) continue;
        await api.post('/roster', { roll_number: roll, name: null });
      }
      setBulkCount('');
      reload();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '일괄 생성 중 오류가 발생했습니다.');
    } finally {
      setBulkSaving(false);
    }
  }

  async function removeStudent(roll: number) {
    if (!confirm(`${roll}번을 명단에서 삭제할까요?`)) return;
    await api.delete(`/roster/${roll}`);
    setSelectedRolls((current) => {
      const next = new Set(current);
      next.delete(roll);
      return next;
    });
    reload();
  }

  async function removeSelectedLearningData() {
    const rolls = [...selectedRolls].sort((a, b) => a - b);
    if (rolls.length === 0) return;
    const label = rolls.length === roster.length ? `전체 학생 ${rolls.length}명` : `선택한 학생 ${rolls.length}명 (${rolls.join(', ')}번)`;
    if (!confirm(`${label}의 학습 데이터를 완전 삭제할까요?\n\n응시 기록, 답안, 점수, 문항별 소요시간, 필기와 화면 이탈 기록이 삭제되며 되돌릴 수 없습니다. 학생 명단은 유지됩니다.`)) return;
    setDeletingLearningData(true);
    setError(null);
    try {
      const result = await api.delete<{ deletedSessions: number }>('/roster/learning-data', { roll_numbers: rolls });
      setSelectedRolls(new Set());
      setLearningDataDeleteMode(false);
      window.dispatchEvent(new Event('scorelab:data-retention-changed'));
      alert(`${label}의 학습 데이터 삭제를 완료했습니다. 삭제된 응시 기록: ${result.deletedSessions}건`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '학습 데이터 삭제 중 오류가 발생했습니다.');
    } finally {
      setDeletingLearningData(false);
    }
  }

  const allSelected = roster.length > 0 && selectedRolls.size === roster.length;

  function toggleAll() {
    setSelectedRolls(allSelected ? new Set() : new Set(roster.map((entry) => entry.roll_number)));
  }

  function toggleStudent(roll: number) {
    setSelectedRolls((current) => {
      const next = new Set(current);
      if (next.has(roll)) next.delete(roll);
      else next.add(roll);
      return next;
    });
  }

  function closeLearningDataDeleteMode() {
    setSelectedRolls(new Set());
    setLearningDataDeleteMode(false);
  }

  function downloadTemplate() {
    downloadWorkbook('학생명단_양식.xlsx', [
      {
        name: '학생명단',
        rows: [
          { 번호: 1, 이름: '홍길동' },
          { 번호: 2, 이름: '' },
        ],
      },
    ]);
  }

  async function handleUploadFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploadError(null);
    setUploading(true);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);
      if (rows.length === 0) throw new Error('엑셀 파일에서 읽을 수 있는 행이 없습니다.');
      let count = 0;
      for (const row of rows) {
        const roll = Number(row['번호'] ?? row['출석번호']);
        if (!Number.isInteger(roll) || roll <= 0) continue;
        const rowName = String(row['이름'] ?? '').trim();
        await api.post('/roster', { roll_number: roll, name: rowName || null });
        count += 1;
      }
      if (count === 0) throw new Error('"번호" 열을 찾을 수 없습니다. 양식을 다운로드해서 확인해주세요.');
      reload();
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : '엑셀 업로드 중 오류가 발생했습니다.');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <PageHeader icon={IconUsers} title="학생 관리" />

      <Card className="animate-fade-in-up mt-7">
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
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <Button disabled={!rollNumber || saving} onClick={addStudent}>
            추가
          </Button>
        </div>
        {error && <p className="mt-2 text-xs font-bold text-danger">{error}</p>}

        <div className="mt-4 border-t border-line pt-4">
          <span className="text-xs font-bold text-ink-soft">번호로 한 번에 만들기</span>
          <div className="mt-2 flex items-end gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-ink-soft">학생 수</span>
              <input
                type="number"
                min={1}
                placeholder="예: 20"
                className="w-24 rounded-xl border border-line bg-bg px-3 py-2 text-sm text-ink outline-none focus:border-accent"
                value={bulkCount}
                onChange={(e) => setBulkCount(e.target.value)}
              />
            </label>
            <Button variant="secondary" disabled={!bulkCount || bulkSaving} onClick={addBulk}>
              {bulkSaving ? '생성 중...' : '1번부터 일괄 생성'}
            </Button>
          </div>
          <p className="mt-1 text-xs text-ink-soft">이미 등록된 번호는 그대로 두고, 없는 번호만 이름 없이 추가합니다.</p>
        </div>

        <div className="mt-4 border-t border-line pt-4">
          <span className="text-xs font-bold text-ink-soft">엑셀로 명단 업로드</span>
          <div className="mt-2 flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={handleUploadFile}
            />
            <Button variant="secondary" disabled={uploading} onClick={() => fileInputRef.current?.click()}>
              {uploading ? '업로드 중...' : '엑셀 파일 선택'}
            </Button>
            <button className="text-xs font-bold text-accent hover:underline" onClick={downloadTemplate}>
              양식 다운로드
            </button>
          </div>
          <p className="mt-1 text-xs text-ink-soft">"번호", "이름" 두 열로 된 엑셀 파일을 올리면 한 번에 등록됩니다.</p>
          {uploadError && <p className="mt-2 text-xs font-bold text-danger">{uploadError}</p>}
        </div>
      </Card>

      <div className="animate-fade-in-up mt-9" style={{ animationDelay: '60ms' }}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-bold text-ink">등록된 학생 ({roster.length}명)</h2>
          {roster.length > 0 && (
            learningDataDeleteMode ? (
              <div className="flex items-center gap-2">
                <Button data-testid="cancel-learning-data-delete-mode" variant="secondary" disabled={deletingLearningData} onClick={closeLearningDataDeleteMode}>
                  취소
                </Button>
                <Button data-testid="delete-selected-learning-data" variant="danger" disabled={selectedRolls.size === 0 || deletingLearningData} onClick={removeSelectedLearningData}>
                  {deletingLearningData ? '삭제 중...' : `선택 삭제 (${selectedRolls.size}명)`}
                </Button>
              </div>
            ) : (
              <Button
                data-testid="open-learning-data-delete-mode"
                variant="secondary"
                onClick={() => setLearningDataDeleteMode(true)}
              >
                학습 데이터 삭제
              </Button>
            )
          )}
        </div>
        {roster.length === 0 ? (
          <p className="mt-3 text-sm text-ink-soft">아직 등록된 학생이 없습니다.</p>
        ) : (
          <Card className="mt-3 overflow-hidden p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs font-bold text-ink-soft">
                  {learningDataDeleteMode && (
                    <th className="w-12 px-4 py-2.5">
                      <input
                        type="checkbox"
                        data-testid="select-all-students"
                        aria-label="학생 전체 선택"
                        checked={allSelected}
                        onChange={toggleAll}
                        className="h-4 w-4 accent-accent"
                      />
                    </th>
                  )}
                  <th className="px-4 py-2.5">출석번호</th>
                  <th className="px-4 py-2.5">이름</th>
                  {!learningDataDeleteMode && <th className="px-4 py-2.5 text-right">관리</th>}
                </tr>
              </thead>
              <tbody>
                {roster.map((r) => (
                  <tr key={r.roll_number} className="border-b border-line last:border-0">
                    {learningDataDeleteMode && (
                      <td className="px-4 py-2.5">
                        <input
                          type="checkbox"
                          data-testid={`select-student-${r.roll_number}`}
                          aria-label={`${r.roll_number}번 학생 선택`}
                          checked={selectedRolls.has(r.roll_number)}
                          onChange={() => toggleStudent(r.roll_number)}
                          className="h-4 w-4 accent-accent"
                        />
                      </td>
                    )}
                    <td className="px-4 py-2.5 font-bold text-ink">{r.roll_number}</td>
                    <td className="px-1.5 py-1">
                      <NameCell roll={r.roll_number} name={r.name} onSaved={reload} />
                    </td>
                    {!learningDataDeleteMode && (
                      <td className="px-4 py-2.5 text-right">
                        <button
                          className="text-xs text-ink-soft hover:text-danger"
                          onClick={() => removeStudent(r.roll_number)}
                        >
                          삭제
                        </button>
                      </td>
                    )}
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
