import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';

type RetentionStatus = {
  currentAcademicYear: number;
  previousSessionCount: number;
};

export function DataRetentionBanner() {
  const [status, setStatus] = useState<RetentionStatus | null>(null);

  useEffect(() => {
    const load = () => api.get<RetentionStatus>('/settings/data-retention').then(setStatus).catch(() => {});
    load();
    window.addEventListener('scorelab:data-retention-changed', load);
    return () => window.removeEventListener('scorelab:data-retention-changed', load);
  }, []);

  if (!status || status.previousSessionCount === 0) return null;
  return (
    <div className="border-b border-warning/25 bg-warning/10 px-5 py-3 text-sm text-warning">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2">
        <p className="font-bold">
          이전 학년도 학습 데이터 {status.previousSessionCount}건이 남아 있습니다. 학교의 보유 기준을 확인해주세요.
        </p>
        <Link to="/settings#data-retention" className="shrink-0 font-extrabold underline">
          확인 및 삭제
        </Link>
      </div>
    </div>
  );
}
