import type { ReactNode } from 'react';

type Tone = 'neutral' | 'good' | 'warn' | 'danger';

const toneClass: Record<Tone, string> = {
  neutral: 'border border-blue-100 bg-accent-soft text-accent-ink',
  good: 'bg-good/15 text-good',
  warn: 'bg-warn/15 text-warn',
  danger: 'bg-danger/15 text-danger',
};

export function Badge({
  children,
  tone = 'neutral',
  title,
  wrap = false,
}: {
  children: ReactNode;
  tone?: Tone;
  title?: string;
  // 표 칸처럼 폭이 좁은 곳에서 긴 문구가 줄바꿈되게 한다(기본은 한 줄).
  wrap?: boolean;
}) {
  return (
    <span
      title={title}
      className={`${wrap ? 'inline-block whitespace-normal rounded-xl' : 'whitespace-nowrap rounded-full'} px-2.5 py-1 text-xs font-bold transition-colors duration-200 ${toneClass[tone]} ${
        title ? 'cursor-help' : ''
      }`}
    >
      {children}
    </span>
  );
}
