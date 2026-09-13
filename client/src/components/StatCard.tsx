import type { ReactNode } from 'react';

type Tone = 'neutral' | 'good' | 'danger';

const valueToneClass: Record<Tone, string> = {
  neutral: 'text-ink',
  good: 'text-good',
  danger: 'text-danger',
};

export function StatCard({ label, value, tone = 'neutral' }: { label: string; value: string; tone?: Tone }) {
  return (
    <div className="flex-1 rounded-[1.5rem] border border-line/70 bg-panel px-5 py-5 shadow-[0_1px_2px_rgba(16,24,40,0.04)] transition-shadow duration-200 hover:shadow-[0_1px_3px_rgba(16,24,40,0.08)]">
      <p className="text-xs font-bold text-ink-soft">{label}</p>
      <p className={`mt-1.5 text-2xl font-bold tracking-tight transition-colors duration-200 ${valueToneClass[tone]}`}>
        {value}
      </p>
    </div>
  );
}

export function StatCardRow({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap gap-4">{children}</div>;
}
