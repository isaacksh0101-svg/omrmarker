import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Router } from 'express';
import multer from 'multer';
import { config } from '../config.js';
import { db } from '../db/index.js';

export const backupRouter = Router();

const importUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024 },
});

function todayStamp() {
  return new Date().toISOString().slice(0, 10);
}

// 반/학년을 옮길 때 데이터를 통째로 내보낸다. VACUUM INTO로 일관된 스냅샷을 만들어서
// 내려준다 - 내보내는 도중 다른 요청이 DB에 쓰기를 해도 손상된 파일이 나가지 않는다.
backupRouter.get('/export', (_req, res) => {
  const tmpPath = path.join(os.tmpdir(), `omr-export-${Date.now()}.sqlite3`);
  try {
    db.exec(`VACUUM INTO '${tmpPath.replace(/'/g, "''")}'`);
  } catch (e) {
    return res.status(500).json({ error: `백업 파일 생성 실패: ${e.message}` });
  }

  res.download(tmpPath, `omr-backup-${todayStamp()}.sqlite3`, (err) => {
    fs.unlink(tmpPath, () => {});
    if (err) console.error('백업 다운로드 중 오류:', err);
  });
});

// 다른 설치(새 학년/새 반)에서 내보낸 백업 파일을 가져와 지금 DB를 통째로 교체한다.
// 안전을 위해: 유효한 백업인지 먼저 확인하고, 지금 파일은 지우지 않고 .bak으로 남겨두고,
// DB 커넥션을 정상적으로 닫은 뒤 교체하고, 마지막엔 서버를 재시작하도록 유도한다
// (교체된 파일로 라이브 커넥션을 몰래 이어 쓰는 것보다 훨씬 안전하다).
backupRouter.post('/import', importUpload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: '백업 파일이 필요합니다.' });
  }

  const tmpPath = path.join(os.tmpdir(), `omr-import-${Date.now()}.sqlite3`);
  fs.writeFileSync(tmpPath, req.file.buffer);

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
});
