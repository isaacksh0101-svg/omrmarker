import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

export type PenTool = 'pen' | 'eraser';

export interface PenCanvasHandle {
  clear: () => void;
  undo: () => void;
}

interface Point {
  x: number;
  y: number;
  pressure: number;
}

interface Stroke {
  tool: PenTool;
  color: string;
  baseWidth: number;
  points: Point[];
}

interface PenCanvasProps {
  /** 필기 모드가 켜져 있을 때만 포인터를 받는다 - 꺼져 있으면 아래 문제 화면을 그대로 조작할 수 있다. */
  active: boolean;
  tool: PenTool;
  color: string;
  baseWidth?: number;
  /** S-Pen이 없는 학생을 위한 손가락 필기 모드 - true면 touch도 필기로 인정한다(팜 리젝션 없음). */
  allowTouch?: boolean;
  onStrokesChange?: (hasStrokes: boolean) => void;
}

// 갤럭시 크롬북2 360의 와콤 S-Pen(EMR) 필기 최적화 캔버스.
// - Pointer Events + pointerType 필터링으로 손바닥/터치는 무시(팜 리젝션), 펜만 그린다.
//   단, allowTouch가 켜져 있으면(펜이 없는 학생용 손가락 필기 모드) touch도 필기로 받는다.
// - getCoalescedEvents로 rAF(60Hz)보다 촘촘한 EMR 샘플(~200Hz) 좌표를 모두 반영해 선이 끊기지 않게 한다.
// - 필압(pressure)에 따라 선 굵기를 구간별로 바꿔 손글씨 느낌을 살린다.
// - 펜 뒤쪽 지우개(버튼 5)를 대면 도구 설정과 무관하게 자동으로 지우개로 전환된다.
export const PenCanvas = forwardRef<PenCanvasHandle, PenCanvasProps>(function PenCanvas(
  { active, tool, color, baseWidth = 2.6, allowTouch = false, onStrokesChange },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const strokesRef = useRef<Stroke[]>([]);
  const activeStrokeRef = useRef<Stroke | null>(null);
  const sizeRef = useRef({ width: 0, height: 0 });

  function redrawAll() {
    const ctx = ctxRef.current;
    const { width, height } = sizeRef.current;
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);
    for (const stroke of strokesRef.current) {
      drawStroke(ctx, stroke, stroke.points.length);
    }
  }

  useImperativeHandle(ref, () => ({
    clear() {
      strokesRef.current = [];
      activeStrokeRef.current = null;
      redrawAll();
      onStrokesChange?.(false);
    },
    undo() {
      strokesRef.current.pop();
      redrawAll();
      onStrokesChange?.(strokesRef.current.length > 0);
    },
  }));

  // 컨테이너 크기에 맞춰 캔버스 backing store를 devicePixelRatio 기준으로 다시 잡는다.
  // (리사이즈/회전은 흔치 않으므로 그때만 전체 다시 그리기 - 평소 필기 중엔 증분으로만 그림)
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const resize = () => {
      const rect = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      sizeRef.current = { width: rect.width, height: rect.height };
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctxRef.current = ctx;
      }
      redrawAll();
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function drawStroke(ctx: CanvasRenderingContext2D, stroke: Stroke, upToCount: number) {
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

  function strokeWidthFor(stroke: Stroke, pressure: number) {
    if (stroke.tool === 'eraser') return stroke.baseWidth * 6;
    // pressure는 손가락/마우스에선 0(또는 미지원)일 수 있어 최소 굵기를 보장한다.
    const p = pressure > 0 ? pressure : 0.5;
    return stroke.baseWidth * (0.5 + p);
  }

  function toLocalPoint(e: PointerEvent): Point {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top, pressure: e.pressure };
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // 팜 리젝션: 기본은 S-Pen(pointerType 'pen')만 필기로 인정해 손바닥 터치를 무시한다.
    // allowTouch(손가락 필기 모드)가 켜져 있으면 - 펜이 없는 학생을 위해 - touch도 인정한다.
    // 이 모드에선 손바닥도 필기로 잡히지만, 애초에 펜이 없어 팜 리젝션이 필요 없는 상황이다.
    function isDrawingPointer(e: PointerEvent) {
      return e.pointerType === 'pen' || (allowTouch && e.pointerType === 'touch');
    }

    function resolveTool(e: PointerEvent): PenTool {
      // 펜 뒤쪽 지우개(버튼)를 대면 e.button === 5 (buttons에 0x20 비트) - 도구 설정과
      // 무관하게 즉시 지우개로 취급한다. 그 외엔 현재 선택된 도구를 따른다.
      if (e.pointerType === 'pen' && (e.button === 5 || (e.buttons & 0x20) !== 0)) return 'eraser';
      return tool;
    }

    function onPointerDown(e: PointerEvent) {
      if (!isDrawingPointer(e)) return;
      e.preventDefault();
      canvas!.setPointerCapture(e.pointerId);

      const stroke: Stroke = {
        tool: resolveTool(e),
        color,
        baseWidth,
        points: [toLocalPoint(e)],
      };
      activeStrokeRef.current = stroke;
      const ctx = ctxRef.current;
      if (ctx) drawStroke(ctx, stroke, stroke.points.length);
    }

    function onPointerMove(e: PointerEvent) {
      const stroke = activeStrokeRef.current;
      if (!stroke || !isDrawingPointer(e)) return;
      e.preventDefault();

      const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      const ctx = ctxRef.current;
      for (const ce of events.length > 0 ? events : [e]) {
        stroke.points.push(toLocalPoint(ce));
        if (ctx) drawStroke(ctx, stroke, stroke.points.length);
      }
    }

    function endStroke(e: PointerEvent) {
      const stroke = activeStrokeRef.current;
      if (!stroke || !isDrawingPointer(e)) return;
      activeStrokeRef.current = null;
      if (stroke.points.length > 0) {
        strokesRef.current.push(stroke);
        onStrokesChange?.(true);
      }
    }

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', endStroke);
    canvas.addEventListener('pointercancel', endStroke);
    canvas.addEventListener('pointerleave', endStroke);
    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', endStroke);
      canvas.removeEventListener('pointercancel', endStroke);
      canvas.removeEventListener('pointerleave', endStroke);
    };
  }, [tool, color, baseWidth, allowTouch, onStrokesChange]);

  return (
    // 컨테이너 자체는 항상 pointer-events:none - 내용이 없는 투명 레이어라도 기본값(auto)이면
    // 이 밑의 선택지/입력 클릭을 가로채 버린다. 실제로 그릴 때만 canvas가 스스로 auto로
    // 되돌려 받는다(자식의 명시적 pointer-events가 부모의 none보다 우선한다).
    <div ref={containerRef} className="absolute inset-0" style={{ pointerEvents: 'none' }}>
      <canvas
        ref={canvasRef}
        className="absolute inset-0"
        style={{ pointerEvents: active ? 'auto' : 'none', touchAction: 'none' }}
      />
    </div>
  );
});
