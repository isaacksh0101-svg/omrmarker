import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { drawStroke, type Point, type PenTool, type Stroke } from '../lib/strokes';

export type { PenTool, Stroke, Point };

export interface PenCanvasHandle {
  clear: () => void;
  undo: () => void;
  getStrokes: () => Stroke[];
  // 필기 좌표는 이 캔버스의 CSS 픽셀 크기를 기준으로 저장돼 있다 - 나중에 다른 크기의
  // 화면에서 다시 그릴 때 원래 비율대로 맞추려면 이 크기를 같이 저장해둬야 한다.
  getCanvasSize: () => { width: number; height: number };
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
    getStrokes() {
      return strokesRef.current;
    },
    getCanvasSize() {
      return sizeRef.current;
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
        startedAt: Date.now(),
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
