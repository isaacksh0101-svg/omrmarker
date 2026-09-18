import { Router } from 'express';
import * as repo from '../db/repo.js';

export const rosterRouter = Router();

rosterRouter.get('/', async (_req, res) => {
  res.json(await repo.listRoster());
});

rosterRouter.post('/', async (req, res) => {
  const { roll_number, name } = req.body;
  if (!Number.isInteger(roll_number)) {
    return res.status(400).json({ error: 'roll_number는 정수여야 합니다.' });
  }
  await repo.upsertRosterEntry(roll_number, name);
  res.status(201).json(await repo.getRosterEntry(roll_number));
});

rosterRouter.delete('/:rollNumber', async (req, res) => {
  await repo.deleteRosterEntry(Number(req.params.rollNumber));
  res.status(204).end();
});

// 명단은 남기고 이 학생의 응시·답안·점수·필기·화면 이탈 기록만 완전 삭제한다.
rosterRouter.delete('/:rollNumber/learning-data', async (req, res) => {
  const rollNumber = Number(req.params.rollNumber);
  if (!Number.isInteger(rollNumber) || rollNumber <= 0) {
    return res.status(400).json({ error: '올바른 출석번호가 필요합니다.' });
  }
  const deletedSessions = await repo.deleteLearningDataForRollNumber(rollNumber);
  res.json({ ok: true, deletedSessions });
});

// 학생별 리포트에서 "이 학생이 응시한 시험들" 목록을 보여주기 위함.
rosterRouter.get('/:rollNumber/exams', async (req, res) => {
  res.json(await repo.getExamsForRollNumber(Number(req.params.rollNumber)));
});
