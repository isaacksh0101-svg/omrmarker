import { Jimp } from 'jimp';
import { config } from '../config.js';

const JPEG_MIME = 'image/jpeg';
const PNG_MIME = 'image/png';

// 문항 크롭은 선명한 업로드 원본으로 수행해야 하므로 이 함수는 입력 Buffer를 변경하지
// 않고 Gemini 전송용 복사본만 만든다. WEBP는 Jimp가 읽을 수는 있지만 현재 구성에서
// 다시 WEBP로 내보내지는 못하므로, 축소가 필요한 경우 PNG로 변환한다.
export async function prepareAiImage(imageBuffer, mimeType) {
  let image;
  try {
    image = await Jimp.read(imageBuffer);
  } catch {
    // 전처리 실패 때문에 기존에 Gemini가 직접 읽을 수 있던 파일까지 막지 않는다.
    return { buffer: imageBuffer, mimeType, resized: false, width: null, height: null };
  }

  const originalWidth = image.bitmap.width;
  const originalHeight = image.bitmap.height;
  const maxWidth = Math.max(1, config.gemini.maxImageWidth);
  const maxHeight = Math.max(1, config.gemini.maxImageHeight);
  const scale = Math.min(1, maxWidth / originalWidth, maxHeight / originalHeight);

  if (scale >= 1) {
    return {
      buffer: imageBuffer,
      mimeType,
      resized: false,
      width: originalWidth,
      height: originalHeight,
    };
  }

  const width = Math.max(1, Math.round(originalWidth * scale));
  const height = Math.max(1, Math.round(originalHeight * scale));
  image.resize({ w: width, h: height });

  const outputMimeType = mimeType === JPEG_MIME ? JPEG_MIME : PNG_MIME;
  const buffer = outputMimeType === JPEG_MIME
    ? await image.getBuffer(JPEG_MIME, { quality: 88 })
    : await image.getBuffer(PNG_MIME);

  return { buffer, mimeType: outputMimeType, resized: true, width, height };
}
