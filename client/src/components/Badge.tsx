import type { ReactNode } from 'react';

type Tone = 'neutral' | 'good' | 'warn' | 'danger';

const toneClass: Record<Tone, string> = {
  neutral: 'border border-blue-100 bg-accent-soft text-accent-ink',
  good: 'bg-good/15 text-good',
  warn: 'bg-warn/15 text-warn',
  danger: 'bg-danger/15 text-danger',
};

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: Tone }) {
  return (
    <span
      className={`whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-bold transition-colors duration-200 ${toneClass[tone]}`}
    >
      {children}
    </span>
  );
}
