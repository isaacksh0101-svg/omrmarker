import { useState } from 'react';
import { api } from '../../../api/client';
import type { Question, StandardOption } from '../../../types';
import { Badge } from '../../../components/Badge';
import { StandardsPicker } from './StandardsPicker';

interface RowProps {
  examId: number;
  question: Question;
  index: number;
  standardOptions: StandardOption[];
  missingReasons?: string[];
  onChanged: () => void;
}

function PaperAnswerRow({ examId, question, index, standardOptions, missingReasons, onChanged }: RowProps) {
  const [shortAnswer, setShortAnswer] = useState((question.correct_short_answers ?? []).join(', '));

  async function markCorrect(choiceId: number) {
    const choices = question.choices.map((c) => ({ text: c.text, is_correct: c.id === choiceId }));
    await api.put(`/exams/${examId}/questions/${question.id}/choices`, { choices });
    onChanged();
  }

  async function saveShortAnswer() {
    const answers = shortAnswer
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (answers.length === 0) return;
    await api.put(`/exams/${examId}/questions/${question.id}/answer`, { correct_short_answers: answers });
    onChanged();
  }

  async function saveStandards(codes: string[]) {
    await api.put(`/exams/${examId}/questions/${question.id}/standards`, { codes });
    onChanged();
  }

  return (
    <div className={`rounded-xl border px-3 py-3 ${missingReasons ? 'border-danger' : 'border-line'} bg-bg`}>
      <div className="flex items-center gap-2">
        <span className="text-sm font-bold text-ink-soft">{index + 1}.</span>
        <Badge tone="neutral">{question.type === 'mc' ? `객관식(${question.choices.length}지선다)` : '단답형'}</Badge>
      </div>

      <div className="mt-2">
        {question.type === 'mc' ? (
          <div className="flex flex-wrap gap-2">
            {question.choices.map((c) => (
              <button
                key={c.id}
                className={`h-9 w-9 rounded-full border text-sm font-bold ${
                  c.is_correct
                    ? 'border-accent bg-accent-soft text-accent-ink'
                    : 'border-line bg-panel text-ink-soft'
                }`}
                onClick={() => markCorrect(c.id)}
              >
                {c.text}
              </button>
            ))}
          </div>
        ) : (
          <input
            className="w-full rounded-lg border border-line bg-panel px-2 py-1.5 text-sm text-ink outline-none focus:border-accent"
            placeholder="정답(쉼표로 여러 개 인정 가능, 예: 30, 삼십)"
            value={shortAnswer}
            onChange={(e) => setShortAnswer(e.target.value)}
            onBlur={saveShortAnswer}
          />
        )}
      </div>

      <div className="mt-2">
        <StandardsPicker
          options={standardOptions}
          selectedCodes={question.standards.map((s) => s.standard_code)}
          onChange={saveStandards}
        />
      </div>

      {missingReasons && <p className="mt-2 text-xs font-bold text-danger">미완성: {missingReasons.join(', ')}</p>}
    </div>
  );
}

interface Props {
  examId: number;
  questions: Question[];
  standardOptions: StandardOption[];
  missingByQuestion: Map<number, string[]>;
  onChanged: () => void;
}

export function PaperAnswerTab({ examId, questions, standardOptions, missingByQuestion, onChanged }: Props) {
  if (questions.length === 0) {
    return <p className="text-sm text-ink-soft">먼저 "1. 틀 만들기" 탭에서 문항을 생성해주세요.</p>;
  }
  return (
    <div className="flex flex-col gap-3">
      {questions.map((q, i) => (
        <PaperAnswerRow
          key={q.id}
          examId={examId}
          question={q}
          index={i}
          standardOptions={standardOptions}
          missingReasons={missingByQuestion.get(q.id)}
          onChanged={onChanged}
        />
      ))}
    </div>
  );
}
