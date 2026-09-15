import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Router } from 'express';
import multer from 'multer';
import { config } from '../config.js';
import { db } from '../db/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schemaSql = fs.readFileSync(path.resolve(__dirname, '..', 'db', 'schema.sql'), 'utf-8');

export const backupRouter = Router();

const importUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024 },
});

function todayStamp() {
  return new Date().toISOString().slice(0, 10);
}

// 카테고리별 백업에 포함되는 테이블. 부모->자식 순서로 적어둔다(삭제는 역순, 삽입은 이 순서).
const CATEGORY_TABLES = {
  exams: ['exams', 'questions', 'choices', 'question_standards'],
  roster: ['roster'],
  grades: ['exam_sessions', 'answers', 'warning_events'],
};

const CATEGORY_LABELS = {
  exams: '시험지',
  roster: '학생-명단',
  grades: '성적',
};

function quoteLiteral(value) {
  return `'${value.replace(/'/g, "''")}'`;
}

// 전체 스키마를 가진 빈 파일을 destPath에 만든 뒤, sourceDbPath에서 해당 카테고리 테이블의
// 데이터만 복사해 넣는다(다른 테이블은 스키마만 있고 비어 있음). 순수 함수로 빼서
// Express req/res 없이도 (테스트 등에서) 그대로 호출할 수 있게 한다.
export function buildCategoryExportFile(sourceDbPath, category, destPath) {
  const tmpDb = new DatabaseSync(destPath);
  try {
    tmpDb.exec(schemaSql);
    tmpDb.exec('PRAGMA foreign_keys = OFF');
    tmpDb.exec(`ATTACH DATABASE ${quoteLiteral(sourceDbPath)} AS src`);
    for (const table of CATEGORY_TABLES[category]) {
      tmpDb.exec(`INSERT INTO main.${table} SELECT * FROM src.${table}`);
    }
    tmpDb.exec('DETACH DATABASE src');
    // 카테고리 표시: 파일 내용만으론(항상 전체 스키마를 들고 있어서) 어떤 카테고리인지
    // 구분이 안 되므로, 가져올 때 잘못된 칸에 넣는 걸 막기 위해 표식을 남겨둔다.
    tmpDb.exec('CREATE TABLE _omr_backup_meta (category TEXT NOT NULL)');
    tmpDb.prepare('INSERT INTO _omr_backup_meta (category) VALUES (?)').run(category);
  } finally {
    tmpDb.close();
  }
}

// 반/학년을 옮길 때 데이터를 통째로 내보낸다. VACUUM INTO로 일관된 스냅샷을 만들어서
// 내려준다 - 내보내는 도중 다른 요청이 DB에 쓰기를 해도 손상된 파일이 나가지 않는다.
backupRouter.get('/export', (req, res) => {
  const category = typeof req.query.category === 'string' ? req.query.category : 'all';
  if (category !== 'all' && !CATEGORY_TABLES[category]) {
    return res.status(400).json({ error: '알 수 없는 백업 종류입니다.' });
  }

  const tmpPath = path.join(os.tmpdir(), `omr-export-${Date.now()}.sqlite3`);
  const filename =
    category === 'all'
      ? `omr-backup-${todayStamp()}.sqlite3`
      : `omr-backup-${CATEGORY_LABELS[category]}-${todayStamp()}.sqlite3`;

  try {
    if (category === 'all') {
      db.exec(`VACUUM INTO ${quoteLiteral(tmpPath)}`);
    } else {
      buildCategoryExportFile(config.dbPath, category, tmpPath);
    }
  } catch (e) {
    fs.unlink(tmpPath, () => {});
    return res.status(500).json({ error: `백업 파일 생성 실패: ${e.message}` });
  }

  res.download(tmpPath, filename, (err) => {
    fs.unlink(tmpPath, () => {});
    if (err) console.error('백업 다운로드 중 오류:', err);
  });
});

