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
    // 원본은 문항 이미지 자르기에 그대로 쓰고, Gemini에 전송하는 복사본만 이 범위 안으로
    // 축소한다. 휴대폰의 4K 이상 사진을 그대로 전송해 이미지 처리량이 불필요하게 커지는
    // 것을 막되, 시험지의 작은 글자와 수식을 읽을 수 있는 해상도는 남긴다.
    maxImageWidth: Number(process.env.GEMINI_MAX_IMAGE_WIDTH) || 2200,
    maxImageHeight: Number(process.env.GEMINI_MAX_IMAGE_HEIGHT) || 2200,
  },
  // 화면 이탈 감지는 첫 이탈부터 즉시 강제 제출한다(경고 유예 없음). 이 값은 blur/
  // visibilitychange/fullscreenchange가 같은 탭 전환 한 번에 겹쳐 뜰 때 로그만 중복
  // 남지 않게 묶어주는 디바운스 창이다.
  anticheatDebounceMs: Number(process.env.ANTICHEAT_DEBOUNCE_MS) || 2000,
  // 기록만 남기고 봐주는 짧은 이탈(잠깐 포커스를 잃었다 돌아옴, 전체화면만 풀림)의 허용 횟수.
  // 이 횟수까지는 봐주고 그 다음 번부터는 진짜 이탈처럼 강제 종료한다 - 3초 유예 안에 AI 창과
  // 왔다 갔다 하며 답을 찾는 걸 막기 위함. 되살리기를 하면 다시 처음부터 센다.
  anticheatSoftLeaveLimit: Number(process.env.ANTICHEAT_SOFT_LEAVE_LIMIT) || 3,
};
