import type { ReactNode } from 'react';

export function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex-1 rounded-2xl border border-line bg-panel px-4 py-3.5">
      <p className="text-xs font-bold text-ink-soft">{label}</p>
      <p className="mt-1 text-lg font-bold text-ink">{value}</p>
    </div>
  );
}

export function StatCardRow({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap gap-3">{children}</div>;
}