// 다른 설치(새 학년/새 반)에서 내보낸 백업 파일을 가져와 지금 DB를 통째로 교체한다.
// 안전을 위해: 유효한 백업인지 먼저 확인하고, 지금 파일은 지우지 않고 .bak으로 남겨두고,
// DB 커넥션을 정상적으로 닫은 뒤 교체하고, 마지막엔 서버를 재시작하도록 유도한다
// (교체된 파일로 라이브 커넥션을 몰래 이어 쓰는 것보다 훨씬 안전하다).
async function importAll(req, res, tmpPath) {
  const requiredTables = ['exams', 'roster', 'exam_sessions', 'answers'];
  try {
    const check = new DatabaseSync(tmpPath, { readOnly: true });
    const tableNames = new Set(
      check.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name),
    );
    check.close();
    const missing = requiredTables.filter((t) => !tableNames.has(t));
    if (missing.length > 0) {
      fs.unlink(tmpPath, () => {});
      return res.status(400).json({ error: '올바른 백업 파일이 아닙니다.' });
    }
  } catch (e) {
    fs.unlink(tmpPath, () => {});
    return res.status(400).json({ error: `올바른 백업 파일이 아닙니다: ${e.message}` });
  }

  try {
    db.close();
    const backupPath = `${config.dbPath}.bak-${Date.now()}`;
    if (fs.existsSync(config.dbPath)) {
      fs.copyFileSync(config.dbPath, backupPath);
    }
    fs.renameSync(tmpPath, config.dbPath);
  } catch (e) {
    return res.status(500).json({ error: `가져오기 실패: ${e.message}` });
  }

  res.json({ ok: true });
  // 응답이 실제로 클라이언트에 나간 뒤 프로세스를 종료한다 - 살아있는(닫힌) db 커넥션으로
  // 계속 서빙하는 대신 깨끗하게 재시작하도록 유도한다.
  setTimeout(() => process.exit(0), 300);
}

// 카테고리 단위 가져오기. 서버를 재시작하지 않고 지금 열려 있는 DB 위에서 바로 반영한다.
//
// 업로드된 파일이 이 category용 백업이 맞는지 확인한다. 문제 있으면 에러 메시지를,
// 문제 없으면 null을 반환한다.
export function checkCategoryFile(category, filePath) {
  const requiredTables = CATEGORY_TABLES[category];
  const check = new DatabaseSync(filePath, { readOnly: true });
  try {
    const tableNames = new Set(
      check.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name),
    );
    const missing = requiredTables.filter((t) => !tableNames.has(t));
    if (missing.length > 0) {
      return `올바른 ${CATEGORY_LABELS[category]} 백업 파일이 아닙니다.`;
    }

    // 파일은 항상 전체 스키마(빈 테이블 포함)를 갖고 있어서 테이블 존재 여부만으론 카테고리를
    // 구분할 수 없다 - export 때 남긴 표식으로 다른 종류의 백업을 잘못 가져오는 걸 막는다.
    let fileCategory = null;
    if (tableNames.has('_omr_backup_meta')) {
      fileCategory = check.prepare('SELECT category FROM _omr_backup_meta LIMIT 1').get()?.category ?? null;
    }
    if (fileCategory !== category) {
      const got = fileCategory ? CATEGORY_LABELS[fileCategory] || fileCategory : '알 수 없는 종류';
      return `이 파일은 '${got}' 백업입니다. '${CATEGORY_LABELS[category]}' 가져오기 칸에는 맞지 않아요.`;
    }
    return null;
  } finally {
    check.close();
  }
}

