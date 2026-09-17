interface Props {
  classValue: number;
  myValue: number | null;
  maxValue: number;
  formatValue: (v: number) => string;
}

// 정답률/풀이시간처럼 "반 평균"과 "나"를 한눈에 비교하는 2단 막대. maxValue는 항상 절대
// 기준으로 준다 - 정답률은 1(=100%), 풀이시간은 60000ms(=1분). 행마다 "그 안에서 둘 중
// 큰 값"으로 스케일을 다시 잡으면, 12초짜리 행과 3초짜리 행의 막대가 (한쪽 값이 없을 때)
// 똑같이 꽉 차 보여서 막대 길이가 실제 시간 크기를 전혀 반영하지 못하는 문제가 있었다.
// 60초를 넘는 값은 100%로 클램프된다 - 대부분의 문항 풀이 시간은 1분 안쪽이라 기준으로 삼기
// 적당하고, 어쩌다 넘는 경우까지 막대에 정밀하게 담을 필요는 없다고 판단했다.
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
