import { MathText } from './MathText';

interface ChoiceLike {
  id: number;
  text: string;
}

// 보기 문구가 비어 있거나 자기 번호("1", "2"...)뿐이면 실제 내용이 없는 자리표시다 - 이미지에
// 보기가 이미 들어 있는 문항이나 종이 마킹 문항은 서버가 보기를 번호로만 만들어 둔다.
export function isPlaceholderChoiceText(text: string, index: number) {
  const trimmed = text.trim();
  return !trimmed || trimmed === String(index + 1);
}

export function hasChoiceText(choices: ChoiceLike[]) {
  return choices.some((c, i) => !isPlaceholderChoiceText(c.text, i));
}

export function toggleChoiceSelection(selectedIds: number[], choiceId: number, multiSelect: boolean) {
  if (!multiSelect) return [choiceId];
  return selectedIds.includes(choiceId) ? selectedIds.filter((id) => id !== choiceId) : [...selectedIds, choiceId];
}

// 학생 화면 본문(문제 아래)에 종이 시험지처럼 번호와 보기 문구를 나열한다. 보기가 길어도
// 본문이라 스크롤로 읽을 수 있고, 고르는 건 떠 있는 답안 패널의 번호 버튼에서만 한다.
export function ChoiceTextList({ choices }: { choices: ChoiceLike[] }) {
  if (!hasChoiceText(choices)) return null;
  return (
    <ol className="mt-6 flex max-w-2xl flex-col gap-3">
      {choices.map((c, i) => (
        <li key={c.id} className="flex items-start gap-3 text-lg text-ink">
          <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-ink-soft/50 text-sm font-bold">
            {i + 1}
          </span>
          <span className="min-w-0 whitespace-pre-wrap">
            {isPlaceholderChoiceText(c.text, i) ? '' : <MathText text={c.text} />}
          </span>
        </li>
      ))}
    </ol>
  );
}

interface PickerProps {
  choices: ChoiceLike[];
  selectedIds: number[];
  multiSelect: boolean;
  onChange: (next: number[]) => void;
}

// 답안 패널의 번호 버튼. 보기 문구 길이와 상관없이 패널 크기가 일정하도록 항상 번호만 둔다.
export function ChoiceNumberPicker({ choices, selectedIds, multiSelect, onChange }: PickerProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {multiSelect && (
        <span className="w-full text-sm font-bold text-accent-ink">정답을 모두 고르세요</span>
      )}
      {choices.map((c, i) => {
        const selected = selectedIds.includes(c.id);
        return (
          <button
            key={c.id}
            aria-pressed={selected}
            className={`h-11 w-11 border text-base font-bold transition-all duration-150 ${
              multiSelect ? 'rounded-xl' : 'rounded-full'
            } ${
              selected
                ? 'border-accent bg-accent-soft text-accent-ink'
                : 'border-line bg-panel text-ink hover:border-accent/50'
            }`}
            onClick={() => onChange(toggleChoiceSelection(selectedIds, c.id, multiSelect))}
          >
            {i + 1}
          </button>
        );
      })}
    </div>
  );
}
