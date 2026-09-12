import { useState } from 'react';
import { api } from '../../../api/client';
import type { ExamMode, Question, StandardOption } from '../../../types';
import { Card } from '../../../components/Card';
import { Badge } from '../../../components/Badge';
import { StandardsPicker } from './StandardsPicker';

const CIRCLED_DIGITS = ['①', '②', '③', '④', '⑤', '⑥'];

interface Props {
  examId: number;
  examMode: ExamMode;
  question: Question;
  index: number;
  standardOptions: StandardOption[];
  missingReasons?: string[];
  onChanged: () => void;
}

export function QuestionEditor({
  examId,
  examMode,
  question,
  index,
  standardOptions,
  missingReasons,
  onChanged,
}: Props) {
  const [prompt, setPrompt] = useState(question.prompt);
  const [points, setPoints] = useState(question.points);
  const [choices, setChoices] = useState(
    question.choices.length > 0
      ? question.choices.map((c) => ({ text: c.text, is_correct: c.is_correct }))
      : [
          { text: '', is_correct: true },
          { text: '', is_correct: false },
        ],
  );
  const [shortAnswers, setShortAnswers] = useState((question.correct_short_answers ?? []).join(', '));
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

  async function saveShortAnswers() {
    const answers = shortAnswers
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (answers.length === 0) return;
    setSavingField('answer');
    try {
      await api.put(`/exams/${examId}/questions/${question.id}/answer`, { correct_short_answers: answers });
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

  function selectCorrect(i: number) {
    const next = choices.map((c, idx) => ({ ...c, is_correct: idx === i }));
    saveChoices(next);
  }

  function addChoiceRow() {
    setChoices([...choices, { text: '', is_correct: false }]);
  }

  function removeChoiceRow(i: number) {
    const next = choices.filter((_, idx) => idx !== i);
    saveChoices(next);
  }

  function quickFillCircledChoices(count: number) {
    const correctIndex = choices.findIndex((c) => c.is_correct);
    const next = Array.from({ length: count }, (_, i) => ({
      text: CIRCLED_DIGITS[i] ?? String(i + 1),
      is_correct: i === (correctIndex >= 0 && correctIndex < count ? correctIndex : 0),
    }));
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
        placeholder={
          examMode === 'paper_marking'
            ? '문제 내용(선택, 성취기준 태깅 참고용 - 비워둬도 확정 가능)'
            : '문제 내용을 입력하세요'
        }
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

      {question.type === 'mc' ? (
        <div className="mt-3 flex flex-col gap-2">
          {examMode === 'paper_marking' && (
            <div className="flex items-center gap-2 rounded-lg bg-bg px-2 py-1.5">
              <span className="text-xs text-ink-soft">선택지 개수로 빠르게 채우기</span>
              {[4, 5].map((n) => (
                <button
                  key={n}
                  className="rounded-full border border-line px-2 py-0.5 text-xs font-bold text-ink-soft hover:border-accent hover:text-accent"
                  onClick={() => quickFillCircledChoices(n)}
                >
                  {n}지선다
                </button>
              ))}
            </div>
          )}
          {choices.map((c, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                type="radio"
                name={`correct-${question.id}`}
                checked={c.is_correct}
                onChange={() => selectCorrect(i)}
                title="정답으로 표시"
              />
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
      ) : (
        <div className="mt-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-bold text-ink-soft">
              정답(쉼표로 여러 개 인정 가능, 예: 통분, 통분하기)
            </span>
            <input
              className="rounded-lg border border-line bg-bg px-2 py-1 text-sm text-ink outline-none focus:border-accent"
              value={shortAnswers}
              onChange={(e) => setShortAnswers(e.target.value)}
              onBlur={saveShortAnswers}
            />
          </label>
        </div>
      )}

      <div className="mt-3">
        <StandardsPicker
          options={standardOptions}
          selectedCodes={question.standards.map((s) => s.standard_code)}
          onChange={saveStandards}
        />
      </div>

      {missingReasons && (
        <p className="mt-2 text-xs font-bold text-danger">미완성: {missingReasons.join(', ')}</p>
      )}
    </Card>
  );
}
