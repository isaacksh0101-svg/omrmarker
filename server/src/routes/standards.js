import { Router } from 'express';
import { getSubjects, getGradeClusters, filterStandards } from '../services/curriculumStandards.js';

export const standardsRouter = Router();

standardsRouter.get('/subjects', (_req, res) => {
  res.json(getSubjects());
});

standardsRouter.get('/grade-clusters', (_req, res) => {
  res.json(getGradeClusters());
});

standardsRouter.get('/', (req, res) => {
  const { subject_id, grade_cluster } = req.query;
  res.json(filterStandards({ subject_id, grade_cluster }));
});
