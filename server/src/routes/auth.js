import { Router } from 'express';
import {
  hasTeacherPassword,
  setTeacherPassword,
  verifyTeacherPassword,
  issueSessionToken,
  verifySessionToken,
  SESSION_TTL_MS,
} from '../services/appSettings.js';
import { SESSION_COOKIE_NAME, getSessionToken, requireAuth, requireLocalRequest } from '../middleware/auth.js';

export const authRouter = Router();

// 상태 확인·최초 설정·로그인·로그아웃을 포함한 인증 기능 전체를 교사 PC로 제한한다.
// 따라서 학생 기기나 같은 LAN의 다른 사용자는 비밀번호를 입력하거나 세션을 발급받을 수 없다.
authRouter.use(requireLocalRequest);

const COOKIE_OPTIONS = { httpOnly: true, sameSite: 'lax', maxAge: SESSION_TTL_MS };

function login(res) {
  res.cookie(SESSION_COOKIE_NAME, issueSessionToken(), COOKIE_OPTIONS);
  res.json({ ok: true });
}

authRouter.get('/status', (req, res) => {
  res.json({
    hasPassword: hasTeacherPassword(),
    authenticated: verifySessionToken(getSessionToken(req)),
  });
});

// 최초 1회: 비밀번호가 아직 없을 때만 설정할 수 있다 - 이미 있으면 로그인 없이 덮어쓸 수
// 없어야 하므로 change-password(로그인 필요)로만 바꿀 수 있다.
authRouter.post('/set-password', (req, res) => {
  if (hasTeacherPassword()) {
    return res.status(403).json({ error: '이미 비밀번호가 설정되어 있습니다.' });
  }
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (password.length < 4) {
    return res.status(400).json({ error: '비밀번호는 4자 이상이어야 합니다.' });
  }
  setTeacherPassword(password);
  login(res);
});

authRouter.post('/login', (req, res) => {
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!verifyTeacherPassword(password)) {
    return res.status(401).json({ error: '비밀번호가 올바르지 않습니다.' });
  }
  login(res);
});

authRouter.post('/logout', (req, res) => {
  res.clearCookie(SESSION_COOKIE_NAME);
  res.json({ ok: true });
});

authRouter.post('/change-password', requireAuth, (req, res) => {
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (password.length < 4) {
    return res.status(400).json({ error: '비밀번호는 4자 이상이어야 합니다.' });
  }
  setTeacherPassword(password);
  login(res);
});
