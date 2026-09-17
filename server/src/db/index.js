import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { config } from '../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

fs.mkdirSync(config.dataDir, { recursive: true });
fs.mkdirSync(config.uploadsDir, { recursive: true });

// node:sqlite (Node.js 내장 모듈)를 사용한다. better-sqlite3 등 네이티브 모듈은
// 교사 PC에 Visual Studio Build Tools가 없으면 설치가 안 되는 경우가 많아,
// Node.js에 이미 포함되어 있어 별도 컴파일이 필요 없는 이 모듈을 택했다.
export const db = new DatabaseSync(config.dbPath);

// WAL 대신 DELETE 저널 모드: DB가 OneDrive 동기화 폴더 안에 있어
// 보조 파일(-wal/-shm) 개수를 최소화해 동기화 충돌 위험을 줄인다.
db.exec('PRAGMA journal_mode = DELETE');
db.exec('PRAGMA foreign_keys = ON');

const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8');
db.exec(schema);

// 가벼운 마이그레이션: schema.sql의 CREATE TABLE IF NOT EXISTS는 이미 만들어진 테이블에
// 새 컬럼을 추가하지 않으므로, 기존 DB 파일에 없는 컬럼은 여기서 직접 채워준다.
const examColumns = db.prepare('PRAGMA table_info(exams)').all().map((c) => c.name);
if (!examColumns.includes('mode')) {
  db.exec("ALTER TABLE exams ADD COLUMN mode TEXT NOT NULL DEFAULT 'online'");
}

const sessionColumns = db.prepare('PRAGMA table_info(exam_sessions)').all().map((c) => c.name);
if (!sessionColumns.includes('extra_time_sec')) {
  db.exec('ALTER TABLE exam_sessions ADD COLUMN extra_time_sec INTEGER NOT NULL DEFAULT 0');
}
if (!sessionColumns.includes('allow_rejoin')) {
  db.exec('ALTER TABLE exam_sessions ADD COLUMN allow_rejoin INTEGER NOT NULL DEFAULT 0');
}
if (!sessionColumns.includes('disqualify_reason')) {
  db.exec('ALTER TABLE exam_sessions ADD COLUMN disqualify_reason TEXT');
}

const questionColumns = db.prepare('PRAGMA table_info(questions)').all().map((c) => c.name);
if (!questionColumns.includes('prompt_image_path')) {
  db.exec('ALTER TABLE questions ADD COLUMN prompt_image_path TEXT');
}
if (!questionColumns.includes('ai_standard_candidates')) {
  db.exec('ALTER TABLE questions ADD COLUMN ai_standard_candidates TEXT');
}
