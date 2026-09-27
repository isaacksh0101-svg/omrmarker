import { NavLink } from 'react-router-dom';
import { api } from '../api/client';
import { IconBackup, IconChart, IconDashboard, IconDocument, IconMonitor, IconSettings, IconUsers } from './icons';

const NAV_ITEMS = [
  { to: '/', label: '시험지 만들기', icon: IconDashboard, end: true },
  { to: '/exam-management', label: '시험지 관리', icon: IconDocument, end: false },
  { to: '/exam-monitor', label: '시험 감독', icon: IconMonitor, end: false },
  { to: '/exam-reports', label: '시험별 분석', icon: IconChart, end: false },
  { to: '/standards-report', label: '학생별 분석', icon: IconChart, end: false },
];

const UTILITY_ITEMS = [
  { to: '/settings', label: '환경설정', icon: IconSettings, end: false },
  { to: '/roster', label: '학생 관리', icon: IconUsers, end: false },
  { to: '/data-management', label: '데이터 관리', icon: IconBackup, end: false },
];

function navLinkClass(isActive: boolean) {
  return `group relative flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-bold transition-all duration-200 ${
    isActive
      ? 'bg-white text-[#0759d9] shadow-[0_8px_24px_rgba(25,92,210,0.12)] ring-1 ring-blue-100/80'
      : 'text-ink-soft hover:bg-white/70 hover:text-[#0759d9]'
  }`;
}

function navIconClass(isActive: boolean) {
  return `flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-all duration-200 ${
    isActive
      ? 'bg-[linear-gradient(135deg,#075df5_0%,#07bce8_100%)] text-white shadow-[0_5px_14px_rgba(7,93,245,0.24)]'
      : 'bg-white/75 text-[#6c7893] ring-1 ring-blue-100/70 group-hover:text-[#0874e7]'
  }`;
}

async function logout() {
  try {
    await api.post('/auth/logout');
  } finally {
    window.location.reload();
  }
}

export function TeacherNav() {
  return (
    <aside className="flex min-h-screen w-68 shrink-0 flex-col border-r border-blue-100/80 bg-[linear-gradient(180deg,#f8fbff_0%,#eef6ff_52%,#f7fbff_100%)] px-4 py-6">
      <div className="flex h-16 w-52 items-center overflow-hidden px-1">
        <img
          src="/scorelab-logo.png"
          alt="ScoreLab"
          className="h-auto w-full"
        />
      </div>

      <div className="mx-2 mt-1 h-px bg-gradient-to-r from-transparent via-blue-200/80 to-transparent" />

      <nav className="mt-6 flex flex-1 flex-col gap-1.5">
        {NAV_ITEMS.map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end} className={({ isActive }) => navLinkClass(isActive)}>
            {({ isActive }) => (
              <>
                <span className={navIconClass(isActive)}>
                  <Icon className="h-[18px] w-[18px]" />
                </span>
                <span>{label}</span>
                {isActive && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-[#08b9e8]" />}
              </>
            )}
          </NavLink>
        ))}

        <div className="mx-2 my-3 h-px bg-blue-100/90" />

        {UTILITY_ITEMS.map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end} className={({ isActive }) => navLinkClass(isActive)}>
            {({ isActive }) => (
              <>
                <span className={navIconClass(isActive)}>
                  <Icon className="h-[18px] w-[18px]" />
                </span>
                <span>{label}</span>
                {isActive && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-[#08b9e8]" />}
              </>
            )}
          </NavLink>
        ))}

        <div className="mt-auto border-t border-blue-100/90 pt-4">
          <button
            type="button"
            onClick={logout}
            className="w-full rounded-xl px-3 py-2 text-left text-xs font-bold text-[#78849b] transition-colors hover:bg-white/80 hover:text-[#0759d9]"
          >
            로그아웃
          </button>
        </div>
      </nav>
    </aside>
  );
}
