import { useEffect, useState } from 'react';
import { api, ApiError } from '../../api/client';
import type { RosterEntry } from '../../types';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { PageHeader } from '../../components/PageHeader';
import { IconUsers } from '../../components/icons';

interface IncompleteReview {
  assignment_id: number;
  exam_id: number;
  exam_title: string;
  status: 'assigned' | 'in_progress';
  total: number;
  answered: number;
}

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
  const [selectedRolls, setSelectedRolls] = useState<Set<number>>(new Set());
  const [deletingLearningData, setDeletingLearningData] = useState(false);
  const [learningDataDeleteMode, setLearningDataDeleteMode] = useState(false);
  const [recoveryStudent, setRecoveryStudent] = useState<RosterEntry | null>(null);
  const [incompleteReviews, setIncompleteReviews] = useState<IncompleteReview[]>([]);
  const [recoveryCode, setRecoveryCode] = useState<{ code: string; expires_at: string; exam_title?: string; count?: number } | null>(null);
  const [issuingAll, setIssuingAll] = useState(false);

  function reload() {
    api.get<RosterEntry[]>('/roster').then(setRoster);
  }

  useEffect(reload, []);

  async function addStudent() {
    const roll = Number(rollNumber);
    if (!Number.isInteger(roll) || roll <= 0) {
      setError('번호는 1 이상의 숫자여야 합니다.');
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

  async function openRecovery(student: RosterEntry) {
    setRecoveryStudent(student);
    setRecoveryCode(null);
    setIncompleteReviews(await api.get<IncompleteReview[]>(`/roster/${student.roll_number}/incomplete-reviews`));
  }

  async function issueRecovery(review: IncompleteReview) {
    const result = await api.post<{ code: string; expires_at: string }>(`/roster/${recoveryStudent!.roll_number}/incomplete-reviews/${review.assignment_id}/recovery-code`);
    setRecoveryCode({ ...result, exam_title: review.exam_title });
  }

  async function issueRecoveryAll() {
    setIssuingAll(true);
    try {
      const result = await api.post<{ code: string; expires_at: string; count: number }>(`/roster/${recoveryStudent!.roll_number}/incomplete-reviews/recovery-code`);
      setRecoveryCode(result);
    } finally {
      setIssuingAll(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <PageHeader icon={IconUsers} title="학생 관리" />

      <Card className="animate-fade-in-up mt-7">
        <h2 className="text-sm font-bold text-ink">학생 추가</h2>
        <div className="mt-3 flex items-end gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-bold text-ink-soft">번호</span>
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
                  <th className="px-4 py-2.5">번호</th>
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
                          className="mr-3 text-xs font-bold text-accent-ink hover:underline"
                          onClick={() => openRecovery(r)}
                        >
                          재풀이 연결
                        </button>
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
      {recoveryStudent && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setRecoveryStudent(null)}>
        <Card className="w-full max-w-lg" onClick={(event) => event.stopPropagation()}>
          <div className="flex items-start justify-between"><div><h2 className="text-lg font-bold text-ink">{recoveryStudent.roll_number}번 재풀이 기기 연결</h2><p className="mt-1 text-xs text-ink-soft">브라우저 초기화 등으로 기존 응시 기록이 사라진 경우에만 사용하세요.</p></div><button className="text-sm font-bold text-ink-soft" onClick={() => setRecoveryStudent(null)}>닫기</button></div>
          {recoveryCode ? (
            <div className="mt-5 rounded-2xl bg-accent-soft p-5 text-center">
              <p className="text-xs font-bold text-accent-ink">
                {recoveryCode.count != null ? `재풀이 ${recoveryCode.count}개 전체` : recoveryCode.exam_title} · 10분간 1회 사용
              </p>
              <p className="mt-2 text-4xl font-black tracking-[0.25em] text-accent-ink">{recoveryCode.code}</p>
              <p className="mt-3 text-xs text-ink-soft">
                학생 화면의 '오답 재풀이 복구'에 번호와 이 코드를 입력합니다.
                {recoveryCode.count != null && ' 이 코드 하나로 미완료 재풀이가 전부 한 번에 연결됩니다.'}
              </p>
              <Button className="mt-4" variant="secondary" onClick={() => setRecoveryCode(null)}>다른 시험 선택</Button>
            </div>
          ) : incompleteReviews.length === 0 ? (
            <p className="mt-5 text-sm text-ink-soft">연결할 미완료 오답 재풀이가 없습니다.</p>
          ) : (
            <div className="mt-4 flex flex-col gap-2">
              {incompleteReviews.length > 1 && (
                <button
                  onClick={issueRecoveryAll}
                  disabled={issuingAll}
                  className="flex items-center justify-between rounded-xl border border-accent bg-accent-soft px-4 py-3 text-left hover:border-accent"
                >
                  <span className="text-sm font-bold text-accent-ink">전체 {incompleteReviews.length}개 한 번에 연결</span>
                  <span className="text-xs font-bold text-accent-ink">{issuingAll ? '발급 중...' : '코드 발급'}</span>
                </button>
              )}
              {incompleteReviews.map((review) => (
                <button
                  key={review.assignment_id}
                  onClick={() => issueRecovery(review)}
                  className="flex items-center justify-between rounded-xl border border-line px-4 py-3 text-left hover:border-accent"
                >
                  <span>
                    <span className="block text-sm font-bold text-ink">{review.exam_title}</span>
                    <span className="text-xs text-ink-soft">{review.answered}/{review.total}문항 진행</span>
                  </span>
                  <span className="text-xs font-bold text-accent-ink">코드 발급</span>
                </button>
              ))}
            </div>
          )}
        </Card>
      </div>}
    </div>
  );
}
