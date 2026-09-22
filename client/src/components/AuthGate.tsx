import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { api, ApiError } from '../api/client';
import { Card } from './Card';
import { Button } from './Button';

type Status = { hasPassword: boolean; authenticated: boolean; setupToken?: string };

const IDLE_LOCK_MS = 30 * 60 * 1000;

export function AuthGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const idleTimer = useRef<number | null>(null);

  const loadStatus = () => {
    api
      .get<Status>('/auth/status')
      .then(setStatus)
      .catch(() => setStatus({ hasPassword: false, authenticated: false }));
  };

  useEffect(() => {
    loadStatus();
    // 세션이 만료된 뒤(예: 12시간 경과) API가 401을 내려주면 api/client.ts가 이 이벤트를
    // 쏜다 - 전체 새로고침 없이 다시 로그인 화면으로 되돌리기 위해 듣는다.
    const onUnauthorized = () => setStatus((s) => (s ? { ...s, authenticated: false } : s));
    window.addEventListener('scorelab:unauthorized', onUnauthorized);
    return () => window.removeEventListener('scorelab:unauthorized', onUnauthorized);
  }, []);

  useEffect(() => {
    if (!status?.authenticated) return;

    const lock = () => {
      void api.post('/auth/logout').catch(() => undefined);
      setStatus((current) => current ? { ...current, authenticated: false } : current);
      setNotice('30분 동안 사용하지 않아 교사 화면을 자동으로 잠갔습니다.');
    };
    const resetTimer = () => {
      if (idleTimer.current !== null) window.clearTimeout(idleTimer.current);
      idleTimer.current = window.setTimeout(lock, IDLE_LOCK_MS);
    };
    const events: Array<keyof WindowEventMap> = ['pointerdown', 'keydown', 'touchstart', 'scroll'];
    events.forEach((eventName) => window.addEventListener(eventName, resetTimer, { passive: true }));
    resetTimer();
    return () => {
      events.forEach((eventName) => window.removeEventListener(eventName, resetTimer));
      if (idleTimer.current !== null) window.clearTimeout(idleTimer.current);
    };
  }, [status?.authenticated]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const isSetup = status ? !status.hasPassword : false;
    if (isSetup) {
      if (password.length < 8) return setError('비밀번호는 8자 이상이어야 합니다.');
      if (password.length > 128) return setError('비밀번호는 128자 이하로 입력해주세요.');
      if (password !== confirmPassword) return setError('비밀번호가 서로 다릅니다.');
    }

    setSubmitting(true);
    try {
      await api.post(isSetup ? '/auth/set-password' : '/auth/login', {
        password,
        ...(isSetup ? { setupToken: status?.setupToken } : {}),
      });
      setPassword('');
      setConfirmPassword('');
      setNotice(null);
      loadStatus();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '처리 중 오류가 발생했습니다.');
    } finally {
      setSubmitting(false);
    }
  }

  if (!status) return null;
  if (status.authenticated) return <>{children}</>;

  const isSetup = !status.hasPassword;

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-4">
      <div className="pointer-events-none absolute -left-24 top-1/4 h-72 w-72 rounded-full bg-blue-300/20 blur-3xl" />
      <div className="pointer-events-none absolute -right-20 top-10 h-80 w-80 rounded-full bg-cyan/15 blur-3xl" />
      <Card className="relative w-full max-w-sm border-white/80 p-7 shadow-[0_24px_70px_rgba(20,75,160,0.14)]">
        <div className="flex h-16 w-52 items-center overflow-hidden">
          <img src="/scorelab-logo.png" alt="ScoreLab" className="h-auto w-full" />
        </div>
        <h1 className="mt-2 text-lg font-bold tracking-tight text-ink">{isSetup ? '처음 시작하기' : '교사 로그인'}</h1>
        <p className="mt-1 text-xs text-ink-soft">
          {isSetup
            ? '교사 화면에 처음 들어왔어요. 앞으로 쓸 비밀번호를 한 번만 설정해주세요.'
            : '교사 전용 화면입니다. 비밀번호를 입력해주세요.'}
        </p>
        <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-2.5">
          {notice && <p className="rounded-xl bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-800">{notice}</p>}
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="비밀번호"
            autoFocus
            autoComplete={isSetup ? 'new-password' : 'current-password'}
            maxLength={128}
            className="rounded-xl border border-line bg-bg/70 px-3.5 py-2.5 text-sm outline-none"
          />
          {isSetup && (
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="비밀번호 확인"
              autoComplete="new-password"
              maxLength={128}
              className="rounded-xl border border-line bg-bg/70 px-3.5 py-2.5 text-sm outline-none"
            />
          )}
          {error && <p className="text-xs font-bold text-danger">{error}</p>}
          <Button type="submit" disabled={submitting || !password} className="mt-1 w-full">
            {submitting ? '처리 중...' : isSetup ? '설정하고 시작' : '로그인'}
          </Button>
        </form>
      </Card>
    </div>
  );
}
