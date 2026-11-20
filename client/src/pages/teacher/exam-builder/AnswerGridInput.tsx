import { Fragment, useRef, useState } from 'react';
import { api } from '../../../api/client';
import type { Question } from '../../../types';
import { KeywordRubricEditor } from './KeywordRubricEditor';
import { QuestionKindSelect } from './QuestionKindSelect';

interface CellProps {
  examId: number;
  question: Question;
  isInvalid: boolean;
  onChanged: () => void;
  inputRef: (el: HTMLInputElement | null) => void;
  onEnter: () => void;
  rubricOpen: boolean;
  onToggleRubric: () => void;
}

function correctNumbersText(question: Question) {
  return question.choices
    .map((c, i) => (c.is_correct ? String(i + 1) : null))
    .filter(Boolean)
    .join(', ');
}

// "2, 4" / "2 4" 처럼 적은 정답 번호들을 읽는다. 범위를 벗어난 번호가 하나라도 있으면 null.
function parseMcNumbers(value: string, choiceCount: number) {
  const numbers = [...new Set(value.split(/[,\s]+/).filter(Boolean).map(Number))];
  if (numbers.length === 0 || numbers.some((n) => !Number.isInteger(n) || n < 1 || n > choiceCount)) return null;
  return numbers;
}

function AnswerInput({
  examId,
  question,
  isInvalid,
  onChanged,
  inputRef,
  onEnter,
  rubricOpen,
  onToggleRubric,
}: CellProps) {
  const [mcNumber, setMcNumber] = useState(correctNumbersText(question));
  const [shortAnswer, setShortAnswer] = useState((question.correct_short_answers ?? []).join(' | '));

  async function saveMcNumber() {
    const numbers = parseMcNumbers(mcNumber, question.choices.length);
    if (!numbers) return;
    const choices = question.choices.map((c, i) => ({ text: c.text, is_correct: numbers.includes(i + 1) }));
    await api.put(`/exams/${examId}/questions/${question.id}/choices`, { choices });
    // 정답을 여러 개 적었다면 "모두 고르기" 문항이라는 뜻이다(복수정답 인정은 지원하지 않음).
    if (numbers.length > 1 && !question.multi_select) {
      await api.put(`/exams/${examId}/questions/${question.id}`, { multi_select: true });
    }
    onChanged();
  }

  // 복수 인정 답안은 | 로 구분한다. 쉼표는 "8, 1.7"처럼 소문항 답을 순서대로 묶은 정답에
  // 쓰이므로 답의 일부로 그대로 둔다(채점할 때 쉼표 앞뒤 띄어쓰기는 무시된다).
  async function saveShortAnswer() {
    const answers = shortAnswer
      .split('|')
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

  if (question.type === 'short' && question.grading_mode === 'keyword') {
    // 서술형은 한 칸에 적을 수 없어 아래 펼침 행에서 채점 기준을 편집한다.
    const count = question.keyword_rubric.length;
    return (
      <button
        type="button"
        title={isInvalid ? '서술형 채점 키워드가 설정되지 않았습니다.' : undefined}
        className="h-9 w-full px-3 text-center text-xs font-bold text-accent hover:bg-accent-soft"
        onClick={onToggleRubric}
      >
        {count > 0 ? `핵심 내용 ${count}개` : question.open_answer ? '키워드 (선택)' : '채점 키워드 입력'}{' '}
        {rubricOpen ? '▲' : '▼'}
      </button>
    );
  }

  return question.type === 'mc' ? (
    <input
      ref={inputRef}
      placeholder={question.multi_select ? '예: 2, 4' : `정답 번호(1~${question.choices.length || '?'})`}
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
      placeholder={question.open_answer ? '예시 정답 (비워 둬도 됨)' : '정답 (여러 개 인정: 5 | 5개)'}
      title={
        isInvalid
          ? '정답이 설정되지 않았습니다.'
          : '여러 답을 인정하려면 | 로 구분하세요. 소문항 답은 "8, 1.7"처럼 쉼표로 묶어 하나의 정답으로 적습니다.'
      }
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

interface OptionProps {
  examId: number;
  question: Question;
  onChanged: () => void;
  onEssayEnabled: () => void;
}

// 문항 유형(객관식/단답형/서술형)과, 객관식이면 "모두 고르기", 단답형·서술형이면 "교사 직접 채점" 옵션.
function QuestionOption({ examId, question, onChanged, onEssayEnabled }: OptionProps) {
  async function toggleMultiSelect(next: boolean) {
    await api.put(`/exams/${examId}/questions/${question.id}`, { multi_select: next });
    onChanged();
  }
  async function toggleOpenAnswer(next: boolean) {
    await api.put(`/exams/${examId}/questions/${question.id}`, { open_answer: next });
    onChanged();
  }
  const isShortOrEssay = question.type === 'short';
  const isEssay = isShortOrEssay && question.grading_mode === 'keyword';
  return (
    <div className="flex items-center justify-center gap-2 px-2 py-1">
      <QuestionKindSelect
        examId={examId}
        question={question}
        onChanged={onChanged}
        onKindChanged={(kind) => kind === 'essay' && onEssayEnabled()}
      />
      {question.type === 'mc' && (
        <label
          className="flex cursor-pointer items-center gap-1 text-[11px] font-bold text-ink-soft"
          title="옳은 것을 모두 고르는 문항 - 정답 번호를 쉼표로 여러 개 적고, 학생은 전부 맞게 골라야 정답"
        >
          <input
            type="checkbox"
            className="h-4 w-4 accent-accent"
            checked={question.multi_select}
            onChange={(e) => toggleMultiSelect(e.target.checked)}
          />
          모두 고르기
        </label>
      )}
      {isShortOrEssay && (
        <label
          className="flex cursor-pointer items-center gap-1 whitespace-nowrap text-[11px] font-bold text-ink-soft"
          title={
            isEssay
              ? "선생님이 점수를 직접 주는 서술형 - 키워드 자동 채점 점수는 확정하지 않고 결과 화면 '답안 확인'에서 학생 답을 보고 점수를 줍니다. 키워드는 제안 점수용이라 비워 둬도 됩니다. 그동안 학생 결과에는 '선생님 확인 후 확정'으로 보입니다."
              : "선생님이 직접 정답/오답을 정하는 단답형 - 적어 둔 정답과 같은 답은 바로 정답, 다른 답은 결과 화면 '답안 확인'에서 학생 답을 보고 정합니다. 그동안 학생 결과에는 '선생님 확인 후 확정'으로 보입니다."
          }
        >
          <input
            type="checkbox"
            className="h-4 w-4 accent-accent"
            checked={question.open_answer}
            onChange={(e) => toggleOpenAnswer(e.target.checked)}
          />
          교사 직접 채점
        </label>
      )}
    </div>
  );
}

// 문제 내용과 상관없이 정답만 순서대로 빠르게 입력하는 엑셀 스타일 표. "문항 번호" · "정답"
// 두 열로 된 실제 엑셀 답안지와 같은 모양을 그대로 따른다. 교사가 이미 정답지를 들고 있는
// 상황을 전제로 한다 - 문항 바로 아래에 정답을 넣을 필요가 없다는 피드백에 따라 온라인/종이
// 두 모드 모두 이 컴포넌트 하나로 정답 입력을 처리한다.
export function AnswerGridInput({ examId, questions, missingByQuestion, onChanged }: Props) {
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const [openRubricId, setOpenRubricId] = useState<number | null>(null);

  // 서술형 행은 입력칸이 없으므로 건너뛰고 다음 입력칸으로 간다.
  function focusNext(index: number) {
    const el = inputRefs.current.slice(index + 1).find(Boolean);
    if (el) {
      el.focus();
      el.select();
    }
  }

  if (questions.length === 0) {
    return <p className="text-sm text-ink-soft">아직 문항이 없습니다.</p>;
  }

  return (
    <div className="mx-auto max-w-lg overflow-hidden rounded-xl border border-line">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="bg-surface-container">
            <th className="border-b border-line px-3 py-2 text-center text-xs font-bold text-ink-soft">문항 번호</th>
            <th className="border-b border-line px-3 py-2 text-center text-xs font-bold text-ink-soft">정답</th>
            <th
              className="w-52 border-b border-l border-line px-2 py-2 text-center text-xs font-bold text-ink-soft"
              title="서술형은 교사가 정한 핵심 키워드가 답에 들어 있는 만큼 부분 점수를 줍니다"
            >
              유형 · 옵션
            </th>
          </tr>
        </thead>
        <tbody>
          {questions.map((q, i) => {
            const isInvalid = !!missingByQuestion?.get(q.id);
            const isEssay = q.type === 'short' && q.grading_mode === 'keyword';
            const rubricOpen = isEssay && openRubricId === q.id;
            return (
              <Fragment key={q.id}>
                <tr className={i > 0 ? 'border-t border-line' : ''}>
                  <td className="px-3 py-1.5 text-center font-bold text-ink">{q.order_index + 1}</td>
                  <td className={`border-l p-0 ${isInvalid ? 'border-danger bg-danger/5' : 'border-line'}`}>
                    <AnswerInput
                      // 문항 유형이 바뀌면 입력칸 상태를 새로 시작한다.
                      key={`${q.type}-${q.grading_mode}`}
                      examId={examId}
                      question={q}
                      isInvalid={isInvalid}
                      onChanged={onChanged}
                      inputRef={(el) => {
                        inputRefs.current[i] = el;
                      }}
                      onEnter={() => focusNext(i)}
                      rubricOpen={rubricOpen}
                      onToggleRubric={() => setOpenRubricId(rubricOpen ? null : q.id)}
                    />
                  </td>
                  <td className="border-l border-line text-center align-middle">
                    <QuestionOption
                      examId={examId}
                      question={q}
                      onChanged={onChanged}
                      onEssayEnabled={() => setOpenRubricId(q.id)}
                    />
                  </td>
                </tr>
                {rubricOpen && (
                  <tr className="border-t border-line">
                    <td colSpan={3} className="p-0">
                      <KeywordRubricEditor examId={examId} question={q} onChanged={onChanged} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
