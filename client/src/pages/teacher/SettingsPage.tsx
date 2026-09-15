import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../../api/client';
import type { LanInfo } from '../../types';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { PageHeader } from '../../components/PageHeader';
import { IconSettings } from '../../components/icons';

const LAN_IP_STORAGE_KEY = 'omr.lanIpOverride';

function StudentAccessSection() {
  const [lanInfo, setLanInfo] = useState<LanInfo | null>(null);
  const [showNetworkSettings, setShowNetworkSettings] = useState(false);
  const [manualIp, setManualIp] = useState('');
  const [savedIp, setSavedIp] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const loadLanInfo = (ipOverride?: string | null) => {
    const query = ipOverride ? `?ip=${encodeURIComponent(ipOverride)}` : '';
    api.get<LanInfo>(`/lan-info${query}`).then(setLanInfo).catch(() => {});
  };

  useEffect(() => {
    const saved = localStorage.getItem(LAN_IP_STORAGE_KEY);
    setSavedIp(saved);
    loadLanInfo(saved);
  }, []);

  const selectIp = (ip: string | null) => {
    if (ip) {
      localStorage.setItem(LAN_IP_STORAGE_KEY, ip);
    } else {
      localStorage.removeItem(LAN_IP_STORAGE_KEY);
    }
    setSavedIp(ip);
    loadLanInfo(ip);
  };

  async function copyLink() {
    if (!lanInfo) return;
    try {
      await navigator.clipboard.writeText(lanInfo.studentUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // 클립보드 권한이 없는 환경(드물게 http 컨텍스트 등)에서는 조용히 무시하고
      // 화면에 이미 보이는 링크를 직접 선택해 복사하도록 둔다.
    }
  }

  function downloadQr() {
    if (!lanInfo?.qr) return;
    const a = document.createElement('a');
    a.href = lanInfo.qr;
    a.download = '학생접속_QR코드.png';
    a.click();
  }

  return (
    <Card>
      <h2 className="text-sm font-bold text-ink">학생 접속</h2>
      <p className="mt-1 text-xs text-ink-soft">
        학생 기기(같은 네트워크)에서 아래 QR을 스캔하거나 링크로 접속하면 시험 화면으로 이동합니다.
      </p>

      {!lanInfo ? (
        <p className="mt-3 text-left text-xs text-ink-soft">불러오는 중...</p>
      ) : !lanInfo.servingClient ? (
        <p className="mt-3 rounded-xl bg-danger/10 px-3 py-2 text-sm font-bold text-danger">
          개발 서버 상태입니다. npm start로 실행해야 학생이 접속할 수 있습니다.
        </p>
      ) : (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-4">
            {lanInfo.qr && (
              <img src={lanInfo.qr} alt="학생 접속 QR 코드" className="h-32 w-32 shrink-0 rounded-xl border border-line" />
            )}
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <p className="break-all text-sm text-ink-soft" title={lanInfo.studentUrl}>
                {lanInfo.studentUrl}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" onClick={copyLink}>
                  {copied ? '복사됨!' : '링크 복사'}
                </Button>
                <Button variant="secondary" disabled={!lanInfo.qr} onClick={downloadQr}>
                  QR 이미지 다운로드
                </Button>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setShowNetworkSettings((v) => !v)}
            className="mt-4 text-xs font-bold text-accent-ink underline"
          >
            {showNetworkSettings ? '네트워크 설정 닫기' : '학생이 접속이 안 되나요? (네트워크 설정)'}
          </button>
          {showNetworkSettings && (
            <div className="mt-2 flex flex-col gap-2 rounded-xl border border-line bg-bg p-3">
              <p className="text-xs text-ink-soft">
                교사 PC가 네트워크에 여러 개 연결돼 있으면(유선+무선 등) 아래에서 학생 기기와 같은
                네트워크의 주소를 골라보세요. 전부 시도해도 학생 기기에서 안 열리면 교사용
                네트워크와 학생용 네트워크가 분리돼 있을 수 있어요 - 이 경우 학교 네트워크
                담당자에게 문의해 주세요.
              </p>
              <div className="flex flex-col gap-1">
                <button
                  type="button"
                  onClick={() => selectIp(null)}
                  className={`rounded-lg border px-2 py-1.5 text-left text-xs ${
                    !savedIp ? 'border-accent-ink bg-accent-soft text-accent-ink' : 'border-line text-ink-soft'
                  }`}
                >
                  자동 선택 (현재: {lanInfo.selectedIp})
                </button>
                {lanInfo.candidates.map((c) => (
                  <button
                    key={c.address}
                    type="button"
                    onClick={() => selectIp(c.address)}
                    className={`rounded-lg border px-2 py-1.5 text-left text-xs ${
                      savedIp === c.address
                        ? 'border-accent-ink bg-accent-soft text-accent-ink'
                        : 'border-line text-ink-soft'
                    }`}
                  >
                    {c.name}: {c.address}
                  </button>
                ))}
              </div>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (manualIp.trim()) selectIp(manualIp.trim());
                }}
                className="flex gap-1"
              >
                <input
                  value={manualIp}
                  onChange={(e) => setManualIp(e.target.value)}
                  placeholder="직접 입력 (예: 192.168.0.10)"
                  className="min-w-0 flex-1 rounded-lg border border-line px-2 py-1.5 text-xs"
                />
                <button
                  type="submit"
                  className="shrink-0 rounded-lg border border-line px-3 py-1.5 text-xs font-bold text-ink-soft"
                >
                  적용
                </button>
              </form>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

type BackupCategory = 'all' | 'exams' | 'roster' | 'grades';

const BACKUP_CATEGORIES: Array<{
  key: BackupCategory;
  label: string;
  description: string;
  confirmMessage: string;
  fileSuffix: string;
}> = [
  {
    key: 'all',
    label: '전체',
    description:
      '시험지·학생 명단·응시 기록을 전부 담습니다. 반이나 학년을 옮길 때 새 기기에서 이 파일을 불러오면 지금까지 쓰던 데이터를 그대로 이어서 쓸 수 있습니다.',
    confirmMessage: '지금 있는 시험지·학생 명단·응시 기록이 모두 이 백업 파일 내용으로 교체됩니다. 계속할까요?',
    fileSuffix: '',
  },
  {
    key: 'exams',
    label: '시험지',
    description:
      '문제·선택지만 담습니다. 가져오면 기존 시험지는 그대로 두고 새 시험지로 추가됩니다(교체 아님) - 성적/명단은 건드리지 않습니다.',
    confirmMessage: '이 백업에 담긴 시험지가 새 시험지로 추가됩니다(기존 시험지·성적은 그대로 유지). 계속할까요?',
    fileSuffix: '-시험지',
  },
  {
    key: 'roster',
    label: '학생 명단',
    description: '출석번호·이름만 담습니다. 가져오면 지금 명단을 통째로 대체합니다.',
    confirmMessage: '지금 있는 학생 명단이 모두 이 백업 파일 내용으로 교체됩니다. 계속할까요?',
    fileSuffix: '-명단',
  },
  {
    key: 'grades',
    label: '성적',
    description:
      '응시 기록·답안·경고 기록만 담습니다. 가져오면 지금 있는 성적을 통째로 대체합니다. 시험지 구성이 그때와 다르면 실패할 수 있어요.',
    confirmMessage: '지금 있는 모든 시험의 응시 기록(성적)이 모두 이 백업 파일 내용으로 교체됩니다. 계속할까요?',
    fileSuffix: '-성적',
  },
];

function BackupSection() {
  const importInputRef = useRef<HTMLInputElement>(null);
  const [category, setCategory] = useState<BackupCategory>('all');
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importDone, setImportDone] = useState(false);

  const current = BACKUP_CATEGORIES.find((c) => c.key === category)!;

  function selectCategory(key: BackupCategory) {
    setCategory(key);
    setImportError(null);
    setImportDone(false);
  }

  async function exportBackup() {
    const today = new Date().toISOString().slice(0, 10);
    const query = category === 'all' ? '' : `?category=${category}`;
    await api.downloadFile(`/backup/export${query}`, `omr-backup${current.fileSuffix}-${today}.sqlite3`);
  }

  async function importBackup(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!confirm(current.confirmMessage)) {
      if (importInputRef.current) importInputRef.current.value = '';
      return;
    }
    setImportError(null);
    setImporting(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('category', category);
      await api.postForm('/backup/import', formData);
      setImportDone(true);
      if (category !== 'all') {
        // 전체 가져오기는 서버가 재시작되지만, 카테고리 가져오기는 지금 켜져 있는 서버가
        // 바로 반영하므로 화면에 남아있는 캐시된 목록만 새로고침하면 된다.
        setTimeout(() => window.location.reload(), 800);
      }
    } catch (err) {
      setImportError(err instanceof ApiError ? err.message : '가져오기 중 오류가 발생했습니다.');
    } finally {
      setImporting(false);
      if (importInputRef.current) importInputRef.current.value = '';
    }
  }

  return (
    <Card className="mt-6">
      <h2 className="text-sm font-bold text-ink">데이터 백업</h2>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {BACKUP_CATEGORIES.map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => selectCategory(c.key)}
            className={`rounded-lg border px-2.5 py-1 text-xs font-bold ${
              category === c.key ? 'border-accent-ink bg-accent-soft text-accent-ink' : 'border-line text-ink-soft'
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>
      <p className="mt-2 text-xs text-ink-soft">{current.description}</p>
      {importDone ? (
        <p className="mt-3 rounded-xl bg-good/15 px-3 py-2 text-sm font-bold text-good">
          {category === 'all'
            ? '가져오기 완료되었습니다. 이 창을 닫고 실행하기를 다시 실행해주세요.'
            : '가져오기 완료되었습니다. 화면을 새로고침합니다...'}
        </p>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={exportBackup}>
            백업 파일 다운로드
          </Button>
          <Button variant="secondary" disabled={importing} onClick={() => importInputRef.current?.click()}>
            {importing ? '가져오는 중...' : '백업 파일 가져오기'}
          </Button>
          <input
            ref={importInputRef}
            type="file"
            accept=".sqlite3"
            className="hidden"
            onChange={importBackup}
          />
        </div>
      )}
      {importError && <p className="mt-2 text-xs font-bold text-danger">{importError}</p>}
    </Card>
  );
}

export function SettingsPage() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <PageHeader icon={IconSettings} title="환경설정" />
      <div className="animate-fade-in-up mt-7" style={{ animationDelay: '40ms' }}>
        <StudentAccessSection />
      </div>
      <div className="animate-fade-in-up" style={{ animationDelay: '80ms' }}>
        <BackupSection />
      </div>
    </div>
  );
}
