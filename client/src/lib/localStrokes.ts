import type { Stroke, StrokesPayload } from './strokes';

// 학생 기기에만 문항별 필기를 임시로 보관한다. 서버로 필기를 보내면 요청이 커져 "다음"이 거절되던
// 문제가 있어 서버 저장은 꺼 두었는데, 그러면 문항을 오갈 때 필기가 사라진다. 그래서 이 기기의
// 브라우저(localStorage)에 문항별로 남겨 두고, 돌아오면 다시 그린다. 새로고침이나 브라우저가 잠깐
// 꺼져도 남는다. 같은 기기를 다음 학생이 쓸 수 있으므로 시험을 마치면 지우고, 다른 응시의 필기도
// 함께 지운다.
//
// scope: 'exam'(본시험) | 'review'(오답 재풀이). token: 그 응시의 접근 토큰.

type Scope = 'exam' | 'review';
type Store = Record<string, StrokesPayload>;

const PREFIX = 'omr_strokes_';
// localStorage가 가득 차서 못 쓰는 경우에도 지금 화면이 켜져 있는 동안은 남도록 메모리에도 둔다.
const memory = new Map<string, Store>();

function storageKey(scope: Scope, token: string) {
  return `${PREFIX}${scope}_${token}`;
}

function read(scope: Scope, token: string): Store {
  const key = storageKey(scope, token);
  const cached = memory.get(key);
  if (cached) return cached;
  let store: Store = {};
  try {
    const raw = localStorage.getItem(key);
    if (raw) store = JSON.parse(raw) as Store;
  } catch {
    store = {};
  }
  memory.set(key, store);
  return store;
}

// 좌표를 소수 한 자리로 줄여 저장 크기를 줄인다(화면에서 구분되지 않는 차이).
function compact(strokes: Stroke[]): Stroke[] {
  return strokes.map((stroke) => ({
    ...stroke,
    points: stroke.points.map((pt) => ({
      x: Math.round(pt.x * 10) / 10,
      y: Math.round(pt.y * 10) / 10,
      pressure: Math.round(pt.pressure * 100) / 100,
    })),
  }));
}

export function loadLocalStrokes(scope: Scope, token: string, questionId: number): StrokesPayload | null {
  if (!token) return null;
  return read(scope, token)[String(questionId)] ?? null;
}

export function saveLocalStrokes(
  scope: Scope,
  token: string,
  questionId: number,
  strokes: Stroke[],
  size: { width: number; height: number },
) {
  if (!token || !(size.width > 0)) return;
  const key = storageKey(scope, token);
  const store = { ...read(scope, token) };
  if (strokes.length === 0) delete store[String(questionId)];
  else store[String(questionId)] = { width: size.width, height: size.height, strokes: compact(strokes) };
  memory.set(key, store);
  try {
    if (Object.keys(store).length === 0) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(store));
  } catch {
    // 저장 공간이 가득 찼다 - 메모리에는 남아 있으니 화면을 닫기 전까지는 유지된다.
  }
}

export function clearLocalStrokes(scope: Scope, token: string) {
  const key = storageKey(scope, token);
  memory.delete(key);
  try {
    localStorage.removeItem(key);
  } catch {
    // 무시
  }
}

// 이 기기에 남아 있는 다른 응시의 필기를 지운다(같은 기기를 앞서 쓴 학생 것).
export function clearOtherLocalStrokes(scope: Scope, keepToken: string) {
  const keep = storageKey(scope, keepToken);
  try {
    const stale: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key && key.startsWith(`${PREFIX}${scope}_`) && key !== keep) stale.push(key);
    }
    for (const key of stale) {
      localStorage.removeItem(key);
      memory.delete(key);
    }
  } catch {
    // 무시
  }
}
