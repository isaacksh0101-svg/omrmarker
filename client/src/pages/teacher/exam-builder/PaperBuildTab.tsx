import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../../../api/client';
import type { Question } from '../../../types';
import { Button } from '../../../components/Button';
import { IconGrip } from '../../../components/icons';

interface Props {
  examId: number;
  questions: Question[];
  onChanged: () => void;
}

function typeLabel(q: Question) {
  if (q.type === 'short') return '단답형';
  return `객관식(${q.choices.length}지선다)`;
}

export function PaperBuildTab({ examId, questions, onChanged }: Props) {
  const [mc4, setMc4] = useState('');
  const [mc5, setMc5] = useState('');
  const [short, setShort] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const [order, setOrder] = useState<number[]>(questions.map((q) => q.id));
  useEffect(() => setOrder(questions.map((q) => q.id)), [questions]);
  const dragId = useRef<number | null>(null);

  const byId = new Map(questions.map((q) => [q.id, q]));

  async function createBatch() {
    const body = { mc4: Number(mc4) || 0, mc5: Number(mc5) || 0, short: Number(short) || 0 };
    if (body.mc4 + body.mc5 + body.short === 0) {
      setError('만들 문항 수를 1개 이상 입력해주세요.');
      return;
    }
    setError(null);
    setCreating(true);
    try {
      await api.post(`/exams/${examId}/questions/batch`, body);
      setMc4('');
      setMc5('');
      setShort('');
      onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '문항 생성 중 오류가 발생했습니다.');
    } finally {
      setCreating(false);
    }
  }

  async function deleteQuestion(id: number) {
    if (!confirm('이 문항을 삭제할까요?')) return;
    await api.delete(`/exams/${examId}/questions/${id}`);
    onChanged();
  }

  function onDragOver(e: React.DragEvent, overId: number) {
    e.preventDefault();
    if (dragId.current === null || dragId.current === overId) return;
    setOrder((prev) => {
      const next = [...prev];
      const from = next.indexOf(dragId.current!);
      const to = next.indexOf(overId);
      next.splice(from, 1);
      next.splice(to, 0, dragId.current!);
      return next;
    });
  }

  async function onDrop() {
    if (dragId.current === null) return;
    dragId.current = null;
    await api.put(`/exams/${examId}/questions/reorder`, { order });
    onChanged();
  }

  return (
    <div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-bold text-ink-soft">객관식 4지선다 수</span>
          <input
            type="number"
            min={0}
            className="w-24 rounded-xl border border-line bg-bg px-3 py-2 text-sm text-ink outline-none focus:border-accent"
            value={mc4}
            onChange={(e) => setMc4(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-bold text-ink-soft">객관식 5지선다 수</span>
          <input
            type="number"
            min={0}
            className="w-24 rounded-xl border border-line bg-bg px-3 py-2 text-sm text-ink outline-none focus:border-accent"
            value={mc5}
            onChange={(e) => setMc5(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-bold text-ink-soft">단답형 수</span>
          <input
            type="number"
            min={0}
            className="w-24 rounded-xl border border-line bg-bg px-3 py-2 text-sm text-ink outline-none focus:border-accent"
            value={short}
            onChange={(e) => setShort(e.target.value)}
          />
        </label>
        <Button disabled={creating} onClick={createBatch}>
          생성
        </Button>
      </div>
      {error && <p className="mt-2 text-xs font-bold text-danger">{error}</p>}

      <div className="mt-5 flex flex-col gap-2">
        {order.map((id, i) => {
          const q = byId.get(id);
          if (!q) return null;
          return (
            <div
              key={id}
              draggable
              onDragStart={() => (dragId.current = id)}
              onDragOver={(e) => onDragOver(e, id)}
              onDrop={onDrop}
              className="flex items-center gap-3 rounded-xl border border-line bg-bg px-3 py-2.5"
            >
              <IconGrip className="h-5 w-5 shrink-0 cursor-grab text-ink-soft" />
              <span className="w-8 shrink-0 text-sm font-bold text-ink-soft">{i + 1}.</span>
              <span className="flex-1 text-sm text-ink">{typeLabel(q)}</span>
              <button
                className="text-xs text-ink-soft hover:text-danger"
                onClick={() => deleteQuestion(id)}
              >
                삭제
              </button>
            </div>
          );
        })}
        {order.length === 0 && <p className="text-sm text-ink-soft">위에서 문항 수를 입력하고 생성해주세요.</p>}
      </div>
    </div>
  );
}
