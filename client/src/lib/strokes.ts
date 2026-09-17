// PenCanvas(필기 입력)와 StrokesReplay(필기 다시보기)가 같은 좌표 데이터를 같은
// 방식으로 그리기 위해 그리기 로직을 여기 한 곳에 모아둔다.

export type PenTool = 'pen' | 'eraser';

export interface Point {
  x: number;
  y: number;
  pressure: number;
}

export interface Stroke {
  tool: PenTool;
  color: string;
  baseWidth: number;
  points: Point[];
  // 이 획을 시작한 시각(ms, Date.now() 기준). 문항 안에서 언제 필기했는지(예: 한참
  // 고민하다 막판에 몰아 쓴 것과, 처음부터 꾸준히 쓴 것을 구분) 나중에 분석할 여지를
  // 남겨두기 위함 - 지금은 표시/분석에 쓰지 않지만 저장 시점에 붙여두는 게 훨씬 싸다.
  startedAt: number;
}

export function strokeWidthFor(stroke: Stroke, pressure: number) {
  if (stroke.tool === 'eraser') return stroke.baseWidth * 6;
  // pressure는 손가락/마우스에선 0(또는 미지원)일 수 있어 최소 굵기를 보장한다.
  const p = pressure > 0 ? pressure : 0.5;
  return stroke.baseWidth * (0.5 + p);
}

export function drawStroke(ctx: CanvasRenderingContext2D, stroke: Stroke, upToCount: number) {
  const pts = stroke.points.slice(0, upToCount);
  if (pts.length === 0) return;

  ctx.globalCompositeOperation = stroke.tool === 'eraser' ? 'destination-out' : 'source-over';
  ctx.strokeStyle = stroke.color;

  if (pts.length === 1) {
    const p = pts[0];
    const w = strokeWidthFor(stroke, p.pressure);
    ctx.beginPath();
    ctx.arc(p.x, p.y, w / 2, 0, Math.PI * 2);
    ctx.fillStyle = stroke.color;
    ctx.fill();
    return;
  }

  // 점들 중점을 이어 2차 베지어로 그리는 표준적인 손글씨 스무딩 기법.
  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1];
    const cur = pts[i];
    const midX = (prev.x + cur.x) / 2;
    const midY = (prev.y + cur.y) / 2;
    const prevMidX = i >= 2 ? (pts[i - 2].x + prev.x) / 2 : prev.x;
    const prevMidY = i >= 2 ? (pts[i - 2].y + prev.y) / 2 : prev.y;

    ctx.lineWidth = strokeWidthFor(stroke, cur.pressure);
    ctx.beginPath();
    ctx.moveTo(prevMidX, prevMidY);
    ctx.quadraticCurveTo(prev.x, prev.y, midX, midY);
    ctx.stroke();
  }
}

export function drawAllStrokes(ctx: CanvasRenderingContext2D, strokes: Stroke[]) {
  for (const stroke of strokes) {
    drawStroke(ctx, stroke, stroke.points.length);
  }
}

// 서버에 저장/조회하는 단위 - 좌표는 캡처 당시 캔버스의 CSS 픽셀 기준이라, 나중에 다른
// 크기 화면에서 다시 그리려면 그 캔버스 크기(width/height)를 같이 들고 있어야 비율이 맞는다.
export interface StrokesPayload {
  width: number;
  height: number;
  strokes: Stroke[];
}
