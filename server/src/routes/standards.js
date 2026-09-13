import { Router } from 'express';
import { getSubjects, getGradeClusters, filterStandards } from '../services/curriculumStandards.js';
import { computeStandardsAccuracy } from './sessions.js';

export const standardsRouter = Router();

standardsRouter.get('/subjects', (_req, res) => {
  res.json(getSubjects());
});

standardsRouter.get('/grade-clusters', (_req, res) => {
  res.json(getGradeClusters());
});

// 여러 시험에 걸친 누적 성취기준별 정답률. roll_number를 주면 해당 학생만의 누적치.
standardsRouter.get('/report', (req, res) => {
  const rollNumber = req.query.roll_number ? Number(req.query.roll_number) : undefined;
  const { from, to } = req.query;
  res.json(computeStandardsAccuracy({ rollNumber, from, to }));
});

standardsRouter.get('/', (req, res) => {
  const { subject_id, grade_cluster } = req.query;
  res.json(filterStandards({ subject_id, grade_cluster }));
});
