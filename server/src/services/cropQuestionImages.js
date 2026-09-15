import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Jimp } from 'jimp';
import { config } from '../config.js';

// AI가 좌표(bounding_box, 0~1000 정규화)를 준 문항은 원본 이미지에서 그 영역만 잘라
// 파일로 저장한다. PDF 업로드는 우리가 다시 래스터화할 방법이 없어서(의도적으로 그런 네이티브
// 라이브러리를 안 씀) 건너뛴다 - 그 경우 문항은 지금까지처럼 텍스트만 갖는다.
const RASTER_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);

function isValidBox(box) {
  if (!box || typeof box !== 'object') return false;
  const { ymin, xmin, ymax, xmax } = box;
  return [ymin, xmin, ymax, xmax].every((n) => typeof n === 'number' && Number.isFinite(n)) && xmax > xmin && ymax > ymin;
}

export async function cropQuestionImages(fileBuffer, mimeType, questions) {
  if (!RASTER_MIME.has(mimeType)) return questions;

  let source;
  try {
    source = await Jimp.read(fileBuffer);
  } catch {
    return questions; // 원본을 못 읽어도 자르기는 부가 기능이니 텍스트 추출 결과는 그대로 살린다.
  }

  const width = source.bitmap.width;
  const height = source.bitmap.height;
  const dir = path.join(config.uploadsDir, 'questions');
  fs.mkdirSync(dir, { recursive: true });

  const results = [];
  for (const q of questions) {
    if (!isValidBox(q.bounding_box)) {
      results.push(q);
      continue;
    }
    const { ymin, xmin, ymax, xmax } = q.bounding_box;
    const x = Math.max(0, Math.round((xmin / 1000) * width));
    const y = Math.max(0, Math.round((ymin / 1000) * height));
    const w = Math.min(width - x, Math.round(((xmax - xmin) / 1000) * width));
    const h = Math.min(height - y, Math.round(((ymax - ymin) / 1000) * height));
    if (w < 10 || h < 10) {
      results.push(q); // 모델이 이상한 좌표를 줬을 때의 방어 - 텍스트만 남긴다.
      continue;
    }

    try {
      const filename = `${crypto.randomUUID()}.png`;
      await source.clone().crop({ x, y, w, h }).write(path.join(dir, filename));
      results.push({ ...q, prompt_image_path: `questions/${filename}` });
    } catch {
      results.push(q);
    }
  }
  return results;
}
