import type { SVGProps } from 'react';

const base: SVGProps<SVGSVGElement> = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
};

export function IconDashboard(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
    </svg>
  );
}

export function IconUsers(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <circle cx="9" cy="8" r="3" />
      <path d="M3.5 19c0-3 2.5-5 5.5-5s5.5 2 5.5 5" />
      <circle cx="17" cy="9" r="2.3" />
      <path d="M15.5 14.2c2.4.3 4 2 4 4.8" />
    </svg>
  );
}

export function IconChart(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <path d="M4 20V10" />
      <path d="M11 20V4" />
      <path d="M18 20v-7" />
      <path d="M3 20h18" />
    </svg>
  );
}

export function IconDocument(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <path d="M6.5 3.5h7l4 4v13a1 1 0 0 1-1 1h-10a1 1 0 0 1-1-1v-16a1 1 0 0 1 1-1Z" />
      <path d="M13.5 3.5v4h4" />
      <path d="M8.5 12.5h7" />
      <path d="M8.5 16h7" />
    </svg>
  );
}

export function IconBackup(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <ellipse cx="12" cy="5.5" rx="7.5" ry="2.5" />
      <path d="M4.5 5.5v6c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5v-6" />
      <path d="M4.5 11.5v6c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5v-6" />
    </svg>
  );
}

export function IconSettings(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3.5v2.4M12 18.1v2.4M20.5 12h-2.4M5.9 12H3.5M17.7 6.3l-1.7 1.7M8 16l-1.7 1.7M17.7 17.7 16 16M8 8 6.3 6.3" />
    </svg>
  );
}

export function IconMonitor(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <rect x="3" y="4.5" width="18" height="12" rx="1.5" />
      <path d="M9 20h6M12 16.5V20" />
      <circle cx="16.3" cy="9" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconEye(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="2.6" />
    </svg>
  );
}

export function IconStopCircle(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <rect x="9" y="9" width="6" height="6" rx="1" />
    </svg>
  );
}

export function IconGrip(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} fill="currentColor" stroke="none" {...props}>
      <circle cx="9" cy="6" r="1.4" />
      <circle cx="15" cy="6" r="1.4" />
      <circle cx="9" cy="12" r="1.4" />
      <circle cx="15" cy="12" r="1.4" />
      <circle cx="9" cy="18" r="1.4" />
      <circle cx="15" cy="18" r="1.4" />
    </svg>
  );
}

export function IconPen(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <path d="M4 20l0.6-3.4L15.2 6l3.2 3.2L7.8 19.6 4 20Z" />
      <path d="M13 8.2l3.2 3.2" />
    </svg>
  );
}

export function IconEraser(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <path d="m7.2 20-4-4a2.4 2.4 0 0 1 0-3.4L13.8 2a2.4 2.4 0 0 1 3.4 0l3.6 3.6a2.4 2.4 0 0 1 0 3.4L9.8 20H7.2Z" />
      <path d="m11 4.8 8.2 8.2" />
      <path d="M7.2 20H21" />
    </svg>
  );
}

export function IconTrash(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <path d="M5 7.5h14" />
      <path d="M9.5 7.5V5.8c0-.7.6-1.3 1.3-1.3h2.4c.7 0 1.3.6 1.3 1.3V7.5" />
      <path d="M7 7.5 7.8 19c.05.8.7 1.5 1.5 1.5h5.4c.8 0 1.45-.7 1.5-1.5l.8-11.5" />
      <path d="M10.3 11v6M13.7 11v6" />
    </svg>
  );
}

export function IconHand(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <path d="M8 12.5V5.3a1.3 1.3 0 0 1 2.6 0v5.7" />
      <path d="M10.6 10.8V4.3a1.3 1.3 0 0 1 2.6 0v6.5" />
      <path d="M13.2 10.8V5.3a1.3 1.3 0 0 1 2.6 0v6.7" />
      <path d="M15.8 12v-3a1.3 1.3 0 0 1 2.6 0v6.3c0 3.3-2.3 6-6.2 6-2.6 0-4-.9-5.4-2.6L4 14.4c-.6-.8-.4-1.8.4-2.3.7-.4 1.6-.3 2.2.4l1.4 1.6" />
    </svg>
  );
}

export function IconFingerDraw(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      {/* 검지 위에 그려지는 잉크 궤적 - 손가락으로 획을 긋고 있다는 걸 보여준다. */}
      <path d="M8.4 3.6c1-1.1 2.1-1.1 3.1 0s2.1 1.1 3.1 0" />
      <path d="M9.2 13.2V5.8a1.55 1.55 0 0 1 3.1 0v5.4" />
      <path d="M12.3 10.4V8.7a1.45 1.45 0 0 1 2.9 0v3" />
      <path d="M15.2 11V9.8a1.4 1.4 0 0 1 2.8 0v5.1c0 3.2-2.2 5.5-5.6 5.5-2.4 0-3.8-.9-5.1-2.6l-2.5-3.2a1.45 1.45 0 0 1 2.2-1.9l2.2 2.1" />
    </svg>
  );
}

export function IconUndo(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <path d="M7 7 3.5 10.5 7 14" />
      <path d="M3.5 10.5h10.2c3.2 0 5.8 2.6 5.8 5.8v0.2" />
    </svg>
  );
}

export function IconChevronRight(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <path d="M9 5.5 15 12l-6 6.5" />
    </svg>
  );
}

// ScoreLab 브랜드 마크 - 사이드바 상단 로고에만 쓴다. 점수를 분석하는 "랩(실험실)"이라는
// 이름 그대로 플라스크 모양.
export function IconFlask(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <path d="M9 3v5.2L4.6 16.8A2 2 0 0 0 6.4 19.8h11.2a2 2 0 0 0 1.8-3L15 8.2V3" />
      <path d="M8.3 3h7.4" />
      <path d="M6.8 14.5h10.4" />
    </svg>
  );
}
