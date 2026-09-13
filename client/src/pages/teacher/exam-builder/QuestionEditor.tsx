import { useState } from 'react';
import { api } from '../../../api/client';
import type { Question, StandardOption } from '../../../types';
import { Card } from '../../../components/Card';
import { Badge } from '../../../components/Badge';
import { StandardsPicker } from './StandardsPicker';

interface Props {
  examId: number;
  question: Question;
  index: number;
  standardOptions: StandardOption[];
  missingReasons?: string[];
  onChanged: () => void;
}

// 온라인 응시 모드 전용 - 문제 내용/보기 텍스트/배점/성취기준만 다룬다. 정답 표시는
// 별도 "정답 입력" 그리드(AnswerGridInput)에서 한다(문항 바로 아래일 필요는 없다는 피드백).
export function QuestionEditor({ examId, question, index, standardOptions, missingReasons, onChanged }: Props) {
  const [prompt, setPrompt] = useState(question.prompt);
  const [points, setPoints] = useState(question.points);
  const [choices, setChoices] = useState(
    question.choices.length > 0
      ? question.choices.map((c) => ({ text: c.text, is_correct: c.is_correct }))
      : [
          { text: '', is_correct: false },
          { text: '', is_correct: false },
        ],
  );
  const [savingField, setSavingField] = useState<string | null>(null);

  const dirty = prompt !== question.prompt || points !== question.points;

  async function savePromptAndPoints() {
    setSavingField('prompt');
    try {
      await api.put(`/exams/${examId}/questions/${question.id}`, { prompt, points });
      onChanged();
    } finally {
      setSavingField(null);
    }
  }

  async function saveChoices(next: typeof choices) {
    setChoices(next);
    setSavingField('choices');
    try {
      await api.put(`/exams/${examId}/questions/${question.id}/choices`, { choices: next });
      onChanged();
    } finally {
      setSavingField(null);
    }
  }

  async function saveStandards(codes: string[]) {
    setSavingField('standards');
    try {
      await api.put(`/exams/${examId}/questions/${question.id}/standards`, { codes });
      onChanged();
    } finally {
      setSavingField(null);
    }
  }

  async function deleteQuestion() {
    if (!confirm('이 문항을 삭제할까요?')) return;
    await api.delete(`/exams/${examId}/questions/${question.id}`);
    onChanged();
  }

  function updateChoiceText(i: number, text: string) {
    const next = choices.map((c, idx) => (idx === i ? { ...c, text } : c));
    setChoices(next);
  }

  function addChoiceRow() {
    setChoices([...choices, { text: '', is_correct: false }]);
  }

  function removeChoiceRow(i: number) {
    const next = choices.filter((_, idx) => idx !== i);
    saveChoices(next);
  }

  return (
    <Card className={missingReasons ? 'border-danger' : ''}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-ink-soft">{index + 1}.</span>
          <Badge tone="neutral">{question.type === 'mc' ? '객관식' : '단답형'}</Badge>
          {question.ai_suggested && <Badge tone="warn">AI 추출 - 확인 필요</Badge>}
        </div>
        <button className="text-xs text-ink-soft hover:text-danger" onClick={deleteQuestion}>
          삭제
        </button>
      </div>

      <textarea
        className="mt-3 w-full resize-none rounded-xl border border-line bg-bg px-3 py-2 text-sm text-ink outline-none focus:border-accent"
        rows={2}
        placeholder="문제 내용을 입력하세요"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onBlur={savePromptAndPoints}
      />

      <div className="mt-2 flex items-center gap-2">
        <span className="text-xs font-bold text-ink-soft">배점</span>
        <input
          type="number"
          min={0}
          step={0.5}
          className="w-20 rounded-lg border border-line bg-bg px-2 py-1 text-sm text-ink outline-none focus:border-accent"
          value={points}
          onChange={(e) => setPoints(Number(e.target.value))}
          onBlur={savePromptAndPoints}
        />
        {dirty && savingField === 'prompt' && <span className="text-xs text-ink-soft">저장 중...</span>}
      </div>

      {question.type === 'mc' && (
        <div className="mt-3 flex flex-col gap-2">
          <span className="text-xs font-bold text-ink-soft">보기 (정답 표시는 아래 "정답 입력"에서)</span>
          {choices.map((c, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="w-5 shrink-0 text-xs font-bold text-ink-soft">{i + 1}.</span>
              <input
                className="flex-1 rounded-lg border border-line bg-bg px-2 py-1 text-sm text-ink outline-none focus:border-accent"
                placeholder={`보기 ${i + 1}`}
                value={c.text}
                onChange={(e) => updateChoiceText(i, e.target.value)}
                onBlur={() => saveChoices(choices)}
              />
              {choices.length > 2 && (
                <button
                  className="text-xs text-ink-soft hover:text-danger"
                  onClick={() => removeChoiceRow(i)}
                >
                  ✕
                </button>
              )}
            </div>
          ))}
          <button className="self-start text-xs font-bold text-accent" onClick={addChoiceRow}>
            + 보기 추가
          </button>
        </div>
      )}

      <div className="mt-3">
        <StandardsPicker
          options={standardOptions}
          selectedCodes={question.standards.map((s) => s.standard_code)}
          onChange={saveStandards}
          required={question.ai_suggested}
        />
      </div>

      {missingReasons && (
        <p className="mt-2 text-xs font-bold text-danger">미완성: {missingReasons.join(', ')}</p>
      )}
    </Card>
  );
}
