import { Router } from 'express';
import { getSubjects, getGradeClusters, filterStandards } from '../services/curriculumStandards.js';
import * as repo from '../db/repo.js';

export const standardsRouter = Router();

standardsRouter.get('/subjects', (_req, res) => {
  res.json(getSubjects());
});

standardsRouter.get('/grade-clusters', (_req, res) => {
  res.json(getGradeClusters());
});

// 여러 시험에 걸친 누적 성취기준별 정답률. roll_number를 주면 해당 학생만의 누적치.
standardsRouter.get('/report', async (req, res) => {
  const rollNumber = req.query.roll_number ? Number(req.query.roll_number) : undefined;
  const { from, to } = req.query;
  res.json(await repo.computeStandardsAccuracy({ rollNumber, from, to }));
});

// 시험(응시)별 정답률 추이. subject_id로 교과 전체 평균을, code까지 주면 그 성취기준
// 하나로 좁힌 추이를 낸다. roll_number를 주면 그 학생만의 추이.
standardsRouter.get('/trend', async (req, res) => {
  const rollNumber = req.query.roll_number ? Number(req.query.roll_number) : undefined;
  const { subject_id: subjectId, code, from, to } = req.query;
  res.json(await repo.computeStandardsTrend({ subjectId, code, rollNumber, from, to }));
});

// 여러 시험에 걸쳐 반복되는 성취기준별 약점/개선 패턴(학생별 리포트 전용) - roll_number 필수.
standardsRouter.get('/weakness-patterns', async (req, res) => {
  const rollNumber = req.query.roll_number ? Number(req.query.roll_number) : undefined;
  if (!rollNumber) return res.status(400).json({ error: 'roll_number가 필요합니다.' });
  const { subject_id: subjectId, from, to } = req.query;
  res.json(await repo.computeStandardWeaknessCandidates({ rollNumber, subjectId, from, to }));
});

standardsRouter.get('/', (req, res) => {
  const { subject_id, grade_cluster } = req.query;
  res.json(filterStandards({ subject_id, grade_cluster }));
});
