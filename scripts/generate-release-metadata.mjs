import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = path.join(repoRoot, 'docs', 'release');
const appPackage = JSON.parse(fs.readFileSync(path.join(repoRoot, 'electron', 'package.json'), 'utf8'));
const rootLock = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package-lock.json'), 'utf8'));
const electronLock = JSON.parse(fs.readFileSync(path.join(repoRoot, 'electron', 'package-lock.json'), 'utf8'));

function packageNameFromPath(packagePath) {
  const marker = 'node_modules/';
  const index = packagePath.lastIndexOf(marker);
  return index === -1 ? null : packagePath.slice(index + marker.length);
}

function componentFromLock(packagePath, entry, scope) {
  const name = entry.name || packageNameFromPath(packagePath);
  if (!name || !entry.version) return null;
  return {
    type: 'library',
    name,
    version: entry.version,
    scope,
    licenses: entry.license ? [{ license: { id: entry.license } }] : [{ license: { name: 'UNKNOWN' } }],
    purl: `pkg:npm/${encodeURIComponent(name).replace('%40', '@') }@${entry.version}`,
  };
}

const components = [];
for (const [packagePath, entry] of Object.entries(rootLock.packages || {})) {
  if (!packagePath || entry.dev) continue;
  const component = componentFromLock(packagePath, entry, 'required');
  if (component) components.push(component);
}

const electronEntry = electronLock.packages?.['node_modules/electron'];
if (electronEntry) {
  components.push(componentFromLock('node_modules/electron', electronEntry, 'required'));
}
components.push({
  type: 'framework',
  name: 'Node.js runtime',
  version: process.version.replace(/^v/, ''),
  scope: 'required',
  licenses: [{ license: { id: 'MIT' } }],
  purl: `pkg:generic/nodejs@${process.version.replace(/^v/, '')}`,
});

const unique = [...new Map(components.filter(Boolean).map((item) => [`${item.name}@${item.version}`, item])).values()]
  .sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));

const sbom = {
  bomFormat: 'CycloneDX',
  specVersion: '1.5',
  serialNumber: `urn:uuid:${crypto.randomUUID()}`,
  version: 1,
  metadata: {
    timestamp: new Date().toISOString(),
    component: {
      type: 'application',
      name: 'ScoreLab',
      version: appPackage.version,
      supplier: { name: 'isaacksh0101' },
    },
  },
  components: unique,
};

fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(path.join(outputDir, `ScoreLab-${appPackage.version}-sbom.cdx.json`), JSON.stringify(sbom, null, 2));

const rows = unique.map((item) => {
  const license = item.licenses?.[0]?.license?.id || item.licenses?.[0]?.license?.name || 'UNKNOWN';
  return `| ${item.name.replaceAll('|', '\\|')} | ${item.version} | ${license.replaceAll('|', '\\|')} |`;
});
const notices = `# ScoreLab ${appPackage.version} 제3자 소프트웨어 목록\n\n`
  + `생성일: ${new Date().toISOString()}\n\n`
  + `ScoreLab 자체 배포 조건은 루트의 LICENSE.md를 따릅니다. 아래 구성요소에는 각 프로젝트의 라이선스가 적용됩니다. 설치본에 포함된 Electron의 전체 Chromium 고지는 설치 폴더의 LICENSES.chromium.html에서 확인할 수 있습니다.\n\n`
  + `| 구성요소 | 버전 | 라이선스 |\n|---|---:|---|\n${rows.join('\n')}\n`;
fs.writeFileSync(path.join(outputDir, `ScoreLab-${appPackage.version}-THIRD-PARTY-LICENSES.md`), notices, 'utf8');

console.log(`Generated release metadata for ScoreLab ${appPackage.version}: ${unique.length} components`);
