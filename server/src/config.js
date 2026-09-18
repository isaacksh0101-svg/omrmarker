import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// server/src/config.js -> project2/
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

// 데스크톱 패키징(electron/)판은 설치 폴더(Program Files 등)에 쓰기 권한이 없을 수 있어,
// 실제 데이터는 OS별 사용자 데이터 폴더(예: %APPDATA%\ScoreLab)에 저장하고 그 경로를 이
// 환경변수로 넘겨준다. 지정 안 하면(개발/실행하기.bat 실행) 기존과 동일하게 프로젝트
// 폴더 밑 server/data를 그대로 쓴다.
const dataDir = process.env.SCORELAB_DATA_DIR
  ? path.resolve(process.env.SCORELAB_DATA_DIR)
  : path.resolve(PROJECT_ROOT, 'server', 'data');

export const config = {
  port: Number(process.env.PORT) || 4000,
  projectRoot: PROJECT_ROOT,
  dataDir,
  dbPath: path.resolve(dataDir, 'omr.sqlite3'),
  uploadsDir: path.resolve(dataDir, 'uploads'),
  clientDistDir: path.resolve(PROJECT_ROOT, 'client', 'dist'),
  curriculumStandardsPath: path.resolve(PROJECT_ROOT, 'curriculum', 'curriculum-standards.json'),
  aiProvider: process.env.AI_PROVIDER || 'gemini',
  gemini: {
    apiKey: process.env.GEMINI_API_KEY || '',
    model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
  },
  // 화면 이탈 감지는 첫 이탈부터 즉시 강제 제출한다(경고 유예 없음). 이 값은 blur/
  // visibilitychange/fullscreenchange가 같은 탭 전환 한 번에 겹쳐 뜰 때 로그만 중복
  // 남지 않게 묶어주는 디바운스 창이다.
  anticheatDebounceMs: Number(process.env.ANTICHEAT_DEBOUNCE_MS) || 2000,
};
