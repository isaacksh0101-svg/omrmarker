import multer from 'multer';

// Gemini는 PDF를 별도 변환 없이 그대로 이해할 수 있어(inline_data + application/pdf),
// 로컬에서 PDF를 이미지로 래스터화하는 네이티브 라이브러리(Windows 빌드 리스크가 큼)가 필요 없다.
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);

export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME.has(file.mimetype)) {
      return cb(new Error('이미지 파일(JPG/PNG/WEBP) 또는 PDF만 업로드할 수 있습니다.'));
    }
    cb(null, true);
  },
});
