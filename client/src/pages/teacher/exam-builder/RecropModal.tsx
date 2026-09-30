import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
  // 'append'면 새로 고른 영역을 기존 문항 이미지 위에 이어붙여 한 장으로 합친다(예: 국어
  // 지문처럼 문항 자체엔 없지만 학생에게 같이 보여줘야 하는 내용을 추가할 때). 기본은
  // 기존처럼 통째로 교체하는 'replace'.
  mode?: 'replace' | 'append';
  existingImagePath?: string | null;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('기존 문항 이미지를 불러올 수 없습니다.'));
    img.src = src;
  });
}

// AI가 자동으로 잘라준 문항 이미지가 잘못됐을 때 쓰는 수동 재크롭 도구. AI 분석 당시
// 저장한 원본 페이지를 자동으로 불러오고, 예전 시험처럼 원본이 없을 때만 파일을 다시 고른다.
export function RecropModal({ examId, questionId, onClose, onDone, mode = 'replace', existingImagePath }: Props) {
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
  const [loadingSource, setLoadingSource] = useState(true);
  const [hasSavedSource, setHasSavedSource] = useState(false);

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

  function renderImageBlob(file: Blob) {
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
      renderImageBlob(file);
    }
  }

  useEffect(() => {
    let cancelled = false;
    async function loadSavedSource() {
      try {
        const response = await fetch(`/api/exams/${examId}/questions/${questionId}/source-image`);
        if (!response.ok) return;
        const blob = await response.blob();
        if (cancelled) return;
        setHasSavedSource(true);
        renderImageBlob(blob);
      } catch {
        // 이전 버전에서 만든 문항은 원본이 없을 수 있으므로 파일 선택 방식으로 자연스럽게 폴백한다.
      } finally {
        if (!cancelled) setLoadingSource(false);
      }
    }
    loadSavedSource();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [examId, questionId]);

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
      const cropped = document.createElement('canvas');
      cropped.width = Math.round(selection.w);
      cropped.height = Math.round(selection.h);
      const croppedCtx = cropped.getContext('2d');
      if (!croppedCtx) throw new Error('캔버스를 만들 수 없습니다.');
      croppedCtx.drawImage(
        canvas,
        selection.x,
        selection.y,
        selection.w,
        selection.h,
        0,
        0,
        cropped.width,
        cropped.height,
      );

      let out = cropped;
      if (mode === 'append' && existingImagePath) {
        // 새로 고른 영역(지문 등)을 위에, 기존 문항 이미지를 아래에 이어붙여 한 장으로 합친다.
        const existingImg = await loadImageElement(`/uploads/${existingImagePath}`);
        const combined = document.createElement('canvas');
        combined.width = Math.max(cropped.width, existingImg.naturalWidth);
        combined.height = cropped.height + existingImg.naturalHeight;
        const combinedCtx = combined.getContext('2d');
        if (!combinedCtx) throw new Error('캔버스를 만들 수 없습니다.');
        combinedCtx.fillStyle = '#ffffff';
        combinedCtx.fillRect(0, 0, combined.width, combined.height);
        combinedCtx.drawImage(cropped, 0, 0);
        combinedCtx.drawImage(existingImg, 0, cropped.height);
        out = combined;
      }

      const blob: Blob | null = await new Promise((resolve) => out.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('이미지를 만들 수 없습니다.');

      const formData = new FormData();
      formData.append('image', blob, 'crop.png');
      await api.postForm(`/exams/${examId}/questions/${questionId}/prompt-image`, formData);
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '이미지를 처리하는 중 오류가 발생했습니다.');
    } finally {
      setUploading(false);
    }
  }

  return createPortal(
    // Card 등 조상 요소에 backdrop-blur(=backdrop-filter)가 있으면 CSS 스펙상 그 요소가
    // position:fixed 자손의 containing block이 되어버려서, 이 모달이 뷰포트가 아니라
    // 그 조상 박스 기준으로 배치된다. 문항 목록처럼 긴 카드 안에서 열면 화면 밖으로 잘려
    // 보이는 문제가 있어 body에 포털로 붙여 항상 뷰포트 기준으로 뜨게 한다.
    <div
      className="animate-overlay-in fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4"
      onClick={onClose}
    >
      <div
        className="animate-scale-in flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-panel shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="text-sm font-bold text-ink">
            {mode === 'append' ? '추가 정보 크롭하기' : existingImagePath ? '문항 이미지 다시 자르기' : '문항 이미지 추가'}
          </h2>
          <button className="text-xs text-ink-soft hover:text-danger" onClick={onClose}>
            닫기
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <p className="text-xs text-ink-soft">
            {loadingSource
              ? 'AI 분석에 사용한 원본 페이지를 불러오는 중입니다.'
              : hasSavedSource
                ? 'AI 분석에 사용한 원본 페이지입니다. 문항 영역을 바로 선택하세요.'
                : '넣을 그림이 있는 PDF나 이미지 파일을 선택한 뒤, 보여줄 영역을 선택하세요.'}
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
              {hasSavedSource ? '다른 파일 선택' : '파일 선택'}
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
              <p className="p-6 text-center text-xs text-ink-soft">
                {loadingSource ? '원본 페이지를 불러오는 중...' : '파일을 선택하면 여기 미리보기가 표시됩니다.'}
              </p>
            )}
          </div>
          {hasImage && (
            <p className="mt-1 text-[11px] text-ink-soft">
              {mode === 'append'
                ? '지문 등 문항에 함께 보여줄 영역을 마우스로 드래그해서 고르세요. 선택한 영역이 기존 문항 이미지 위에 이어붙습니다.'
                : '문항 전체(객관식이면 보기 포함)를 감싸도록 마우스로 드래그해서 영역을 고르세요.'}
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
            {uploading ? '저장 중...' : mode === 'append' ? '이 영역 추가하기' : '이 영역으로 자르기'}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
