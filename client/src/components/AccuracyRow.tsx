interface Props {
  label: string;
  sublabel?: string;
  extra?: string;
  correct: number;
  total: number;
  onClick?: () => void;
}

export function AccuracyRow({ label, sublabel, extra, correct, total, onClick }: Props) {
  const pct = total > 0 ? Math.round((correct / total) * 100) : 0;

  return (
    <div
      className={`flex items-center gap-3 py-2 ${
        onClick ? '-mx-2 cursor-pointer rounded-lg px-2 transition-colors duration-150 hover:bg-bg' : ''
      }`}
      onClick={onClick}
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold text-ink">{label}</p>
        {sublabel && (
          <p className="mt-0.5 flex items-baseline gap-1 text-xs text-ink-soft">
            <span className="truncate">{sublabel}</span>
            {extra && <span className="shrink-0">· {extra}</span>}
          </p>
        )}
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
