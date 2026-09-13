import { useRef, useState } from 'react';
import { api } from '../../../api/client';
import type { Question } from '../../../types';

interface CellProps {
  examId: number;
  question: Question;
  isInvalid: boolean;
  onChanged: () => void;
  inputRef: (el: HTMLInputElement | null) => void;
  onEnter: () => void;
}

function AnswerInput({ examId, question, isInvalid, onChanged, inputRef, onEnter }: CellProps) {
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

  // 엑셀처럼 엔터를 누르면 값을 저장(=blur)하고 바로 아래 칸으로 이동해 이어서 입력할 수
  // 있게 한다. 정답지를 보면서 손을 떼지 않고 쭉 입력하는 흐름을 위한 것.
  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.currentTarget.blur();
      onEnter();
    }
  }

  const inputClass =
    'h-9 w-full min-w-0 bg-transparent px-3 text-center text-sm text-ink outline-none focus:bg-accent-soft';

  return question.type === 'mc' ? (
    <input
      ref={inputRef}
      type="number"
      min={1}
      max={question.choices.length || undefined}
      placeholder={`정답 번호(1~${question.choices.length || '?'})`}
      title={isInvalid ? '정답이 설정되지 않았습니다.' : undefined}
      className={inputClass}
      value={mcNumber}
      onChange={(e) => setMcNumber(e.target.value)}
      onBlur={saveMcNumber}
      onKeyDown={handleKeyDown}
    />
  ) : (
    <input
      ref={inputRef}
      placeholder="정답"
      title={isInvalid ? '정답이 설정되지 않았습니다.' : undefined}
      className={inputClass}
      value={shortAnswer}
      onChange={(e) => setShortAnswer(e.target.value)}
      onBlur={saveShortAnswer}
      onKeyDown={handleKeyDown}
    />
  );
}

interface Props {
  examId: number;
  questions: Question[];
  missingByQuestion?: Map<number, string[]>;
  onChanged: () => void;
}

// 문제 내용과 상관없이 정답만 순서대로 빠르게 입력하는 엑셀 스타일 표. "문항 번호" · "정답"
// 두 열로 된 실제 엑셀 답안지와 같은 모양을 그대로 따른다. 교사가 이미 정답지를 들고 있는
// 상황을 전제로 한다 - 문항 바로 아래에 정답을 넣을 필요가 없다는 피드백에 따라 온라인/종이
// 두 모드 모두 이 컴포넌트 하나로 정답 입력을 처리한다.
export function AnswerGridInput({ examId, questions, missingByQuestion, onChanged }: Props) {
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  function focusNext(index: number) {
    const el = inputRefs.current[index + 1];
    if (el) {
      el.focus();
      el.select();
    }
  }

  if (questions.length === 0) {
    return <p className="text-sm text-ink-soft">아직 문항이 없습니다.</p>;
  }

  return (
    <div className="mx-auto max-w-xs overflow-hidden rounded-xl border border-line">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="bg-surface-container">
            <th className="border-b border-line px-3 py-2 text-center text-xs font-bold text-ink-soft">문항 번호</th>
            <th className="border-b border-line px-3 py-2 text-center text-xs font-bold text-ink-soft">정답</th>
          </tr>
        </thead>
        <tbody>
          {questions.map((q, i) => {
            const isInvalid = !!missingByQuestion?.get(q.id);
            return (
              <tr key={q.id} className={i > 0 ? 'border-t border-line' : ''}>
                <td className="px-3 py-1.5 text-center font-bold text-ink">{q.order_index + 1}</td>
                <td className={`border-l p-0 ${isInvalid ? 'border-danger bg-danger/5' : 'border-line'}`}>
                  <AnswerInput
                    examId={examId}
                    question={q}
                    isInvalid={isInvalid}
                    onChanged={onChanged}
                    inputRef={(el) => {
                      inputRefs.current[i] = el;
                    }}
                    onEnter={() => focusNext(i)}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
