export interface TrendChartPoint {
  key: string;
  date: string;
  title: string;
  classAcc: number;
  classAttempted: number;
  mineAcc: number | null;
  mineAttempted: number;
}

interface Props {
  points: TrendChartPoint[];
  showMine: boolean;
}

const W = 640;
const H = 200;
const PAD_L = 32;
const PAD_R = 10;
const PAD_T = 14;
const PAD_B = 26;

function xAt(i: number, n: number) {
  if (n <= 1) return (PAD_L + (W - PAD_R)) / 2;
  return PAD_L + (i * (W - PAD_L - PAD_R)) / (n - 1);
}

function yAt(v: number) {
  const clamped = Math.max(0, Math.min(1, v));
  return PAD_T + (1 - clamped) * (H - PAD_T - PAD_B);
}

function fmtDate(d: string) {
  const parts = d.split('-');
  if (parts.length !== 3) return d;
  return `${Number(parts[1])}/${Number(parts[2])}`;
}

function fmtPct(v: number) {
  return `${Math.round(v * 100)}%`;
}

// null(그 시험에서 데이터가 없음)인 지점에서는 선을 끊어야 하므로, 값이 이어지는
// 구간마다 별도의 path를 만든다 - 하나의 path에 다 이어붙이면 없는 구간이 직선으로
// 메워져 실제로 응시하지 않은 시험까지 성적이 있는 것처럼 보인다.
function buildPaths(values: (number | null)[], n: number): string[] {
  const paths: string[] = [];
  let current: string[] = [];
  values.forEach((v, i) => {
    if (v == null) {
      if (current.length > 1) paths.push(current.join(' '));
      current = [];
      return;
    }
    const point = `${xAt(i, n).toFixed(1)},${yAt(v).toFixed(1)}`;
    current.push(current.length === 0 ? `M${point}` : `L${point}`);
  });
  if (current.length > 1) paths.push(current.join(' '));
  return paths;
}

// 성취기준별 리포트에서 기간에 걸친 정답률 변화를 보여주는 커스텀 SVG 라인 차트.
// 데이터포인트 수가 교사 1인의 학급 기준으로 많아야 수십 개라 별도 차트 라이브러리
// 없이 직접 그린다 - 의존성도 늘리지 않고, 앱의 색상 토큰을 그대로 쓸 수 있다.
export function TrendChart({ points, showMine }: Props) {
  const n = points.length;
  const classPaths = buildPaths(points.map((p) => p.classAcc), n);
  const minePaths = showMine ? buildPaths(points.map((p) => p.mineAcc), n) : [];
  const labelStep = n > 8 ? Math.ceil(n / 8) : 1;

  return (
    <div className="mt-2">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="기간별 정답률 변화 추이">
        {[0, 0.5, 1].map((lvl) => (
          <g key={lvl}>
            <line x1={PAD_L} x2={W - PAD_R} y1={yAt(lvl)} y2={yAt(lvl)} stroke="var(--color-line)" strokeWidth={1} />
            <text x={PAD_L - 6} y={yAt(lvl) + 3} textAnchor="end" fontSize={9} fill="var(--color-ink-soft)">
              {Math.round(lvl * 100)}%
            </text>
          </g>
        ))}

        {classPaths.map((d, i) => (
          <path key={`class-line-${i}`} d={d} fill="none" stroke="var(--color-ink-soft)" strokeOpacity={0.55} strokeWidth={2} />
        ))}
        {points.map((p, i) => (
          <circle key={`class-pt-${p.key}`} cx={xAt(i, n)} cy={yAt(p.classAcc)} r={3} fill="var(--color-ink-soft)" fillOpacity={0.7}>
            <title>{`${p.title}\n반 평균 ${fmtPct(p.classAcc)} (${p.classAttempted}건) · ${p.date}`}</title>
          </circle>
        ))}

        {showMine &&
          minePaths.map((d, i) => (
            <path key={`mine-line-${i}`} d={d} fill="none" stroke="var(--color-accent)" strokeWidth={2.5} />
          ))}
        {showMine &&
          points.map(
            (p, i) =>
              p.mineAcc != null && (
                <circle key={`mine-pt-${p.key}`} cx={xAt(i, n)} cy={yAt(p.mineAcc)} r={3.5} fill="var(--color-accent)">
                  <title>{`${p.title}\n내 정답률 ${fmtPct(p.mineAcc)} (${p.mineAttempted}건) · ${p.date}`}</title>
                </circle>
              ),
          )}

        {points.map(
          (p, i) =>
            i % labelStep === 0 && (
              <text key={`x-${p.key}`} x={xAt(i, n)} y={H - 8} textAnchor="middle" fontSize={9} fill="var(--color-ink-soft)">
                {fmtDate(p.date)}
              </text>
            ),
        )}
      </svg>
      <div className="mt-1 flex items-center gap-4 text-[10px] font-bold text-ink-soft">
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-ink-soft/50" />반 평균
        </span>
        {showMine && (
          <span className="flex items-center gap-1 text-accent-ink">
            <span className="h-2 w-2 rounded-full bg-accent" />나
          </span>
        )}
      </div>
    </div>
  );
}
