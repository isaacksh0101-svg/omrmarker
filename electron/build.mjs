// `npm run dist`의 실제 진입점. prepare.mjs로 배포용 리소스를 모은 뒤 electron-builder를
// 돌려서 release/win-unpacked를 만들고, 배포하기 좋게 zip 하나로 묶는다.
//
// electron-builder가 patching 이후 macOS 코드서명 도구(winCodeSign)를 내려받으려다,
// 이 PC에 Windows 개발자 모드가 꺼져 있어서(symlink 생성 권한 없음) 압축 풀기에 실패하고
// 매번 0이 아닌 종료 코드를 내는 걸 확인했다 - 이건 nsis/portable/dir 타겟과 무관하게
// 항상 일어나고, 실제 앱 패키징(release/win-unpacked에 exe 쓰기) 자체는 그 이전에 이미
// 끝나 있어 결과물엔 영향이 없다. 그래서 electron-builder가 실패로 종료해도 실제로
// exe가 만들어졌는지 직접 확인해서 진짜 성공/실패를 판단한다.
//
// 나중에 "설정 > 개인 정보 및 보안 > 개발자용 > 개발자 모드"를 켜고 win.target을
// "nsis"로 되돌리면 이 문제 없이 진짜 설치 마법사(.exe)를 만들 수 있다.
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const unpackedDir = path.join(__dirname, 'release', 'win-unpacked');
const exePath = path.join(unpackedDir, 'ScoreLab.exe');
const zipPath = path.join(__dirname, 'release', 'ScoreLab-win-portable.zip');

function run(cmd, { allowFailure = false } = {}) {
  console.log(`$ ${cmd}`);
  try {
    execSync(cmd, {
      cwd: __dirname,
      stdio: 'inherit',
      env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' },
    });
  } catch (err) {
    if (!allowFailure) throw err;
    console.warn(`(계속 진행: ${err.message})`);
  }
}

const electronBuilderBin = path.join(
  __dirname,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'electron-builder.cmd' : 'electron-builder',
);

run('node prepare.mjs');
run(`"${electronBuilderBin}"`, { allowFailure: true });

if (!fs.existsSync(exePath)) {
  console.error(`\n[실패] ${exePath} 가 만들어지지 않았습니다. 위 로그를 확인해주세요.`);
  process.exit(1);
}

console.log(`\n[성공] ${exePath}`);

if (process.platform === 'win32') {
  // PowerShell Compress-Archive는 node_modules 안 일부 패키지(예: jimp 테스트 스냅샷)의
  // 깊게 중첩된 경로에서 Windows 260자 경로 제한에 걸려 일부 파일을 빠뜨린다. electron-
  // builder가 이미 의존성으로 내려받아둔 7-Zip(긴 경로를 문제없이 다룸)을 대신 쓴다.
  console.log('배포용 zip으로 묶는 중...');
  fs.rmSync(zipPath, { force: true });
  const sevenZip = path.join(__dirname, 'node_modules', '7zip-bin', 'win', 'x64', '7za.exe');
  run(`"${sevenZip}" a -tzip "${zipPath}" "${unpackedDir}\\*"`);
  console.log(`[완료] ${zipPath} - 이 파일만 보내면 됩니다(압축 풀고 ScoreLab.exe 실행).`);
}
