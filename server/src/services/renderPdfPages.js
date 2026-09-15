import { createCanvas } from '@napi-rs/canvas';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

// PDF로 업로드된 시험지를 페이지별 PNG 이미지로 바꾼다. 이렇게 만든 이미지는 이후 이미지
// 업로드와 완전히 같은 경로(AI 추출 + 발문 이미지 자르기)를 그대로 탄다 - PDF 자체에서
// 직접 잘라낼 방법이 없어서(그러려면 이 변환이 필요) 거친 첫 단계다.
//
// 시험지 한 장이 여러 쪽으로 이어지는 일은 드물지만, 실수로 큰 PDF를 올렸을 때 페이지마다
// AI 호출이 나가 비용/시간이 과하게 커지는 걸 막기 위해 상한을 둔다.
const MAX_PAGES = 10;
const RENDER_SCALE = 2.5; // 72dpi 기준 PDF 포인트를 약 180dpi 상당으로 - 손글씨/작은 분수도 alaible히 읽히는 수준.

export async function renderPdfToImages(pdfBuffer) {
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(pdfBuffer),
    useWorkerFetch: false,
    isEvalSupported: false,
  });
  const pdf = await loadingTask.promise;

  if (pdf.numPages > MAX_PAGES) {
    throw new Error(`PDF 페이지가 너무 많습니다(${pdf.numPages}쪽). 시험지당 ${MAX_PAGES}쪽 이하로 나눠서 올려주세요.`);
  }

  const images = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: RENDER_SCALE });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport }).promise;
    images.push(await canvas.encode('png'));
  }
  return images;
}
