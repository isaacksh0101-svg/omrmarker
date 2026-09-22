import { Router } from 'express';
import {
  consumeInitialSetupToken,
  getInitialSetupToken,
  hasTeacherPassword,
  invalidateAllSessions,
  issueSessionToken,
  SESSION_TTL_MS,
  setTeacherPassword,
  validateTeacherPassword,
  verifySessionToken,
  verifyTeacherPassword,
} from '../services/appSettings.js';
import { SESSION_COOKIE_NAME, getSessionToken, requireAuth, requireLocalRequest } from '../middleware/auth.js';

export const authRouter = Router();

authRouter.use(requireLocalRequest);
authRouter.use((_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'strict',
  maxAge: SESSION_TTL_MS,
  path: '/',
};
const CLEAR_COOKIE_OPTIONS = { httpOnly: true, sameSite: 'strict', path: '/' };

let failedLoginAttempts = 0;
let blockedUntil = 0;

function login(res) {
  res.cookie(SESSION_COOKIE_NAME, issueSessionToken(), COOKIE_OPTIONS);
  res.json({ ok: true });
}

function registerFailedLogin(res) {
  failedLoginAttempts += 1;
  if (failedLoginAttempts >= 5) {
    const delaySeconds = 30;
    blockedUntil = Date.now() + delaySeconds * 1000;
    res.set('Retry-After', String(delaySeconds));
  }
  return res.status(401).json({ error: '비밀번호가 올바르지 않습니다.' });
}

authRouter.get('/status', (req, res) => {
  const hasPassword = hasTeacherPassword();
  res.json({
    hasPassword,
    authenticated: verifySessionToken(getSessionToken(req)),
    setupToken: hasPassword ? undefined : getInitialSetupToken(),
  });
});

authRouter.post('/set-password', (req, res) => {
  if (hasTeacherPassword()) {
    return res.status(403).json({ error: '이미 비밀번호가 설정되어 있습니다.' });
  }
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const validationError = validateTeacherPassword(password);
  if (validationError) return res.status(400).json({ error: validationError });
  if (!consumeInitialSetupToken(req.body?.setupToken)) {
    return res.status(403).json({ error: '최초 설정 요청을 확인할 수 없습니다. 앱을 다시 시작해주세요.' });
  }
  setTeacherPassword(password);
  invalidateAllSessions();
  login(res);
});

authRouter.post('/login', (req, res) => {
  const waitMs = blockedUntil - Date.now();
  if (waitMs > 0) {
    const retryAfter = Math.max(1, Math.ceil(waitMs / 1000));
    res.set('Retry-After', String(retryAfter));
    return res.status(429).json({ error: `로그인 시도가 너무 많습니다. ${retryAfter}초 후 다시 시도해주세요.` });
  }
  const password = typeof req.body?.password === 'string' && req.body.password.length <= 128
    ? req.body.password
    : '';
  if (!verifyTeacherPassword(password)) return registerFailedLogin(res);
  failedLoginAttempts = 0;
  blockedUntil = 0;
  return login(res);
});

authRouter.post('/logout', requireAuth, (_req, res) => {
  invalidateAllSessions();
  res.clearCookie(SESSION_COOKIE_NAME, CLEAR_COOKIE_OPTIONS);
  res.json({ ok: true });
});

authRouter.post('/change-password', requireAuth, (req, res) => {
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const validationError = validateTeacherPassword(password);
  if (validationError) return res.status(400).json({ error: validationError });
  setTeacherPassword(password);
  invalidateAllSessions();
  login(res);
});
