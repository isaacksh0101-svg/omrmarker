import { useEffect, useState, type ReactNode } from 'react';
import { api, ApiError } from '../api/client';
import { Button } from './Button';
import { Card } from './Card';

type OnboardingStatus = { completed: boolean };

export function OnboardingGate({ children }: { children: ReactNode }) {
  const desktop = window.scorelabDesktop;
  const [completed, setCompleted] = useState<boolean | null>(null);
  const [step, setStep] = useState<1 | 2>(1);
  const [dataDir, setDataDir] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [hasApiKey, setHasApiKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      api.get<OnboardingStatus>('/settings/onboarding'),
      api.get<{ hasApiKey: boolean }>('/settings/ai'),
      desktop?.getStorageLocation() ?? Promise.resolve(null),
    ])
      .then(([status, ai, storage]) => {
        setCompleted(status.completed);
        setHasApiKey(ai.hasApiKey);
        setDataDir(storage?.dataDir ?? null);
      })
      .catch(() => setCompleted(true));
  }, [desktop]);

  async function changeStorage() {
    if (!desktop) return;
    setBusy(true);
    setError(null);
    try {
      const result = await desktop.changeStorageLocation();
      if (!result.changed) setBusy(false);
      // 변경된 경우 Electron이 새 위치로 재시작하므로 여기서는 화면을 유지한다.
    } catch (err) {
      setError(err instanceof Error ? err.message : '저장 위치를 변경하지 못했습니다.');
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
      setCompleted(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '초기 설정을 저장하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }

  if (completed === null) return null;
  if (completed) return <>{children}</>;

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
            {step}/2 초기 설정
          </span>
        </div>

        {step === 1 ? (
          <div className="mt-5">
            <h1 className="text-xl font-extrabold tracking-tight text-ink">데이터 저장 위치를 확인해주세요</h1>
            <p className="mt-2 text-sm leading-relaxed text-ink-soft">
              시험지, 학생 학습 데이터, 설정과 백업 정보가 저장되는 위치입니다. 학교에서 관리하는 장치의 폴더를 권장합니다.
            </p>
            <div className="mt-4 rounded-xl border border-line bg-bg px-4 py-3">
              <p className="text-[11px] font-bold text-ink-soft">현재 저장 위치</p>
              <p className="mt-1 break-all font-mono text-xs text-ink">
                {dataDir || (desktop ? '확인 중...' : '설치형 앱에서 선택할 수 있습니다.')}
              </p>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-ink-soft">
              위치를 변경하면 현재 데이터를 새 폴더로 복사한 뒤 ScoreLab이 자동으로 다시 시작됩니다.
            </p>
            {error && <p className="mt-3 text-xs font-bold text-danger">{error}</p>}
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              {desktop && (
                <Button variant="secondary" disabled={busy} onClick={changeStorage}>
                  다른 폴더 선택
                </Button>
              )}
              <Button disabled={busy} onClick={() => setStep(2)}>이 위치 사용</Button>
            </div>
          </div>
        ) : (
          <div className="mt-5">
            <h1 className="text-xl font-extrabold tracking-tight text-ink">Gemini API를 설정할까요?</h1>
            <p className="mt-2 text-sm leading-relaxed text-ink-soft">
              시험지 문항 자동 추출 기능에 사용합니다. API 키와 이용료는 각 교사 또는 학교가 관리하며, 나중에 환경설정에서도 입력할 수 있습니다.
            </p>
            {hasApiKey ? (
              <p className="mt-4 rounded-xl bg-good/10 px-4 py-3 text-sm font-bold text-good">
                이미 Gemini API 키가 설정되어 있습니다.
              </p>
            ) : (
              <>
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
              </>
            )}
            {error && <p className="mt-3 text-xs font-bold text-danger">{error}</p>}
            <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
              <button type="button" className="text-xs font-bold text-ink-soft underline" onClick={() => setStep(1)}>
                이전
              </button>
              <div className="flex gap-2">
                {!hasApiKey && (
                  <Button variant="secondary" disabled={busy} onClick={() => void finish(false)}>
                    나중에 설정
                  </Button>
                )}
                <Button disabled={busy} onClick={() => void finish(!hasApiKey)}>
                  {busy ? '저장 중...' : '설정 완료'}
                </Button>
              </div>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
