// electron-builder가 그대로 패키징할 수 있게, 배포에 필요한 것만 .staging/app 아래에
// 깨끗하게 모아둔다:
//   .staging/app/server     - 서버 소스 + 프로덕션 전용으로 새로 설치한 node_modules
//   .staging/app/client/dist - 빌드된 클라이언트 정적 파일
//   .staging/app/curriculum - 성취기준 데이터
// server/src/config.js의 PROJECT_ROOT(__dirname에서 두 단계 위)가 이 구조를 그대로
// 전제하므로, 이 셋의 상대 위치(app/ 바로 아래)를 절대 바꾸면 안 된다.
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const stagingApp = path.join(__dirname, '.staging', 'app');

function run(cmd, cwd) {
  console.log(`$ ${cmd}  (in ${path.relative(repoRoot, cwd) || '.'})`);
  execSync(cmd, { cwd, stdio: 'inherit' });
}

console.log('[1/4] 이전 스테이징 폴더 정리...');
fs.rmSync(path.join(__dirname, '.staging'), { recursive: true, force: true });
fs.mkdirSync(stagingApp, { recursive: true });

console.log('[2/4] 클라이언트 빌드...');
run('npm run build', path.join(repoRoot, 'client'));

// 점(.)으로 시작하는 파일/폴더(.env, .env.local, .claude, .git 등)는 절대 포함하지
// 않는다 - .env엔 GEMINI_API_KEY 같은 실제 비밀키가 들어있어서, 이걸 그대로 패키징하면
// 이 설치 프로그램을 받는 모든 교사에게 내 API 키가 그대로 배포되는 사고로 이어진다.
function excludeDotfilesAndDirs(...dirNames) {
  return (src) => {
    const base = path.basename(src);
    if (base.startsWith('.')) return false;
    if (dirNames.includes(base)) return false;
    return true;
  };
}

console.log('[3/4] 서버 소스 복사 + 프로덕션 의존성만 새로 설치...');
const serverSrc = path.join(repoRoot, 'server');
const serverDest = path.join(stagingApp, 'server');
fs.cpSync(serverSrc, serverDest, {
  recursive: true,
  // node_modules/data는 그대로 복사하면 개발용 잔여물이 섞이거나(예전 실행 때 쌓인
  // sqlite/업로드 파일) 용량만 커지므로 제외 - node_modules는 아래서 새로 깨끗하게
  // 설치하고, data(사용자 실제 데이터)는 애초에 설치본에 들어가면 안 된다.
  filter: excludeDotfilesAndDirs('node_modules', 'data'),
});
run('npm install --omit=dev', serverDest);

console.log('[4/4] 클라이언트 빌드 결과물 + 성취기준 데이터 복사...');
fs.mkdirSync(path.join(stagingApp, 'client'), { recursive: true });
fs.cpSync(path.join(repoRoot, 'client', 'dist'), path.join(stagingApp, 'client', 'dist'), {
  recursive: true,
  filter: excludeDotfilesAndDirs(),
});
fs.cpSync(path.join(repoRoot, 'curriculum'), path.join(stagingApp, 'curriculum'), {
  recursive: true,
  filter: excludeDotfilesAndDirs(),
});

console.log('완료: electron/.staging/app 준비됨.');
