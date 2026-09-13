interface Props {
  classValue: number;
  myValue: number | null;
  maxValue: number;
  formatValue: (v: number) => string;
}

// 정답률/풀이시간처럼 "반 평균"과 "나"를 한눈에 비교하는 2단 막대. maxValue를 어떻게
// 주느냐로 두 가지로 다 쓴다 - 정답률은 절대 기준(1 = 100%)을, 풀이시간은 그 문항/성취기준
// 안에서의 상대 기준(둘 중 큰 값)을 넘겨서 "누가 더 오래 걸렸는지"가 바로 보이게 한다.
export function CompareBar({ classValue, myValue, maxValue, formatValue }: Props) {
  const safeMax = maxValue > 0 ? maxValue : 1;
  const classPct = Math.min(100, Math.round((classValue / safeMax) * 100));
  const myPct = myValue == null ? 0 : Math.min(100, Math.round((myValue / safeMax) * 100));

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <span className="w-10 shrink-0 text-[10px] font-bold text-ink-soft">반 평균</span>
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-line">
          <div className="h-full rounded-full bg-ink-soft/40 transition-[width] duration-300" style={{ width: `${classPct}%` }} />
        </div>
        <span className="w-14 shrink-0 text-right text-[11px] text-ink-soft">{formatValue(classValue)}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="w-10 shrink-0 text-[10px] font-bold text-accent-ink">나</span>
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-line">
          <div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${myPct}%` }} />
        </div>
        <span className="w-14 shrink-0 text-right text-[11px] font-bold text-ink">
          {myValue == null ? '-' : formatValue(myValue)}
        </span>
      </div>
    </div>
  );
}
