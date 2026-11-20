import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../../../api/client';
import type { Question, StandardOption } from '../../../types';
import { Badge } from '../../../components/Badge';
import { Button } from '../../../components/Button';
import { IconGrip } from '../../../components/icons';
import { AiUploadPanel } from './AiUploadPanel';
import { StandardsPicker } from './StandardsPicker';

interface Props {
  examId: number;
  questions: Question[];
  standardOptions: StandardOption[];
  missingByQuestion: Map<number, string[]>;
  onChanged: () => void;
}

// 종이 시험지 모드에서 학생 화면에 보여줄 텍스트 설명(선택). 문제 사진은 학생 화면에 보내지 않지만
// 여기 적은 글은 답 입력칸 위에 보인다. 칸을 벗어나면 저장한다. 사진이 있는 문항(AI로 불러온 문항 등)은
// AI가 뽑은 문제 전문이 들어 있을 수 있어 "학생 화면에 보이기"를 켠 경우에만 보인다.
function PaperPromptInput({ examId, question, onChanged }: { examId: number; question: Question; onChanged: () => void }) {
  const [value, setValue] = useState(question.prompt);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setValue(question.prompt), [question.prompt]);
  const hasImage = !!question.prompt_image_path;
  const visibleToStudent = !!value.trim() && (!hasImage || question.show_prompt_text);

  async function setShowPromptText(next: boolean) {
    setError(null);
    try {
      await api.put(`/exams/${examId}/questions/${question.id}`, { show_prompt_text: next });
      onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '저장 중 오류가 발생했습니다.');
    }
  }

  async function save() {
    if (value === question.prompt) return;
    setSaving(true);
    setError(null);
    try {
      await api.put(`/exams/${examId}/questions/${question.id}`, { prompt: value });
      onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '저장 중 오류가 발생했습니다.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-2">
      <textarea
        value={value}
        rows={value.includes('\n') ? 3 : 1}
        disabled={saving}
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
        placeholder="학생 화면에 보일 설명 (선택) - 예: 그래프는 시험지 2쪽을 보세요"
        className="w-full resize-y rounded-lg border border-line bg-panel px-2.5 py-1.5 text-sm text-ink outline-none focus:border-accent"
      />
      <div className="mt-1 flex flex-wrap items-center gap-3 text-[11px]">
        {hasImage && (
          <label className="flex items-center gap-1.5 font-bold text-ink-soft">
            <input
              type="checkbox"
              checked={question.show_prompt_text}
              onChange={(e) => setShowPromptText(e.target.checked)}
            />
            학생 화면에 이 설명 보이기
          </label>
        )}
        {value.trim() && (
          <span className={visibleToStudent ? 'text-accent' : 'text-ink-soft'}>
            {visibleToStudent ? '학생 화면에 보여요' : '학생 화면에는 안 보여요 (문제 사진도 안 보여요)'}
          </span>
        )}
      </div>
      {error && <p className="mt-1 text-xs font-bold text-danger">{error}</p>}
    </div>
  );
}

function typeLabel(q: Question) {
  if (q.type === 'short') return '단답형';
  return `객관식(${q.choices.length}지선다)`;
}

export function PaperBuildTab({ examId, questions, standardOptions, missingByQuestion, onChanged }: Props) {
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

  async function saveStandards(qid: number, codes: string[]) {
    await api.put(`/exams/${examId}/questions/${qid}/standards`, { codes });
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
      <AiUploadPanel examId={examId} onExtracted={onChanged} />

      <p className="mt-5 text-xs font-bold text-ink-soft">또는 문항 수를 직접 입력해서 틀만 만들기</p>
      <div className="mt-2 flex flex-wrap items-end gap-3">
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
          const missingReasons = missingByQuestion.get(id);
          return (
            <div
              key={id}
              draggable
              onDragStart={(e) => {
                // 설명 칸에서 글자를 드래그로 고르다가 문항 순서 끌기가 시작되지 않게 한다.
                if ((e.target as HTMLElement).closest?.('textarea, input')) {
                  e.preventDefault();
                  return;
                }
                dragId.current = id;
              }}
              onDragOver={(e) => onDragOver(e, id)}
              onDrop={onDrop}
              className={`rounded-xl border px-3 py-2.5 ${missingReasons ? 'border-danger' : 'border-line'} bg-bg`}
            >
              <div className="flex items-center gap-3">
                <IconGrip className="h-5 w-5 shrink-0 cursor-grab text-ink-soft" />
                <span className="w-8 shrink-0 text-sm font-bold text-ink-soft">{i + 1}.</span>
                <span className="flex-1 text-sm text-ink">{typeLabel(q)}</span>
                {q.ai_suggested && <Badge tone="warn">AI 추출 - 확인 필요</Badge>}
                <button
                  className="text-xs text-ink-soft hover:text-danger"
                  onClick={() => deleteQuestion(id)}
                >
                  삭제
                </button>
              </div>
              <PaperPromptInput examId={examId} question={q} onChanged={onChanged} />
              <div className="mt-2">
                <StandardsPicker
                  options={standardOptions}
                  selectedCodes={q.standards.map((s) => s.standard_code)}
                  onChange={(codes) => saveStandards(id, codes)}
                />
              </div>
              {missingReasons && (
                <p className="mt-1.5 text-xs font-bold text-danger">{missingReasons.join(', ')}</p>
              )}
            </div>
          );
        })}
        {order.length === 0 && <p className="text-sm text-ink-soft">위에서 문항 수를 입력하고 생성해주세요.</p>}
      </div>
    </div>
  );
}
