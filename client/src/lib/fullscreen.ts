// 전체화면 API - 사파리(구버전)는 webkit 접두사를 쓰므로 감지/호출을 한 곳에 모아둔다.
// 학생 화면(시험 응시/오답 재풀이)에서 공통으로 쓴다.
export function isFullscreenSupported() {
  const doc = document as Document & { webkitFullscreenEnabled?: boolean };
  return !!(doc.fullscreenEnabled || doc.webkitFullscreenEnabled);
}

export function requestFullscreenCompat(el: HTMLElement) {
  const anyEl = el as HTMLElement & { webkitRequestFullscreen?: () => Promise<void> };
  if (el.requestFullscreen) return el.requestFullscreen();
  if (anyEl.webkitRequestFullscreen) return anyEl.webkitRequestFullscreen();
  return Promise.reject(new Error('fullscreen not supported'));
}

export function getFullscreenElementCompat() {
  const doc = document as Document & { webkitFullscreenElement?: Element | null };
  return doc.fullscreenElement || doc.webkitFullscreenElement || null;
}

export function addFullscreenChangeListener(fn: () => void) {
  document.addEventListener('fullscreenchange', fn);
  document.addEventListener('webkitfullscreenchange', fn);
}

export function removeFullscreenChangeListener(fn: () => void) {
  document.removeEventListener('fullscreenchange', fn);
  document.removeEventListener('webkitfullscreenchange', fn);
}
