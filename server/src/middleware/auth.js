import { verifySessionToken } from '../services/appSettings.js';

export const SESSION_COOKIE_NAME = 'scorelab_session';

// cookie-parser 없이 Cookie 헤더만 직접 읽는다 - 응답 쿠키(res.cookie)는 Express 기본
// 기능이라 별도 패키지가 필요 없고, 필요한 건 요청 쿠키를 읽는 이 한 조각뿐이다.
export function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  }
  return out;
}

export function getSessionToken(req) {
  return parseCookies(req.headers.cookie)[SESSION_COOKIE_NAME];
}

// 교사 로그인과 관리 기능은 Electron이 열린 교사 PC 자체에서만 허용한다. 서버는 학생이
// 접속할 수 있도록 0.0.0.0에 열려 있지만, LAN의 다른 기기에서는 교사 비밀번호나 세션
// 쿠키를 전송할 기회 자체를 주지 않는다. IPv4-mapped IPv6 표기도 함께 처리한다.
export function isLoopbackRequest(req) {
  const address = req.socket?.remoteAddress || '';
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

export function requireLocalRequest(req, res, next) {
  if (isLoopbackRequest(req)) return next();
  res.status(403).json({ error: '교사 관리 기능은 ScoreLab이 실행 중인 교사 PC에서만 사용할 수 있습니다.' });
}

// 교사 전용 화면/기능에만 붙인다 - 학생이 시험에 참여·응시하는 경로에는 붙이지 않는다.
export function requireAuth(req, res, next) {
  if (!isLoopbackRequest(req)) {
    return res.status(403).json({ error: '교사 관리 기능은 ScoreLab이 실행 중인 교사 PC에서만 사용할 수 있습니다.' });
  }
  if (verifySessionToken(getSessionToken(req))) return next();
  res.status(401).json({ error: '로그인이 필요합니다.' });
}
