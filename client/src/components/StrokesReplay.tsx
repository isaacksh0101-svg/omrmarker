import { useEffect, useRef } from 'react';
import { drawAllStrokes, type StrokesPayload } from '../lib/strokes';

interface StrokesReplayProps {
  payload: StrokesPayload;
  className?: string;
}

// 리포트에서 학생이 문항을 풀 때 남긴 필기를 읽기전용으로 다시 그려 보여준다. 좌표는
// 캡처 당시 캔버스의 CSS 픽셀 기준이므로, 컨테이너를 그 원본 비율(aspect-ratio)로 고정하고
// 그 비율에 맞는 배율로 균일하게 늘려 그려야 실제 작성했던 모습과 같은 비율로 보인다.
export function StrokesReplay({ payload, className = '' }: StrokesReplayProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { width, height, strokes } = payload;

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas || width <= 0 || height <= 0) return;

    const draw = () => {
      const rect = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      // 컨테이너 비율을 원본(width/height)과 같게 고정해뒀으므로 두 축의 배율이 같다.
      const scale = (rect.width / width) * dpr;
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.clearRect(0, 0, width, height);
      drawAllStrokes(ctx, strokes);
    };

    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(container);
    return () => observer.disconnect();
  }, [strokes, width, height]);

  return (
    <div
      ref={containerRef}
      className={`relative ${className}`}
      style={{ aspectRatio: `${width} / ${height}` }}
    >
      <canvas ref={canvasRef} className="absolute inset-0" />
    </div>
  );
}
