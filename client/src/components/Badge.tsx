import type { ReactNode } from 'react';

type Tone = 'neutral' | 'good' | 'warn' | 'danger';

const toneClass: Record<Tone, string> = {
  neutral: 'bg-line text-ink-soft',
  good: 'bg-good/15 text-good',
  warn: 'bg-warn/15 text-warn',
  danger: 'bg-danger/15 text-danger',
};

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: Tone }) {
  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${toneClass[tone]}`}>{children}</span>
  );
}