// targetDb 위에서 category 테이블을 백업 파일(filePath) 내용으로 갱신한다.
// - roster/grades: 그 카테고리 테이블만 통째로 비우고 백업 내용으로 채운다(스냅샷 복원).
// - exams: 기존 시험지를 지우지 않고 새 id로 이어 붙인다(추가). exams/questions를 삭제하면
//   FK ON DELETE CASCADE 때문에 그 시험을 이미 치른 학생의 exam_sessions/answers(성적,
//   grades 카테고리)까지 같이 지워지므로, 시험지 백업 하나만 따로 복원해도 다른 카테고리의
//   데이터를 건드리지 않도록 일부러 교체 대신 추가 방식을 쓴다.
// 실패하면 예외를 던진다(호출부에서 잡아서 에러 메시지로 변환).
export function applyCategoryImport(targetDb, category, filePath) {
  const attachPath = quoteLiteral(filePath);
  try {
    targetDb.exec(`ATTACH DATABASE ${attachPath} AS src`);
    targetDb.exec('BEGIN');

    if (category === 'roster') {
      targetDb.exec('DELETE FROM roster');
      targetDb.exec('INSERT INTO roster (id, roll_number, name) SELECT id, roll_number, name FROM src.roster');
    } else if (category === 'grades') {
      targetDb.exec('DELETE FROM warning_events');
      targetDb.exec('DELETE FROM answers');
      targetDb.exec('DELETE FROM exam_sessions');
      targetDb.exec('INSERT INTO exam_sessions SELECT * FROM src.exam_sessions');
      targetDb.exec('INSERT INTO answers SELECT * FROM src.answers');
      targetDb.exec('INSERT INTO warning_events SELECT * FROM src.warning_events');
    } else if (category === 'exams') {
      const examIdMap = new Map();
      const questionIdMap = new Map();

      const insertExam = targetDb.prepare(
        `INSERT INTO exams (title, subject_id, grade_cluster, time_limit_sec, mode, status, started_at, ends_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const e of targetDb.prepare('SELECT * FROM src.exams').all()) {
        const result = insertExam.run(
          e.title,
          e.subject_id,
          e.grade_cluster,
          e.time_limit_sec,
          e.mode,
          e.status,
          e.started_at,
          e.ends_at,
          e.created_at,
          e.updated_at,
        );
        examIdMap.set(e.id, result.lastInsertRowid);
      }

      const insertQuestion = targetDb.prepare(
        `INSERT INTO questions (exam_id, order_index, type, prompt, points, correct_short_answers, ai_suggested, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const q of targetDb.prepare('SELECT * FROM src.questions').all()) {
        const newExamId = examIdMap.get(q.exam_id);
        if (newExamId == null) continue;
        const result = insertQuestion.run(
          newExamId,
          q.order_index,
          q.type,
          q.prompt,
          q.points,
          q.correct_short_answers,
          q.ai_suggested,
          q.created_at,
          q.updated_at,
        );
        questionIdMap.set(q.id, result.lastInsertRowid);
      }

      const insertChoice = targetDb.prepare(
        'INSERT INTO choices (question_id, order_index, text, is_correct) VALUES (?, ?, ?, ?)',
      );
      for (const c of targetDb.prepare('SELECT * FROM src.choices').all()) {
        const newQuestionId = questionIdMap.get(c.question_id);
        if (newQuestionId == null) continue;
        insertChoice.run(newQuestionId, c.order_index, c.text, c.is_correct);
      }

      const insertStandard = targetDb.prepare(
        `INSERT INTO question_standards (question_id, standard_code, statement_snapshot, is_ai_suggested, confidence)
         VALUES (?, ?, ?, ?, ?)`,
      );
      for (const s of targetDb.prepare('SELECT * FROM src.question_standards').all()) {
        const newQuestionId = questionIdMap.get(s.question_id);
        if (newQuestionId == null) continue;
        insertStandard.run(newQuestionId, s.standard_code, s.statement_snapshot, s.is_ai_suggested, s.confidence);
      }
    }

    targetDb.exec('COMMIT');
    targetDb.exec('DETACH DATABASE src');
  } catch (e) {
    try {
      targetDb.exec('ROLLBACK');
    } catch {
      // 트랜잭션이 이미 끝나 있으면 ROLLBACK 자체가 실패할 수 있다 - 무시.
    }
    try {
      targetDb.exec('DETACH DATABASE src');
    } catch {
      // 위 에러가 ATTACH 이전에 났다면 detach할 것도 없다 - 무시.
    }
    throw e;
  }
}

function importCategory(category, tmpPath, res) {
  try {
    const problem = checkCategoryFile(category, tmpPath);
    if (problem) {
      fs.unlink(tmpPath, () => {});
      return res.status(400).json({ error: problem });
    }
  } catch (e) {
    fs.unlink(tmpPath, () => {});
    return res.status(400).json({ error: `올바른 ${CATEGORY_LABELS[category]} 백업 파일이 아닙니다: ${e.message}` });
  }

  try {
    applyCategoryImport(db, category, tmpPath);
  } catch (e) {
    fs.unlink(tmpPath, () => {});
    const hint =
      category === 'grades'
        ? ' 이 성적 백업이 가리키는 시험지가 지금 설치본에 없을 수 있어요 - 같은 시점에 내보낸 시험지 백업을 먼저 가져와 보세요.'
        : '';
    return res.status(400).json({ error: `가져오기 실패: ${e.message}${hint}` });
  }

  fs.unlink(tmpPath, () => {});
  return res.json({ ok: true });
}

backupRouter.post('/import', importUpload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: '백업 파일이 필요합니다.' });
  }
  const category = typeof req.body.category === 'string' ? req.body.category : 'all';
  if (category !== 'all' && !CATEGORY_TABLES[category]) {
    return res.status(400).json({ error: '알 수 없는 백업 종류입니다.' });
  }

  const tmpPath = path.join(os.tmpdir(), `omr-import-${Date.now()}.sqlite3`);
  fs.writeFileSync(tmpPath, req.file.buffer);

  if (category === 'all') {
    return importAll(req, res, tmpPath);
  }
  return importCategory(category, tmpPath, res);
});
