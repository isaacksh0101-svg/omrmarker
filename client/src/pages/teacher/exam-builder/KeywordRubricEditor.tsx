import { useState } from 'react';
import { api } from '../../../api/client';
import type { KeywordGroup, Question } from '../../../types';
import { formatPoints, previewKeywordGrade } from '../../../lib/keywordGrading';

interface Props {
  examId: number;
  question: Question;
  onChanged: () => void;
}

interface DraftGroup {
  keywordsText: string;
  weight: number;
}

function toDraft(rubric: KeywordGroup[]): DraftGroup[] {
  return rubric.length > 0
    ? rubric.map((g) => ({ keywordsText: g.keywords.join(', '), weight: g.weight }))
    : [{ keywordsText: '', weight: 1 }];
}

function toRubric(groups: DraftGroup[]): KeywordGroup[] {
  return groups
    .map((g) => ({
      keywords: g.keywordsText.split(',').map((k) => k.trim()).filter(Boolean),
      weight: g.weight > 0 ? g.weight : 1,
    }))
    .filter((g) => g.keywords.length > 0);
}

// 서술형 문항의 채점 기준 편집기. 한 줄이 하나의 "핵심 내용"이고, 같은 뜻의 표현은 쉼표로
// 여러 개 적는다. 학생 답에 그 줄의 표현 중 하나라도 있으면 그 줄의 비중만큼 점수를 받는다.
export function KeywordRubricEditor({ examId, question, onChanged }: Props) {
  const [groups, setGroups] = useState<DraftGroup[]>(() => toDraft(question.keyword_rubric));
  const [sample, setSample] = useState('');
  const [saving, setSaving] = useState(false);

  async function save(next: DraftGroup[]) {
    setGroups(next);
    setSaving(true);
    try {
      await api.put(`/exams/${examId}/questions/${question.id}/keyword-grading`, {
        grading_mode: 'keyword',
        keyword_rubric: toRubric(next),
      });
      onChanged();
    } finally {
      setSaving(false);
    }
  }

  function update(i: number, patch: Partial<DraftGroup>) {
    setGroups(groups.map((g, idx) => (idx === i ? { ...g, ...patch } : g)));
  }

  const rubric = toRubric(groups);
  const totalWeight = rubric.reduce((sum, g) => sum + g.weight, 0);
  const preview = sample.trim() ? previewKeywordGrade(rubric, sample) : null;

  return (
    <div className="flex flex-col gap-2 bg-bg px-3 py-3 text-left">
      <p className="text-[11px] leading-relaxed text-ink-soft">
        한 줄에 핵심 내용 하나씩 적고, 같은 뜻의 표현은 쉼표로 구분하세요. 학생 답에 그 줄의 표현이 하나라도
        있으면 비중만큼 점수를 줍니다(띄어쓰기 무시). 모든 줄을 맞혀야 정답으로 처리됩니다.
      </p>
      {groups.map((g, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <span className="w-4 shrink-0 text-[11px] font-bold text-ink-soft">{i + 1}</span>
          <input
            className="h-8 min-w-0 flex-1 rounded-lg border border-line bg-panel px-2 text-sm text-ink outline-none focus:border-accent"
            placeholder="예: 이산화탄소, 이산화 탄소, CO2"
            value={g.keywordsText}
            onChange={(e) => update(i, { keywordsText: e.target.value })}
            onBlur={() => save(groups)}
          />
          <input
            type="number"
            min={0.5}
            step={0.5}
            aria-label={`${i + 1}번째 핵심 내용 비중`}
            title="비중 - 다른 줄보다 중요한 내용이면 크게 주세요"
            className="h-8 w-14 shrink-0 rounded-lg border border-line bg-panel px-1.5 text-center text-sm text-ink outline-none focus:border-accent"
            value={g.weight}
            onChange={(e) => update(i, { weight: Number(e.target.value) })}
            onBlur={() => save(groups)}
          />
          <span className="w-12 shrink-0 text-right text-[11px] text-ink-soft">
            {totalWeight > 0 && g.keywordsText.trim()
              ? `${formatPoints((question.points * (g.weight > 0 ? g.weight : 1)) / totalWeight)}점`
              : ''}
          </span>
          <button
            aria-label={`${i + 1}번째 핵심 내용 삭제`}
            className="shrink-0 px-1 text-xs text-ink-soft hover:text-danger disabled:opacity-30"
            disabled={groups.length <= 1}
            onClick={() => save(groups.filter((_, idx) => idx !== i))}
          >
            ✕
          </button>
        </div>
      ))}
      <div className="flex items-center justify-between">
        <button
          className="text-xs font-bold text-accent"
          onClick={() => setGroups([...groups, { keywordsText: '', weight: 1 }])}
        >
          + 핵심 내용 추가
        </button>
        {saving && <span className="text-[11px] text-ink-soft">저장 중...</span>}
      </div>

      <details className="mt-1">
        <summary className="cursor-pointer text-xs font-bold text-ink-soft">예시 답안으로 채점 확인</summary>
        <textarea
          rows={2}
          className="mt-2 w-full resize-none rounded-lg border border-line bg-panel px-2 py-1.5 text-sm text-ink outline-none focus:border-accent"
          placeholder="학생이 쓸 법한 답을 적어보세요"
          value={sample}
          onChange={(e) => setSample(e.target.value)}
        />
        {preview && (
          <div className="mt-1 flex flex-col gap-0.5 text-[11px]">
            {preview.groups.map((g, i) => (
              <span key={i} className={g.matched ? 'text-good' : 'text-danger'}>
                {g.matched ? '✓' : '✗'} {g.keywords[0]}
                {g.matched && g.matched !== g.keywords[0] ? ` ("${g.matched}"로 인정)` : ''}
              </span>
            ))}
            <span className="font-bold text-ink">
              → {formatPoints(question.points * preview.ratio)} / {formatPoints(question.points)}점
              {preview.ratio === 1 ? ' (정답)' : ''}
            </span>
          </div>
        )}
      </details>
    </div>
  );
}
