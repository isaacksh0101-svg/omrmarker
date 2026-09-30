import type { KeywordGroup } from '../types';

// server/src/services/keywordGrading.js와 같은 규칙 - 교사가 채점 기준을 만들면서 예시 답안으로
// 미리 확인해볼 때만 쓴다. 실제 채점은 항상 서버가 한다.
export function normalizeForKeyword(text: string) {
  return text.toLowerCase().replace(/\s+/g, '');
}

export function previewKeywordGrade(rubric: KeywordGroup[], answer: string) {
  const normalized = normalizeForKeyword(answer);
  const groups = rubric.map((group) => ({
    ...group,
    matched: group.keywords.find((k) => normalized.includes(normalizeForKeyword(k))) ?? null,
  }));
  const total = groups.reduce((sum, g) => sum + g.weight, 0);
  const matched = groups.reduce((sum, g) => sum + (g.matched != null ? g.weight : 0), 0);
  return { groups, ratio: total > 0 ? matched / total : 0 };
}

export function formatPoints(value: number) {
  return String(Math.round(value * 100) / 100);
}
