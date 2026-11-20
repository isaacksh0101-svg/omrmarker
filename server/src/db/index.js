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
if (!examColumns.includes('archived_from_status')) {
  db.exec('ALTER TABLE exams ADD COLUMN archived_from_status TEXT');
}
if (!examColumns.includes('memo')) {
  db.exec('ALTER TABLE exams ADD COLUMN memo TEXT');
}
if (!examColumns.includes('admission_closed')) {
  db.exec('ALTER TABLE exams ADD COLUMN admission_closed INTEGER NOT NULL DEFAULT 0');
}
if (!examColumns.includes('supervised_at')) {
  db.exec('ALTER TABLE exams ADD COLUMN supervised_at TEXT');
}
if (!examColumns.includes('supervision_order')) {
  db.exec('ALTER TABLE exams ADD COLUMN supervision_order INTEGER');
}
if (!examColumns.includes('admission_code')) {
  db.exec('ALTER TABLE exams ADD COLUMN admission_code TEXT');
}
// 기능 추가 전에 이미 감독 목록에 올라가 있던 시험도 서버 재시작 직후 바로 입장할 수
// 있도록 최초 코드만 채운다. 이후 발급·재발급은 crypto.randomInt를 사용한다.
db.exec(`UPDATE exams
  SET admission_code = printf('%06d', (abs(random()) % 900000) + 100000)
  WHERE supervised_at IS NOT NULL AND ends_at IS NULL AND admission_code IS NULL`);

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
if (!sessionColumns.includes('access_token')) {
  db.exec('ALTER TABLE exam_sessions ADD COLUMN access_token TEXT');
}
if (!sessionColumns.includes('result_signed_at')) {
  db.exec('ALTER TABLE exam_sessions ADD COLUMN result_signed_at TEXT');
}
db.exec(
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_access_token ON exam_sessions(access_token) WHERE access_token IS NOT NULL',
);

const questionColumns = db.prepare('PRAGMA table_info(questions)').all().map((c) => c.name);
if (!questionColumns.includes('prompt_image_path')) {
  db.exec('ALTER TABLE questions ADD COLUMN prompt_image_path TEXT');
}
if (!questionColumns.includes('source_image_path')) {
  db.exec('ALTER TABLE questions ADD COLUMN source_image_path TEXT');
}
if (!questionColumns.includes('ai_standard_candidates')) {
  db.exec('ALTER TABLE questions ADD COLUMN ai_standard_candidates TEXT');
}
if (!questionColumns.includes('multi_select')) {
  db.exec('ALTER TABLE questions ADD COLUMN multi_select INTEGER NOT NULL DEFAULT 0');
}
if (!questionColumns.includes('show_prompt_text')) {
  db.exec('ALTER TABLE questions ADD COLUMN show_prompt_text INTEGER NOT NULL DEFAULT 0');
}
if (!questionColumns.includes('grading_mode')) {
  db.exec("ALTER TABLE questions ADD COLUMN grading_mode TEXT NOT NULL DEFAULT 'exact'");
}
if (!questionColumns.includes('keyword_rubric')) {
  db.exec('ALTER TABLE questions ADD COLUMN keyword_rubric TEXT');
}
if (!questionColumns.includes('full_credit')) {
  db.exec('ALTER TABLE questions ADD COLUMN full_credit INTEGER NOT NULL DEFAULT 0');
}
if (!questionColumns.includes('open_answer')) {
  db.exec('ALTER TABLE questions ADD COLUMN open_answer INTEGER NOT NULL DEFAULT 0');
}
if (!questionColumns.includes('rejected_short_answers')) {
  db.exec('ALTER TABLE questions ADD COLUMN rejected_short_answers TEXT');
}

const answerColumns = db.prepare('PRAGMA table_info(answers)').all().map((c) => c.name);
if (!answerColumns.includes('strokes_json')) {
  db.exec('ALTER TABLE answers ADD COLUMN strokes_json TEXT');
}
if (!answerColumns.includes('selected_choice_ids')) {
  db.exec('ALTER TABLE answers ADD COLUMN selected_choice_ids TEXT');
}
if (!answerColumns.includes('graded_by_teacher')) {
  db.exec('ALTER TABLE answers ADD COLUMN graded_by_teacher INTEGER NOT NULL DEFAULT 0');
}
if (!answerColumns.includes('visit_started_at')) {
  db.exec('ALTER TABLE answers ADD COLUMN visit_started_at TEXT');
}
if (!answerColumns.includes('visit_count')) {
  // 이전 방식은 문항마다 한 번씩만 봤으므로, 이미 보여준 문항은 1회 방문으로 채운다.
  db.exec('ALTER TABLE answers ADD COLUMN visit_count INTEGER NOT NULL DEFAULT 0');
  db.exec('UPDATE answers SET visit_count = 1');
}
if (!answerColumns.includes('first_is_correct')) {
  db.exec('ALTER TABLE answers ADD COLUMN first_is_correct INTEGER');
  db.exec('UPDATE answers SET first_is_correct = is_correct WHERE answered_at IS NOT NULL');
}
if (!answerColumns.includes('confirm_pending')) {
  db.exec('ALTER TABLE answers ADD COLUMN confirm_pending INTEGER NOT NULL DEFAULT 0');
}

const reviewAssignmentColumns = db.prepare('PRAGMA table_info(review_assignments)').all().map((c) => c.name);
if (!reviewAssignmentColumns.includes('recovery_code_hash')) {
  db.exec('ALTER TABLE review_assignments ADD COLUMN recovery_code_hash TEXT');
}
if (!reviewAssignmentColumns.includes('recovery_code_expires_at')) {
  db.exec('ALTER TABLE review_assignments ADD COLUMN recovery_code_expires_at TEXT');
}

const reviewAnswerColumns = db.prepare('PRAGMA table_info(review_answers)').all().map((c) => c.name);
if (!reviewAnswerColumns.includes('attempts')) {
  db.exec('ALTER TABLE review_answers ADD COLUMN attempts INTEGER NOT NULL DEFAULT 1');
}
if (!reviewAnswerColumns.includes('selected_choice_ids')) {
  db.exec('ALTER TABLE review_answers ADD COLUMN selected_choice_ids TEXT');
}
