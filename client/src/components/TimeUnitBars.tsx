interface Props {
  classValue: number;
  myValue: number | null;
  formatValue: (v: number) => string;
}

// 풀이 시간은 정답률과 달리 자연스러운 상한(100%)이 없고, 실제 사용 환경에서는 문항 하나에
// 수 분씩 걸릴 수 있다. 그래서 하나의 막대 길이를 어떤 기준(반 평균 vs 나 중 큰 값 등)으로
// 정규화하는 방식 대신, 막대 1개 = 1분인 눈금 막대를 나열한다. 2분이면 막대 2개, 2분 30초면
// 막대 2개 반(마지막 막대만 절반 높이) - 값을 서로 정규화하지 않으니 행 사이에서도, 절대
// 시간으로도 그대로 비교가 된다.
const UNIT_MS = 60_000;
// 막대가 너무 길어지지 않도록 여기서 자르고, 그 이상은 숫자(옆의 정확한 값 텍스트)로만 본다.
const MAX_UNITS = 8;

function computeUnits(ms: number) {
  const totalUnits = ms / UNIT_MS;
  const capped = Math.min(totalUnits, MAX_UNITS);
  const fullUnits = Math.floor(capped + 1e-9);
  const fraction = capped - fullUnits;
  return { fullUnits, fraction, overflow: totalUnits > MAX_UNITS };
}

function UnitBarRow({ ms, barClassName }: { ms: number; barClassName: string }) {
  const { fullUnits, fraction, overflow } = computeUnits(Math.max(0, ms));
  return (
    <div className="flex h-4 flex-1 items-end gap-0.5">
      {Array.from({ length: fullUnits }).map((_, i) => (
        <div key={i} className={`h-full w-1.5 shrink-0 rounded-[1px] ${barClassName}`} />
      ))}
      {fraction > 0.05 && (
        <div
          className={`w-1.5 shrink-0 rounded-[1px] ${barClassName}`}
          style={{ height: `${Math.round(fraction * 100)}%` }}
        />
      )}
      {overflow && <span className="ml-0.5 shrink-0 text-[10px] font-bold text-ink-soft">+</span>}
    </div>
  );
}

export function TimeUnitBars({ classValue, myValue, formatValue }: Props) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <span className="w-10 shrink-0 text-[10px] font-bold text-ink-soft">반 평균</span>
        <UnitBarRow ms={classValue} barClassName="bg-ink-soft/40" />
        <span className="w-14 shrink-0 text-right text-[11px] text-ink-soft">{formatValue(classValue)}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="w-10 shrink-0 text-[10px] font-bold text-accent-ink">나</span>
        {myValue == null ? (
          <span className="h-4 flex-1 text-[10px] text-ink-soft">-</span>
        ) : (
          <UnitBarRow ms={myValue} barClassName="bg-accent" />
        )}
        <span className="w-14 shrink-0 text-right text-[11px] font-bold text-ink">
          {myValue == null ? '-' : formatValue(myValue)}
        </span>
      </div>
    </div>
  );
}
