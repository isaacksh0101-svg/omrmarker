// 서술형(키워드 채점) 문항의 채점 규칙.
//
// 채점 기준은 "키워드 그룹" 목록이다. 한 그룹은 같은 뜻의 표현(동의어) 여러 개와 가중치를
// 가지며, 학생 답안에 그룹의 표현 중 하나라도 들어 있으면 그 그룹을 맞힌 것으로 본다.
// 띄어쓰기와 대소문자는 무시하고 부분 문자열로 찾는다 - "광합성을 한다"처럼 조사·어미가
// 붙어도 "광합성"을 찾을 수 있게 하려는 것이다. 대신 "광합성이 아니다" 같은 부정문도
// 맞힌 것으로 잡히므로, 자동 채점은 초안이고 교사가 결과 화면에서 고칠 수 있게 한다.

const MAX_GROUPS = 20;
const MAX_KEYWORDS_PER_GROUP = 20;
const MAX_KEYWORD_LENGTH = 100;

// 키워드가 들어 있어도 뜻이 뒤집혔을 수 있는 표현 - 교사 검토가 필요한 답안을 골라내는 데만 쓴다.
const NEGATION_HINTS = ['아니', '않', '없', '못'];

export function normalizeForKeyword(text) {
  return String(text ?? '').toLowerCase().replace(/\s+/g, '');
}

// 교사가 보낸 채점 기준을 저장 가능한 모양으로 다듬는다. 빈 표현/빈 그룹은 버린다.
export function sanitizeKeywordRubric(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, MAX_GROUPS)
    .map((group) => {
      const keywords = [
        ...new Set(
          (Array.isArray(group?.keywords) ? group.keywords : [])
            .filter((k) => typeof k === 'string')
            .map((k) => k.trim().slice(0, MAX_KEYWORD_LENGTH))
            .filter((k) => normalizeForKeyword(k)),
        ),
      ].slice(0, MAX_KEYWORDS_PER_GROUP);
      const weight = Number(group?.weight);
      return { keywords, weight: Number.isFinite(weight) && weight > 0 ? weight : 1 };
    })
    .filter((group) => group.keywords.length > 0);
}

export function parseKeywordRubric(json) {
  if (!json) return [];
  try {
    return sanitizeKeywordRubric(JSON.parse(json));
  } catch {
    return [];
  }
}

// 그룹마다 답안에서 찾은 표현(없으면 null)과 전체 대비 맞힌 가중치 비율을 돌려준다.
export function gradeKeywordAnswer(rubric, answerText) {
  const answer = normalizeForKeyword(answerText);
  const groups = rubric.map((group) => ({
    ...group,
    matched: group.keywords.find((k) => answer.includes(normalizeForKeyword(k))) ?? null,
  }));
  const totalWeight = groups.reduce((sum, g) => sum + g.weight, 0);
  const matchedWeight = groups.reduce((sum, g) => sum + (g.matched != null ? g.weight : 0), 0);
  const ratio = totalWeight > 0 ? matchedWeight / totalWeight : 0;
  return { groups, ratio };
}

export function keywordAwardedPoints(points, ratio) {
  return Math.round(points * ratio * 100) / 100;
}

// 부분 점수를 받았거나, 점수는 받았는데 부정 표현이 섞인 답안은 교사가 한 번 봐야 한다.
export function keywordAnswerNeedsReview(ratio, answerText) {
  if (ratio > 0 && ratio < 1) return true;
  return ratio > 0 && NEGATION_HINTS.some((hint) => String(answerText ?? '').includes(hint));
}
