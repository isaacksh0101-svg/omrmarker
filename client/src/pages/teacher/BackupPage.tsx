import { useRef, useState } from 'react';
import { api, ApiError } from '../../api/client';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';

export function BackupPage() {
  const importInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importDone, setImportDone] = useState(false);

  async function exportBackup() {
    const today = new Date().toISOString().slice(0, 10);
    await api.downloadFile('/backup/export', `omr-backup-${today}.sqlite3`);
  }

  async function importBackup(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (
      !confirm('지금 있는 시험지·학생 명단·응시 기록이 모두 이 백업 파일 내용으로 교체됩니다. 계속할까요?')
    ) {
      if (importInputRef.current) importInputRef.current.value = '';
      return;
    }
    setImportError(null);
    setImporting(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      await api.postForm('/backup/import', formData);
      setImportDone(true);
    } catch (err) {
      setImportError(err instanceof ApiError ? err.message : '가져오기 중 오류가 발생했습니다.');
    } finally {
      setImporting(false);
      if (importInputRef.current) importInputRef.current.value = '';
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-10">
      <h1 className="text-xl font-bold text-ink">데이터 백업</h1>

      <Card className="mt-6">
        <p className="text-xs text-ink-soft">
          시험지·학생 명단·응시 기록이 담긴 파일입니다. 반이나 학년을 옮길 때 여기서 내려받은 파일을 새
          기기에서 불러오면 지금까지 쓰던 데이터를 그대로 이어서 쓸 수 있습니다.
        </p>
        {importDone ? (
          <p className="mt-3 rounded-xl bg-good/15 px-3 py-2 text-sm font-bold text-good">
            가져오기 완료되었습니다. 이 창을 닫고 실행하기를 다시 실행해주세요.
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
    </div>
  );
}
