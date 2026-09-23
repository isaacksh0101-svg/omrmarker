import { execSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const releaseDir = path.join(__dirname, 'release');
const unpackedDir = path.join(releaseDir, 'win-unpacked');
const exePath = path.join(unpackedDir, 'ScoreLab.exe');

function run(cmd) {
  console.log(`$ ${cmd}`);
  execSync(cmd, {
    cwd: __dirname,
    stdio: 'inherit',
    env: {
      ...process.env,
      CSC_IDENTITY_AUTO_DISCOVERY:
        process.env.CSC_LINK || process.env.WIN_CSC_LINK ? 'true' : 'false',
    },
  });
}

const electronBuilderBin = path.join(
  __dirname,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'electron-builder.cmd' : 'electron-builder',
);

// 이전 버전 산출물이 새 배포본과 섞이지 않도록 빌드 출력 폴더만 정리한다.
fs.rmSync(releaseDir, { recursive: true, force: true });

run('node prepare.mjs');
run(`"${electronBuilderBin}"`);

if (!fs.existsSync(exePath)) {
  console.error(`\n[실패] 실행 파일이 생성되지 않았습니다: ${exePath}`);
  process.exit(1);
}

const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
const installerName = `ScoreLab-Setup-${packageJson.version}-x64.exe`;
const installerPath = path.join(releaseDir, installerName);
if (!fs.existsSync(installerPath)) {
  console.error(`\n[실패] 설치 파일을 찾을 수 없습니다: ${installerPath}`);
  process.exit(1);
}

const hash = crypto.createHash('sha256').update(fs.readFileSync(installerPath)).digest('hex');
fs.writeFileSync(path.join(releaseDir, 'SHA256SUMS.txt'), `${hash}  ${installerName}\n`, 'utf8');

const releaseMetadataDir = path.join(repoRoot, 'docs', 'release');
for (const file of [
  'CHANGELOG.md',
  'SECURITY.md',
  'LICENSE.md',
  path.join('docs', '배포-업데이트-복구-안내.md'),
]) {
  fs.copyFileSync(path.join(repoRoot, file), path.join(releaseDir, path.basename(file)));
}
for (const file of fs.readdirSync(releaseMetadataDir)) {
  fs.copyFileSync(path.join(releaseMetadataDir, file), path.join(releaseDir, file));
}

let gitCommit = 'unknown';
let workingTree = 'unknown';
try {
  gitCommit = execSync('git rev-parse HEAD', { cwd: repoRoot, encoding: 'utf8' }).trim();
  workingTree = execSync('git status --porcelain', { cwd: repoRoot, encoding: 'utf8' }).trim()
    ? 'modified'
    : 'clean';
} catch {
  // Git 메타데이터가 없는 소스 압축본에서도 빌드는 계속한다.
}

const codeSigningRequested = Boolean(process.env.CSC_LINK || process.env.WIN_CSC_LINK);
const manifest = {
  product: 'ScoreLab',
  version: packageJson.version,
  builtAt: new Date().toISOString(),
  installer: installerName,
  sha256: hash,
  sourceCommit: gitCommit,
  workingTree,
  codeSigningRequested,
  codeSigningStatus: codeSigningRequested ? 'certificate-configured' : 'not-signed',
};
fs.writeFileSync(path.join(releaseDir, 'RELEASE-MANIFEST.json'), JSON.stringify(manifest, null, 2), 'utf8');

console.log(`\n[성공] ${installerPath}`);
console.log(`[SHA-256] ${hash}  ${installerName}`);
