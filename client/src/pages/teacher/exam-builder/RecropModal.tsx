import { useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { api, ApiError } from '../../../api/client';
import { Button } from '../../../components/Button';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl;

// PDF 페이지를 서버(renderPdfPages.js)와 비슷한 해상도로 렌더링해야 자른 결과물 화질이
// 기존 AI 자동 자르기와 비슷하게 나온다.
const PDF_RENDER_SCALE = 2.5;

interface Props {
  examId: number;
  questionId: number;
  onClose: () => void;
  onDone: () => void;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

// AI가 자동으로 잘라준 문항 이미지가 잘못됐을 때 쓰는 수동 재크롭 도구. 교사가 자신의
// 컴퓨터에서 원본 PDF/이미지를 다시 골라(서버에는 전혀 올라가지 않는다) 브라우저 안에서만
// 렌더링하고, 마우스로 영역을 드래그해 고른 뒤 그 부분만 잘라 서버로 올린다. 그래서 서버가
// 시험지 원본 이미지를 따로 보관해둘 필요가 없다.
export function RecropModal({ examId, questionId, onClose, onDone }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [pageIndex, setPageIndex] = useState(1);
  const [pageCount, setPageCount] = useState(1);
  const [rendering, setRendering] = useState(false);
  const [selection, setSelection] = useState<Rect | null>(null);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasImage, setHasImage] = useState(false);

  async function renderPdfPage(doc: pdfjsLib.PDFDocumentProxy, n: number) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setRendering(true);
    try {
      const page = await doc.getPage(n);
      const viewport = page.getViewport({ scale: PDF_RENDER_SCALE });
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      await page.render({ canvasContext: ctx, viewport, canvas }).promise;
      setSelection(null);
      setHasImage(true);
    } finally {
      setRendering(false);
    }
  }

  function renderImageFile(file: File) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      ctx?.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      setSelection(null);
      setHasImage(true);
    };
    img.src = url;
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setPdfDoc(null);
    setHasImage(false);
    if (file.type === 'application/pdf') {
      try {
        const buf = await file.arrayBuffer();
        const doc = await pdfjsLib.getDocument({ data: buf }).promise;
        setPdfDoc(doc);
        setPageCount(doc.numPages);
        setPageIndex(1);
        await renderPdfPage(doc, 1);
      } catch {
        setError('PDF를 읽을 수 없습니다.');
      }
    } else {
      setPageCount(1);
      setPageIndex(1);
      renderImageFile(file);
    }
  }

  useEffect(() => {
    if (pdfDoc) renderPdfPage(pdfDoc, pageIndex);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageIndex]);

  // 오버레이(화면에 보이는 CSS 크기) 좌표를 실제 캔버스 해상도 좌표로 변환한다 - 캔버스는
  // 고화질로 그려두고 화면엔 그보다 작게 보여주므로 둘의 배율이 다르다.
  function toCanvasPoint(clientX: number, clientY: number) {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: Math.max(0, Math.min(canvas.width, (clientX - rect.left) * scaleX)),
      y: Math.max(0, Math.min(canvas.height, (clientY - rect.top) * scaleY)),
    };
  }

  function handlePointerDown(e: React.PointerEvent) {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const p = toCanvasPoint(e.clientX, e.clientY);
    setDragStart(p);
    setSelection({ x: p.x, y: p.y, w: 0, h: 0 });
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (!dragStart) return;
    const p = toCanvasPoint(e.clientX, e.clientY);
    setSelection({
      x: Math.min(dragStart.x, p.x),
      y: Math.min(dragStart.y, p.y),
      w: Math.abs(p.x - dragStart.x),
      h: Math.abs(p.y - dragStart.y),
    });
  }

  function handlePointerUp() {
    setDragStart(null);
  }

  async function applyCrop() {
    const canvas = canvasRef.current;
    if (!canvas || !selection || selection.w < 5 || selection.h < 5) return;
    setUploading(true);
    setError(null);
    try {
      const out = document.createElement('canvas');
      out.width = Math.round(selection.w);
      out.height = Math.round(selection.h);
      const ctx = out.getContext('2d');
      if (!ctx) throw new Error('캔버스를 만들 수 없습니다.');
      ctx.drawImage(
        canvas,
        selection.x,
        selection.y,
        selection.w,
        selection.h,
        0,
        0,
        out.width,
        out.height,
      );
      const blob: Blob | null = await new Promise((resolve) => out.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('이미지를 만들 수 없습니다.');

      const formData = new FormData();
      formData.append('image', blob, 'crop.png');
      await api.postForm(`/exams/${examId}/questions/${questionId}/prompt-image`, formData);
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '이미지를 자르는 중 오류가 발생했습니다.');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div
      className="animate-overlay-in fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4"
      onClick={onClose}
    >
      <div
        className="animate-scale-in flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-panel shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="text-sm font-bold text-ink">문항 이미지 다시 자르기</h2>
          <button className="text-xs text-ink-soft hover:text-danger" onClick={onClose}>
            닫기
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <p className="text-xs text-ink-soft">
            이 문항의 원본이 담긴 PDF나 이미지 파일을 다시 선택하세요. 파일은 서버로 전송되지
            않고 이 화면 안에서만 열리며, 영역을 잘라낸 결과 이미지만 저장됩니다.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,application/pdf"
              onChange={handleFileChange}
              className="hidden"
              id="recrop-file-input"
            />
            <Button variant="secondary" onClick={() => fileInputRef.current?.click()}>
              파일 선택
            </Button>
            {pdfDoc && pageCount > 1 && (
              <div className="flex items-center gap-2 text-xs text-ink-soft">
                <button
                  className="rounded-lg border border-line px-2 py-1 disabled:opacity-40"
                  disabled={pageIndex <= 1 || rendering}
                  onClick={() => setPageIndex((p) => p - 1)}
                >
                  이전 쪽
                </button>
                <span>
                  {pageIndex} / {pageCount}쪽
                </span>
                <button
                  className="rounded-lg border border-line px-2 py-1 disabled:opacity-40"
                  disabled={pageIndex >= pageCount || rendering}
                  onClick={() => setPageIndex((p) => p + 1)}
                >
                  다음 쪽
                </button>
              </div>
            )}
          </div>

          <div
            ref={overlayRef}
            className="relative mt-3 touch-none select-none overflow-hidden rounded-lg border border-line bg-bg"
            onPointerDown={hasImage ? handlePointerDown : undefined}
            onPointerMove={hasImage ? handlePointerMove : undefined}
            onPointerUp={hasImage ? handlePointerUp : undefined}
          >
            <canvas ref={canvasRef} className={hasImage ? 'block w-full cursor-crosshair' : 'hidden'} />
            {selection && canvasRef.current && (
              <div
                className="pointer-events-none absolute border-2 border-accent bg-accent/20"
                style={{
                  left: `${(selection.x / canvasRef.current.width) * 100}%`,
                  top: `${(selection.y / canvasRef.current.height) * 100}%`,
                  width: `${(selection.w / canvasRef.current.width) * 100}%`,
                  height: `${(selection.h / canvasRef.current.height) * 100}%`,
                }}
              />
            )}
            {!hasImage && (
              <p className="p-6 text-center text-xs text-ink-soft">파일을 선택하면 여기 미리보기가 표시됩니다.</p>
            )}
          </div>
          {hasImage && (
            <p className="mt-1 text-[11px] text-ink-soft">
              문항 전체(객관식이면 보기 포함)를 감싸도록 마우스로 드래그해서 영역을 고르세요.
            </p>
          )}

          {error && <p className="mt-2 text-xs font-bold text-danger">{error}</p>}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-4">
          <Button variant="secondary" onClick={onClose}>
            취소
          </Button>
          <Button
            disabled={!selection || selection.w < 5 || selection.h < 5 || uploading}
            onClick={applyCrop}
          >
            {uploading ? '저장 중...' : '이 영역으로 자르기'}
          </Button>
        </div>
      </div>
    </div>
  );
}
