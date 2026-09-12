import { Router } from 'express';
import { db } from '../db/index.js';

export const rosterRouter = Router();

rosterRouter.get('/', (_req, res) => {
  const rows = db.prepare('SELECT * FROM roster ORDER BY roll_number').all();
  res.json(rows);
});

rosterRouter.post('/', (req, res) => {
  const { roll_number, name } = req.body;
  if (!Number.isInteger(roll_number)) {
    return res.status(400).json({ error: 'roll_number는 정수여야 합니다.' });
  }
  db.prepare(
    'INSERT INTO roster (roll_number, name) VALUES (?, ?) ' +
      'ON CONFLICT(roll_number) DO UPDATE SET name = excluded.name',
  ).run(roll_number, name ?? null);
  const row = db.prepare('SELECT * FROM roster WHERE roll_number = ?').get(roll_number);
  res.status(201).json(row);
});

rosterRouter.delete('/:rollNumber', (req, res) => {
  db.prepare('DELETE FROM roster WHERE roll_number = ?').run(Number(req.params.rollNumber));
  res.status(204).end();
});
