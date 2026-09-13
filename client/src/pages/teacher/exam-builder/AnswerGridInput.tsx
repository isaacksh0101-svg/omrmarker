import { useState } from 'react';
import { api } from '../../../api/client';
import type { Question } from '../../../types';
import { Badge } from '../../../components/Badge';

interface CellProps {
  examId: number;
  question: Question;
  index: number;
  missingReasons?: string[];
  onChanged: () => void;
}

function AnswerCell({ examId, question, index, missingReasons, onChanged }: CellProps) {
  const correctIndex = question.choices.findIndex((c) => c.is_correct);
  const [mcNumber, setMcNumber] = useState(correctIndex >= 0 ? String(correctIndex + 1) : '');
  const [shortAnswer, setShortAnswer] = useState((question.correct_short_answers ?? []).join(', '));

  async function saveMcNumber() {
    const n = Number(mcNumber);
    if (!Number.isInteger(n) || n < 1 || n > question.choices.length) return;
    const choices = question.choices.map((c, i) => ({ text: c.text, is_correct: i === n - 1 }));
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

  return (
    <div className={`rounded-xl border p-2.5 ${missingReasons ? 'border-danger' : 'border-line'} bg-bg`}>
      <div className="flex items-center gap-1.5">
        <span className="text-xs font-bold text-ink-soft">{index + 1}번</span>
        {question.ai_suggested && <Badge tone="warn">AI</Badge>}
      </div>

      {question.type === 'mc' ? (
        <input
          type="number"
          min={1}
          max={question.choices.length || undefined}
          placeholder={`정답 번호(1~${question.choices.length || '?'})`}
          className="mt-1.5 w-full rounded-lg border border-line bg-panel px-2 py-1 text-sm text-ink outline-none focus:border-accent"
          value={mcNumber}
          onChange={(e) => setMcNumber(e.target.value)}
          onBlur={saveMcNumber}
        />
      ) : (
        <input
          className="mt-1.5 w-full rounded-lg border border-line bg-panel px-2 py-1 text-sm text-ink outline-none focus:border-accent"
          placeholder="정답(쉼표로 여러 개 인정)"
          value={shortAnswer}
          onChange={(e) => setShortAnswer(e.target.value)}
          onBlur={saveShortAnswer}
        />
      )}

      {missingReasons && <p className="mt-1.5 text-xs font-bold text-danger">{missingReasons.join(', ')}</p>}
    </div>
  );
}

interface Props {
  examId: number;
  questions: Question[];
  missingByQuestion?: Map<number, string[]>;
  onChanged: () => void;
}

// 문제 내용과 상관없이 정답만 순서대로 빠르게 입력하는 5열 그리드. 교사가 이미 정답지를
// 들고 있는 상황을 전제로 한다 - 문항 바로 아래에 정답을 넣을 필요가 없다는 피드백에 따라
// 온라인/종이 두 모드 모두 이 컴포넌트 하나로 정답 입력을 처리한다.
export function AnswerGridInput({ examId, questions, missingByQuestion, onChanged }: Props) {
  if (questions.length === 0) {
    return <p className="text-sm text-ink-soft">아직 문항이 없습니다.</p>;
  }
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
      {questions.map((q, i) => (
        <AnswerCell
          key={q.id}
          examId={examId}
          question={q}
          index={i}
          missingReasons={missingByQuestion?.get(q.id)}
          onChanged={onChanged}
        />
      ))}
    </div>
  );
}
