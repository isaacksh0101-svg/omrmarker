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
