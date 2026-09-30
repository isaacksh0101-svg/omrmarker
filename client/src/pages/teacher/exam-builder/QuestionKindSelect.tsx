import { useState } from 'react';
import { api, ApiError } from '../../../api/client';
import type { Question } from '../../../types';

export type QuestionKind = 'mc' | 'short' | 'essay';

export function questionKind(question: Question): QuestionKind {
  if (question.type === 'mc') return 'mc';
  return question.grading_mode === 'keyword' ? 'essay' : 'short';
}

const KIND_LABEL: Record<QuestionKind, string> = {
  mc: '객관식',
  short: '단답형',
  essay: '서술형',
};

interface Props {
  examId: number;
  question: Question;
  onChanged: () => void;
  onKindChanged?: (kind: QuestionKind) => void;
  className?: string;
}

// 문항 유형(객관식/단답형/서술형) 바꾸기. 다른 유형의 설정(보기·인정 답안·채점 키워드)은 서버가
// 지우지 않고 남겨두므로 다시 되돌리면 그대로 돌아온다. 학생이 이미 답한 문항은 서버가 막는다.
export function QuestionKindSelect({ examId, question, onChanged, onKindChanged, className = '' }: Props) {
  const [saving, setSaving] = useState(false);
  const current = questionKind(question);

  async function change(kind: QuestionKind) {
    if (kind === current) return;
    setSaving(true);
    try {
      await api.put(`/exams/${examId}/questions/${question.id}/kind`, { kind });
      onKindChanged?.(kind);
      onChanged();
    } catch (cause) {
      alert(cause instanceof ApiError ? cause.message : '문항 유형을 바꾸지 못했습니다.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <select
      aria-label={`${question.order_index + 1}번 문항 유형`}
      className={`rounded-lg border border-line bg-panel px-1.5 py-1 text-xs font-bold text-ink outline-none focus:border-accent disabled:opacity-50 ${className}`}
      value={current}
      disabled={saving}
      onChange={(e) => change(e.target.value as QuestionKind)}
    >
      {(Object.keys(KIND_LABEL) as QuestionKind[]).map((kind) => (
        <option key={kind} value={kind}>
          {KIND_LABEL[kind]}
        </option>
      ))}
    </select>
  );
}
