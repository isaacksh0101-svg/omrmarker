interface Props {
  label: string;
  sublabel?: string;
  correct: number;
  total: number;
}

export function AccuracyRow({ label, sublabel, correct, total }: Props) {
  const pct = total > 0 ? Math.round((correct / total) * 100) : 0;

  return (
    <div className="flex items-center gap-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold text-ink">{label}</p>
        {sublabel && <p className="mt-0.5 truncate text-xs text-ink-soft">{sublabel}</p>}
      </div>
      <span className="w-16 shrink-0 text-right text-xs text-ink-soft">
        {correct}/{total}문제
      </span>
      <div className="h-2 w-28 shrink-0 overflow-hidden rounded-full bg-line">
        <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
      </div>
      <span className="w-10 shrink-0 text-right text-xs font-bold text-ink">{pct}%</span>
    </div>
  );
}
