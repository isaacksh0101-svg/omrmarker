import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

// 실행 방식(실행하기.bat/개발 서버/Electron 패키징)과 무관하게 교사가 환경설정 화면에서
// 직접 입력한 값은 dataDir 밑 settings.json에 저장한다. .env의 GEMINI_API_KEY는 개발 중
// 기본값 용도로만 남겨두고, settings.json에 값이 있으면 그쪽이 우선한다.
function settingsPath() {
  return path.join(config.dataDir, 'settings.json');
}

function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsPath(), 'utf-8'));
  } catch {
    return {};
  }
}

function writeSettings(partial) {
  const next = { ...readSettings(), ...partial };
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.writeFileSync(settingsPath(), JSON.stringify(next, null, 2));
  return next;
}

// ---- settings.json 안의 민감한 값(Gemini API 키, 세션 서명 비밀키) 암호화 ----
// 이 파일이 화면 공유, 백업 파일 오공유, 클라우드 동기화 폴더 미리보기 등으로 실수로
// 노출됐을 때 평문 그대로 보이는 걸 막기 위한 것이다. 암호화 키는 settings.json과
// 별도 파일(.settings.key)에 두어 "같은 파일 안에 열쇠와 자물쇠가 같이 있는" 가장
// 단순한 실수는 피했지만, 두 파일 다에 접근 가능한 공격자에게는 방어가 안 된다는
// 한계는 분명히 남는다 - node:sqlite가 네이티브 컴파일 없이 쓰기 위해 채택된 것처럼,
// 이 프로젝트는 SQLCipher 같은 네이티브 암호화 모듈을 교사 PC 빌드 환경 문제 때문에
// 쓸 수 없어 DB 자체는 암호화하지 않는다(대신 OS 디스크 암호화를 권장한다) - 이건
// 그 제약이 없는 이 작은 JSON 파일에만 적용 가능한 조치다.
const ENCRYPTED_PREFIX = 'enc:v1:';

function keyFilePath() {
  return path.join(config.dataDir, '.settings.key');
}

function getEncryptionKey() {
  try {
    return fs.readFileSync(keyFilePath());
  } catch {
    const key = crypto.randomBytes(32);
    fs.mkdirSync(config.dataDir, { recursive: true });
    fs.writeFileSync(keyFilePath(), key);
    return key;
  }
}

function encryptValue(plain) {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(String(plain), 'utf-8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return ENCRYPTED_PREFIX + Buffer.concat([iv, authTag, encrypted]).toString('base64');
}

// 이 코드를 넣기 전에 이미 평문으로 저장돼 있던 값과도 호환되도록, enc:v1: 접두어가
// 없으면 그냥 원래 값을 그대로 돌려준다(=아직 암호화 전).
function decryptValue(stored) {
  if (typeof stored !== 'string' || !stored.startsWith(ENCRYPTED_PREFIX)) return stored;
  const key = getEncryptionKey();
  const raw = Buffer.from(stored.slice(ENCRYPTED_PREFIX.length), 'base64');
  const iv = raw.subarray(0, 12);
  const authTag = raw.subarray(12, 28);
  const encrypted = raw.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf-8');
}

// 읽을 때 아직 암호화 전(구버전)인 값을 발견하면 그 자리에서 암호화해 다시 저장한다 -
// 교사가 키를 다시 입력하지 않아도 다음 실행부터 자동으로 암호화된 상태로 올라간다.
function readEncryptedField(fieldName) {
  const settings = readSettings();
  const stored = settings[fieldName];
  if (!stored) return null;
  const plain = decryptValue(stored);
  if (!stored.startsWith(ENCRYPTED_PREFIX)) {
    writeSettings({ [fieldName]: encryptValue(plain) });
  }
  return plain;
}

export function getGeminiApiKey() {
  return readEncryptedField('geminiApiKey') || config.gemini.apiKey || '';
}

export function setGeminiApiKey(apiKey) {
  // 키가 바뀌면 이전 프로젝트에서 받아둔 모델 목록은 더 이상 유효하지 않을 수 있다.
  writeSettings({ geminiApiKey: encryptValue(apiKey), geminiModelCatalog: null });
}

export function getGeminiModel() {
  return readSettings().geminiModel || config.gemini.model;
}

export function setGeminiModel(model) {
  writeSettings({ geminiModel: model });
}

export function getGeminiModelCatalog() {
  return readSettings().geminiModelCatalog || null;
}

export function setGeminiModelCatalog(catalog) {
  writeSettings({ geminiModelCatalog: catalog });
}

// ---- 교사 로그인(계정 하나짜리 비밀번호) ----
// 비밀번호는 scrypt(salt+해시)로만 저장한다 - 원문은 어디에도 남기지 않는다.

function scryptHash(password, saltHex) {
  return crypto.scryptSync(password, saltHex, 64).toString('hex');
}

export function hasTeacherPassword() {
  return Boolean(readSettings().teacherPasswordHash);
}

export function setTeacherPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = scryptHash(password, salt);
  writeSettings({ teacherPasswordHash: `${salt}:${hash}` });
}

export function verifyTeacherPassword(password) {
  const stored = readSettings().teacherPasswordHash;
  if (!stored) return false;
  const [salt, hash] = stored.split(':');
  const candidate = scryptHash(password, salt);
  const a = Buffer.from(candidate, 'hex');
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ---- 로그인 세션(쿠키) ----
// 서버 프로세스 재시작에도 로그인이 유지되도록, 세션 비밀키를 settings.json에 보관해두고
// 그걸로 서명한 토큰(만료시각+HMAC)을 발급한다 - 서버가 토큰을 따로 저장/조회할 필요가 없다.

export const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12시간

function getSessionSecret() {
  const existing = readEncryptedField('sessionSecret');
  if (existing) return existing;
  const plain = crypto.randomBytes(32).toString('hex');
  writeSettings({ sessionSecret: encryptValue(plain) });
  return plain;
}

export function issueSessionToken() {
  const secret = getSessionSecret();
  const expires = Date.now() + SESSION_TTL_MS;
  const sig = crypto.createHmac('sha256', secret).update(String(expires)).digest('hex');
  return `${expires}.${sig}`;
}

export function verifySessionToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return false;
  const [expiresStr, sig] = token.split('.');
  const expires = Number(expiresStr);
  if (!Number.isFinite(expires) || Date.now() > expires) return false;
  const secret = getSessionSecret();
  const expected = crypto.createHmac('sha256', secret).update(String(expires)).digest('hex');
  const a = Buffer.from(sig, 'hex');
  const b = Buffer.from(expected, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
