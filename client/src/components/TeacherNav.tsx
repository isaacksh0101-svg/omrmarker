import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { api } from '../api/client';
import type { LanInfo } from '../types';
import { IconBackup, IconChart, IconDashboard, IconDocument, IconUsers } from './icons';

const NAV_ITEMS = [
  { to: '/', label: '시험지 관리', icon: IconDashboard, end: true },
  { to: '/roster', label: '학생 관리', icon: IconUsers, end: false },
  { to: '/standards-report', label: '성취기준별 리포트', icon: IconChart, end: false },
  { to: '/exam-reports', label: '시험별 리포트', icon: IconDocument, end: false },
  { to: '/backup', label: '데이터 백업', icon: IconBackup, end: false },
];

export function TeacherNav() {
  const [lanInfo, setLanInfo] = useState<LanInfo | null>(null);

  useEffect(() => {
    api.get<LanInfo>('/lan-info').then(setLanInfo).catch(() => {});
  }, []);

  return (
    <aside className="flex min-h-screen w-60 shrink-0 flex-col border-r border-line bg-surface-container px-3 py-5">
      <p className="px-2 text-sm font-bold text-ink">OMR프로그램</p>

      <nav className="mt-6 flex flex-col gap-1">
        {NAV_ITEMS.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-full px-3 py-2 text-sm font-bold transition-colors duration-150 ${
                isActive
                  ? 'bg-accent-soft text-accent-ink'
                  : 'text-ink-soft hover:bg-panel hover:text-ink'
              }`
            }
          >
            <Icon className="h-5 w-5 shrink-0" />
            {label}
          </NavLink>
        ))}
      </nav>

      <div className="mt-auto rounded-2xl border border-line bg-panel p-3 text-center">
        <p className="text-xs font-bold text-ink-soft">학생 접속</p>
        {lanInfo ? (
          lanInfo.servingClient ? (
            <>
              {lanInfo.qr && (
                <img src={lanInfo.qr} alt="학생 접속 QR 코드" className="mt-2 h-28 w-28 rounded-lg" />
              )}
              <p
                className="mt-2 overflow-hidden text-ellipsis whitespace-nowrap text-left text-[11px] text-ink-soft"
                title={lanInfo.studentUrl}
              >
                {lanInfo.studentUrl}
              </p>
            </>
          ) : (
            <p className="mt-2 text-left text-xs font-bold text-danger">
              개발 서버 상태입니다. npm start로 실행해야 학생이 접속할 수 있습니다.
            </p>
          )
        ) : (
          <p className="mt-2 text-left text-xs text-ink-soft">불러오는 중...</p>
        )}
      </div>
    </aside>
  );
}
