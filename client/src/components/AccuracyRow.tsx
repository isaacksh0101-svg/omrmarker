interface InsightBadge {
  text: string;
  title?: string;
}

interface Props {
  label: string;
  sublabel?: string;
  // 성취기준 문장처럼 끝까지 읽어야 뜻이 통하는 설명은 잘라내지 않고 줄바꿈해서 다 보여준다.
  wrapSublabel?: boolean;
  extra?: string;
  metric?: string;
  metricLabel?: string;
  metricDetail?: string;
  countLabel?: string;
  insights?: InsightBadge[];
  correct: number;
  total: number;
  onClick?: () => void;
}

export function AccuracyRow({
  label,
  sublabel,
  wrapSublabel = false,
  extra,
  metric,
  metricLabel = '평균 시간',
  metricDetail,
  countLabel,
  insights = [],
  correct,
  total,
  onClick,
}: Props) {
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
            <span className={wrapSublabel ? 'break-keep' : 'truncate'} title={wrapSublabel ? undefined : sublabel}>
              {sublabel}
            </span>
            {extra && <span className="shrink-0">· {extra}</span>}
          </p>
        )}
        {insights.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {insights.map((insight) => (
              <span
                key={insight.text}
                title={insight.title}
                className={`rounded-full bg-warn/15 px-2 py-0.5 text-[10px] font-bold text-warn ${
                  insight.title ? 'cursor-help' : ''
                }`}
              >
                {insight.text}
              </span>
            ))}
          </div>
        )}
      </div>
      {metric && (
        <div className="w-20 shrink-0 text-right">
          <p className="text-[10px] font-bold text-ink-soft">{metricLabel}</p>
          <p className="mt-0.5 text-sm font-bold text-ink">{metric}</p>
          {metricDetail && <p className="mt-0.5 text-[10px] text-ink-soft">{metricDetail}</p>}
        </div>
      )}
      <span className="w-16 shrink-0 text-right text-xs text-ink-soft">
        {countLabel ?? `${correct}/${total}문제`}
      </span>
      <div className="h-2 w-28 shrink-0 overflow-hidden rounded-full bg-line">
        <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
      </div>
      <span className="w-10 shrink-0 text-right text-xs font-bold text-ink">{pct}%</span>
    </div>
  );
}
