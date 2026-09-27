import { lazy, Suspense, useState } from 'react';
import { api } from '../../../api/client';
import type { Question, StandardCandidate, StandardOption } from '../../../types';
import { Card } from '../../../components/Card';
import { Badge } from '../../../components/Badge';
import { MathText } from '../../../components/MathText';
import { StandardsPicker } from './StandardsPicker';

// pdfjs-dist(PDF 렌더링용, 1MB+)는 이 재크롭 모달을 실제로 열 때만 필요하다 - 학생 응시
// 화면 등 다른 페이지의 번들에 묻어가지 않도록 동적 import로 분리한다.
const RecropModal = lazy(() => import('./RecropModal').then((m) => ({ default: m.RecropModal })));

const CONFIDENCE_LABEL: Record<StandardCandidate['confidence'], string> = {
  high: '확신 높음',
  medium: '확신 보통',
  low: '확신 낮음',
};
const CONFIDENCE_TONE: Record<StandardCandidate['confidence'], 'good' | 'warn' | 'danger'> = {
  high: 'good',
  medium: 'warn',
  low: 'danger',
};

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
      : Array.from({ length: 5 }, () => ({ text: '', is_correct: false })),
  );
  const [savingField, setSavingField] = useState<string | null>(null);
  const [recropOpen, setRecropOpen] = useState(false);
  const [recropMode, setRecropMode] = useState<'replace' | 'append'>('replace');

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

  // 문항 이미지에 보기가 이미 포함된 경우: 실제 보기 내용은 텍스트로 관리할 필요가 없으니
  // 개수만 관리한다. 기존 항목의 is_correct는 유지하고, 늘어난 자리는 번호 placeholder로 채운다.
  function setChoiceCount(n: number) {
    const clamped = Math.max(2, n);
    const next = choices.slice(0, clamped);
    while (next.length < clamped) next.push({ text: String(next.length + 1), is_correct: false });
    saveChoices(next);
  }

  function addCandidateAsTag(code: string) {
    const codes = question.standards.map((s) => s.standard_code);
    if (codes.includes(code)) return;
    saveStandards([...codes, code]);
  }

  // Upstage(Solar Pro) 경로는 표·그림처럼 텍스트로 옮기기 어려운 문항에 이 표시를 남겨둔다
  // (aiExtraction.js 참고). 이미지가 이미 채워졌으면 학생 화면엔 이미지가 우선 보이므로
  // 더 이상 급하지 않다 - 그 전까지만 눈에 띄게 경고한다.
  const needsManualImage = !question.prompt_image_path && question.prompt.includes('그림 있음');

  return (
    <Card className={missingReasons ? 'border-danger' : ''}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-ink-soft">{index + 1}.</span>
          <Badge tone="neutral">{question.type === 'mc' ? '객관식' : '단답형'}</Badge>
          {question.ai_suggested && <Badge tone="warn">AI 추출 - 확인 필요</Badge>}
          {needsManualImage && <Badge tone="danger">이미지 필요</Badge>}
        </div>
        <button className="text-xs text-ink-soft hover:text-danger" onClick={deleteQuestion}>
          삭제
        </button>
      </div>

      {question.prompt_image_path && (
        <div className="mt-3">
          <img
            src={`/uploads/${question.prompt_image_path}`}
            alt={`${index + 1}번 문항 원본 이미지`}
            className="max-w-full rounded-lg border border-line"
          />
          <div className="mt-1 flex items-center justify-between gap-2">
            <p className="text-[11px] text-ink-soft">
              학생 화면엔 이 이미지가 문제 내용으로 보여집니다{question.type === 'mc' ? ' (보기도 이 안에 포함)' : ''}.
            </p>
            <div className="flex shrink-0 items-center gap-2">
              <button
                className="text-xs font-bold text-accent"
                onClick={() => {
                  setRecropMode('append');
                  setRecropOpen(true);
                }}
              >
                추가 정보 크롭하기
              </button>
              <button
                className="text-xs font-bold text-accent"
                onClick={() => {
                  setRecropMode('replace');
                  setRecropOpen(true);
                }}
              >
                다시 자르기
              </button>
            </div>
          </div>
        </div>
      )}
      {!question.prompt_image_path && question.ai_suggested && (
        <button
          className="mt-3 self-start text-xs font-bold text-accent"
          onClick={() => {
            setRecropMode('replace');
            setRecropOpen(true);
          }}
        >
          + 원본에서 이미지 잘라오기
        </button>
      )}
      {recropOpen && (
        <Suspense fallback={null}>
          <RecropModal
            examId={examId}
            questionId={question.id}
            mode={recropMode}
            existingImagePath={question.prompt_image_path}
            onClose={() => setRecropOpen(false)}
            onDone={() => {
              setRecropOpen(false);
              onChanged();
            }}
          />
        </Suspense>
      )}
      {/* 이미지가 있으면 그게 곧 문제 내용이라 텍스트를 따로 편집할 필요가 없다 - AI는
          백그라운드에서 검색/백업용 텍스트를 계속 채워두지만(추출 로직 쪽 처리), 이 편집
          화면에는 굳이 보여주지 않는다. 이미지가 없는 문항만 텍스트가 곧 문제 내용이므로 편집창을 둔다. */}
      {!question.prompt_image_path && (
        <div className="mt-3">
          <textarea
            className="w-full resize-none rounded-xl border border-line bg-bg px-3 py-2 text-sm text-ink outline-none focus:border-accent"
            rows={2}
            placeholder="문제 내용을 입력하세요"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onBlur={savePromptAndPoints}
          />
          {prompt.includes('$') && (
            <div className="mt-2 rounded-xl border border-accent/20 bg-accent-soft/40 px-3 py-2.5">
              <p className="mb-1 text-[10px] font-bold text-accent-ink">학생 화면 수식 미리보기</p>
              <p className="whitespace-pre-wrap text-sm font-bold text-ink">
                <MathText text={prompt} />
              </p>
            </div>
          )}
        </div>
      )}

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

      {question.type === 'mc' &&
        (question.prompt_image_path ? (
          // 보기 내용이 이미지 안에 그대로 보이므로(학생 화면도 번호만 토글) 텍스트로 따로
          // 관리할 게 없다 - 개수만 맞춰두면 된다. 정답 번호는 아래 "정답 입력"에서 다룬다.
          <div className="mt-3 flex items-center gap-2">
            <span className="text-xs font-bold text-ink-soft">보기 개수</span>
            <button
              className="h-7 w-7 rounded-lg border border-line text-sm font-bold text-ink-soft hover:border-accent hover:text-accent disabled:opacity-40"
              disabled={choices.length <= 2}
              onClick={() => setChoiceCount(choices.length - 1)}
            >
              -
            </button>
            <span className="w-5 text-center text-sm font-bold text-ink">{choices.length}</span>
            <button
              className="h-7 w-7 rounded-lg border border-line text-sm font-bold text-ink-soft hover:border-accent hover:text-accent"
              onClick={() => setChoiceCount(choices.length + 1)}
            >
              +
            </button>
          </div>
        ) : (
          <div className="mt-3 flex flex-col gap-2">
            <span className="text-xs font-bold text-ink-soft">보기 (정답 표시는 아래 "정답 입력"에서)</span>
            {question.ai_suggested && (
              <p className="text-[11px] font-bold text-warn">
                AI가 옮겨 적은 보기입니다 - 숫자·단위·기호가 원본과 정확히 같은지 확인해주세요.
              </p>
            )}
            {choices.map((c, i) => (
              <div key={i} className="flex items-start gap-2">
                <span className="w-5 shrink-0 text-xs font-bold text-ink-soft">{i + 1}.</span>
                <div className="min-w-0 flex-1">
                  <input
                    className="w-full rounded-lg border border-line bg-bg px-2 py-1 text-sm text-ink outline-none focus:border-accent"
                    placeholder={`보기 ${i + 1}`}
                    value={c.text}
                    onChange={(e) => updateChoiceText(i, e.target.value)}
                    onBlur={() => saveChoices(choices)}
                  />
                  {c.text.includes('$') && (
                    <p className="mt-1 rounded-lg bg-accent-soft/40 px-2 py-1.5 text-sm text-ink">
                      <MathText text={c.text} />
                    </p>
                  )}
                </div>
                {choices.length > 2 && (
                  <button className="text-xs text-ink-soft hover:text-danger" onClick={() => removeChoiceRow(i)}>
                    ✕
                  </button>
                )}
              </div>
            ))}
            <button className="self-start text-xs font-bold text-accent" onClick={addChoiceRow}>
              + 보기 추가
            </button>
          </div>
        ))}

      <div className="mt-3">
        <StandardsPicker
          options={standardOptions}
          selectedCodes={question.standards.map((s) => s.standard_code)}
          onChange={saveStandards}
        />
      </div>

      {question.ai_standard_candidates && question.ai_standard_candidates.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs font-bold text-ink-soft">
            AI 성취기준 분석 ({question.ai_standard_candidates.length}개 후보)
          </summary>
          <div className="mt-2 flex flex-col gap-2 rounded-xl border border-line bg-bg p-3">
            {question.ai_standard_candidates.map((c, i) => {
              const option = standardOptions.find((o) => o.code === c.code);
              const applied = question.standards.some((s) => s.standard_code === c.code);
              return (
                <div key={c.code} className="flex items-start gap-2 text-xs">
                  <span className="mt-0.5 shrink-0 font-bold text-ink-soft">{i + 1}순위</span>
                  <div className="flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-bold text-ink">[{c.code}]</span>
                      <Badge tone={CONFIDENCE_TONE[c.confidence]}>{CONFIDENCE_LABEL[c.confidence]}</Badge>
                      {applied && <Badge tone="neutral">태그됨</Badge>}
                    </div>
                    {option && <p className="mt-0.5 text-ink-soft">{option.statement}</p>}
                    <p className="mt-0.5 italic text-ink-soft">{c.rationale}</p>
                  </div>
                  {!applied && (
                    <button
                      className="shrink-0 font-bold text-accent hover:underline"
                      onClick={() => addCandidateAsTag(c.code)}
                    >
                      + 태그 추가
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </details>
      )}

      {missingReasons && (
        <p className="mt-2 text-xs font-bold text-danger">미완성: {missingReasons.join(', ')}</p>
      )}
    </Card>
  );
}
