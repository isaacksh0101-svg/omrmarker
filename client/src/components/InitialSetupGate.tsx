import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { api, ApiError } from '../api/client';
import { Button } from './Button';
import { Card } from './Card';
import { LegalDocumentModal, type DocumentKey } from './LegalFooter';

type AuthStatus = {
  hasPassword: boolean;
  authenticated: boolean;
  setupToken?: string;
};

// 데이터 처리 안내와 이용조건은 비밀번호를 설정하기도 전인 이 화면에서부터 순서대로 끝까지
// 읽게 한다 - 이 게이트는 비밀번호가 없을 때만(최초 설치) 보이므로, 여기를 통과했다는
// 것 자체가 "이미 한 번 읽었다"는 기록이 되어 따로 서버에 저장해둘 필요가 없다.
const LEGAL_DOCS: DocumentKey[] = ['data', 'terms'];

export function InitialSetupGate({ children }: { children: ReactNode }) {
  const desktop = window.scorelabDesktop;
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [ready, setReady] = useState(false);
  const [legalIndex, setLegalIndex] = useState(0);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [dataDir, setDataDir] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      api.get<AuthStatus>('/auth/status'),
      desktop?.getStorageLocation() ?? Promise.resolve(null),
    ])
      .then(([auth, storage]) => {
        setStatus(auth);
        setDataDir(storage?.dataDir ?? null);
        if (auth.hasPassword) setReady(true);
      })
      .catch(() => setReady(true));
  }, [desktop]);

  async function changeStorage() {
    if (!desktop) return;
    setBusy(true);
    setError(null);
    try {
      const result = await desktop.changeStorageLocation();
      if (!result.changed) setBusy(false);
      // 변경된 경우 Electron이 새 저장 위치를 적용하기 위해 자동으로 다시 시작한다.
    } catch (err) {
      setError(err instanceof Error ? err.message : '저장 위치를 변경하지 못했습니다.');
      setBusy(false);
    }
  }

  async function savePassword(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (password.length < 8) return setError('비밀번호는 8자 이상이어야 합니다.');
    if (password.length > 128) return setError('비밀번호는 128자 이하로 입력해주세요.');
    if (password !== confirmPassword) return setError('비밀번호가 서로 다릅니다.');
    setBusy(true);
    try {
      await api.post('/auth/set-password', { password, setupToken: status?.setupToken });
      setPassword('');
      setConfirmPassword('');
      setStep(3);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '비밀번호를 설정하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }

  async function finish(saveApiKey: boolean) {
    setBusy(true);
    setError(null);
    try {
      if (saveApiKey) {
        const trimmed = apiKey.trim();
        if (!trimmed) {
          setError('Gemini API 키를 입력하거나 나중에 설정을 선택해주세요.');
          setBusy(false);
          return;
        }
        await api.put('/settings/ai', { apiKey: trimmed });
      }
      await api.put('/settings/onboarding');
      setReady(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '초기 설정을 완료하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }

  if (ready) return <>{children}</>;
  if (!status) return null;

  if (legalIndex < LEGAL_DOCS.length) {
    const isLast = legalIndex === LEGAL_DOCS.length - 1;
    return (
      <LegalDocumentModal
        documentKey={LEGAL_DOCS[legalIndex]}
        closeLabel={isLast ? '확인했습니다 · 계속하기' : '다음 문서 보기'}
        onClose={() => setLegalIndex((value) => value + 1)}
      />
    );
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-10">
      <div className="pointer-events-none absolute -left-24 top-1/4 h-72 w-72 rounded-full bg-blue-300/20 blur-3xl" />
      <div className="pointer-events-none absolute -right-20 top-10 h-80 w-80 rounded-full bg-cyan/15 blur-3xl" />
      <Card className="relative w-full max-w-xl border-white/80 p-7 shadow-[0_24px_70px_rgba(20,75,160,0.14)]">
        <div className="flex items-center justify-between gap-4">
          <div className="flex h-14 w-44 items-center overflow-hidden">
            <img src="/scorelab-logo.png" alt="ScoreLab" className="h-auto w-full" />
          </div>
          <span className="rounded-full bg-accent-soft px-3 py-1 text-xs font-extrabold text-accent-ink">
            {step}/3 초기 설정
          </span>
        </div>

        {step === 1 && (
          <div className="mt-5">
            <p className="text-xs font-extrabold uppercase tracking-[0.16em] text-accent-ink">ScoreLab 시작하기</p>
            <h1 className="mt-1 text-xl font-extrabold tracking-tight text-ink">데이터 저장 위치를 정해주세요</h1>
            <p className="mt-2 text-sm leading-relaxed text-ink-soft">
              시험지, 학생 학습 데이터, 설정과 백업 정보가 저장됩니다. 학교에서 관리하는 장치의 폴더를 권장합니다.
            </p>
            <div className="mt-4 rounded-xl border border-line bg-bg px-4 py-3">
              <p className="text-[11px] font-bold text-ink-soft">현재 저장 위치</p>
              <p className="mt-1 break-all font-mono text-xs text-ink">
                {dataDir || (desktop ? '확인 중...' : '설치형 앱에서 선택할 수 있습니다.')}
              </p>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-ink-soft">
              다른 폴더를 선택하면 ScoreLab이 새 위치를 적용하기 위해 한 번 다시 시작됩니다.
            </p>
            {error && <p className="mt-3 text-xs font-bold text-danger">{error}</p>}
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              {desktop && (
                <Button variant="secondary" disabled={busy} onClick={changeStorage}>다른 폴더 선택</Button>
              )}
              <Button disabled={busy} onClick={() => { setError(null); setStep(2); }}>이 위치 사용</Button>
            </div>
          </div>
        )}

        {step === 2 && (
          <form className="mt-5" onSubmit={savePassword}>
            <h1 className="text-xl font-extrabold tracking-tight text-ink">교사 화면을 보호해주세요</h1>
            <p className="mt-2 text-sm leading-relaxed text-ink-soft">
              학생 기기에서는 접근할 수 없는 교사 관리 화면용 비밀번호입니다. 8자 이상으로 설정해주세요.
            </p>
            <div className="mt-4 grid gap-2">
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="교사 비밀번호"
                autoComplete="new-password"
                maxLength={128}
                autoFocus
                className="rounded-xl border border-line bg-white px-4 py-3 text-sm outline-none"
              />
              <input
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                placeholder="교사 비밀번호 확인"
                autoComplete="new-password"
                maxLength={128}
                className="rounded-xl border border-line bg-white px-4 py-3 text-sm outline-none"
              />
            </div>
            {error && <p className="mt-3 text-xs font-bold text-danger">{error}</p>}
            <div className="mt-5 flex items-center justify-between gap-2">
              <button type="button" className="text-xs font-bold text-ink-soft underline" onClick={() => setStep(1)}>이전</button>
              <Button type="submit" disabled={busy || !password || !confirmPassword}>
                {busy ? '설정 중...' : '비밀번호 설정'}
              </Button>
            </div>
          </form>
        )}

        {step === 3 && (
          <div className="mt-5">
            <h1 className="text-xl font-extrabold tracking-tight text-ink">Gemini API를 설정할까요?</h1>
            <p className="mt-2 text-sm leading-relaxed text-ink-soft">
              시험지 문항 자동 추출 기능에 사용합니다. API 키와 이용료는 각 교사 또는 학교가 관리하며 나중에도 설정할 수 있습니다.
            </p>
            <input
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder="Gemini API 키 입력"
              autoComplete="off"
              className="mt-4 w-full rounded-xl border border-line bg-white px-4 py-3 text-sm outline-none"
            />
            <a
              href="https://aistudio.google.com/apikey"
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-block text-xs font-bold text-accent-ink underline"
            >
              Google AI Studio에서 API 키 발급
            </a>
            {error && <p className="mt-3 text-xs font-bold text-danger">{error}</p>}
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <Button variant="secondary" disabled={busy} onClick={() => void finish(false)}>나중에 설정</Button>
              <Button disabled={busy || !apiKey.trim()} onClick={() => void finish(true)}>
                {busy ? '저장 중...' : 'API 키 저장하고 시작'}
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
