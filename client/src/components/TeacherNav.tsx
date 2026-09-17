import { NavLink } from 'react-router-dom';
import { IconChart, IconDashboard, IconDocument, IconFlask, IconMonitor, IconSettings, IconUsers } from './icons';

const NAV_ITEMS = [
  { to: '/', label: '시험지 만들기', icon: IconDashboard, end: true },
  { to: '/exam-reports', label: '시험지 관리', icon: IconDocument, end: false },
  { to: '/exam-monitor', label: '시험 감독', icon: IconMonitor, end: false },
  { to: '/roster', label: '학생 관리', icon: IconUsers, end: false },
  { to: '/standards-report', label: '학생별 리포트', icon: IconChart, end: false },
];

const SETTINGS_ITEM = { to: '/settings', label: '환경설정', icon: IconSettings, end: false };

function navLinkClass(isActive: boolean) {
  return `flex items-center gap-3 rounded-2xl px-3.5 py-2.5 text-sm font-bold transition-all duration-200 ${
    isActive
      ? 'bg-accent-soft text-accent-ink shadow-[0_1px_2px_rgba(50,88,206,0.15)]'
      : 'text-ink-soft hover:bg-panel hover:text-ink'
  }`;
}

export function TeacherNav() {
  return (
    <aside className="flex min-h-screen w-64 shrink-0 flex-col border-r border-line/70 bg-surface-container px-4 py-6">
      <div className="flex items-center gap-2.5 px-1.5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent text-white shadow-[0_1px_2px_rgba(50,88,206,0.3)]">
          <IconFlask className="h-5 w-5" />
        </span>
        <p className="text-[15px] font-bold text-ink">ScoreLab</p>
      </div>

      <nav className="mt-8 flex flex-col gap-1">
        {NAV_ITEMS.map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end} className={({ isActive }) => navLinkClass(isActive)}>
            <Icon className="h-5 w-5 shrink-0" />
            {label}
          </NavLink>
        ))}

        <NavLink
          to={SETTINGS_ITEM.to}
          end={SETTINGS_ITEM.end}
          className={({ isActive }) => `mt-5 ${navLinkClass(isActive)}`}
        >
          <SETTINGS_ITEM.icon className="h-5 w-5 shrink-0" />
          {SETTINGS_ITEM.label}
        </NavLink>
      </nav>
    </aside>
  );
}
