import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

export function PreviousStorageBanner() {
  const desktop = window.scorelabDesktop;
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!desktop) return;
    const load = () => desktop.getStorageLocation().then((result) => setCount(result.previousDataDirs?.length || 0)).catch(() => {});
    load();
    window.addEventListener('scorelab:storage-location-checked', load);
    return () => window.removeEventListener('scorelab:storage-location-checked', load);
  }, [desktop]);

  if (!desktop || count === 0) return null;
  return (
    <div className="border-b border-warning/25 bg-warning/10 px-5 py-3 text-sm text-warning">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2">
        <p className="font-bold">변경 전 데이터 저장 위치 {count}곳의 삭제 또는 안전한 보관 여부를 확인해주세요.</p>
        <Link to="/data-management#storage-location" className="shrink-0 font-extrabold underline">이전 위치 확인</Link>
      </div>
    </div>
  );
}
