import type { ReactNode } from 'react';

type Tone = 'neutral' | 'good' | 'danger';

const valueToneClass: Record<Tone, string> = {
  neutral: 'text-ink',
  good: 'text-good',
  danger: 'text-danger',
};

export function StatCard({ label, value, tone = 'neutral' }: { label: string; value: string; tone?: Tone }) {
  return (
    <div className="flex-1 rounded-[1.5rem] border border-blue-100/80 bg-white/95 px-5 py-5 shadow-[0_8px_26px_rgba(27,82,160,0.07)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_12px_32px_rgba(27,82,160,0.11)]">
      <p className="text-xs font-bold tracking-wide text-ink-soft">{label}</p>
      <p className={`mt-1.5 text-2xl font-bold tracking-tight transition-colors duration-200 ${valueToneClass[tone]}`}>
        {value}
      </p>
    </div>
  );
}

export function StatCardRow({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap gap-4">{children}</div>;
}
