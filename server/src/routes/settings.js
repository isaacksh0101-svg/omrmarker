import { Router } from 'express';
import {
  getGeminiApiKey,
  getGeminiModel,
  setGeminiApiKey,
  setGeminiModel,
  getStudentNetworkAddress,
  setStudentNetworkAddress,
} from '../services/appSettings.js';
import { getAvailableGeminiModels } from '../services/geminiModels.js';
import { getLanIpCandidates } from '../lib/lanIp.js';
import * as repo from '../db/repo.js';

export const settingsRouter = Router();

// 실제 키 값은 응답으로 돌려주지 않는다 - 화면에는 설정 여부만 필요하다.
settingsRouter.get('/ai', (_req, res) => {
  res.json({ hasApiKey: Boolean(getGeminiApiKey()), model: getGeminiModel() });
});

settingsRouter.put('/ai', (req, res) => {
  const apiKey = typeof req.body?.apiKey === 'string' ? req.body.apiKey.trim() : '';
  const model = typeof req.body?.model === 'string' ? req.body.model.trim() : '';
  if (!apiKey && !model) return res.status(400).json({ error: '저장할 설정을 입력해주세요.' });
  if (apiKey) setGeminiApiKey(apiKey);
  if (model) {
    if (!/^gemini-[a-zA-Z0-9._-]+$/.test(model)) {
      return res.status(400).json({ error: '올바르지 않은 Gemini 모델 이름입니다.' });
    }
    setGeminiModel(model);
  }
  res.json({ hasApiKey: Boolean(getGeminiApiKey()), model: getGeminiModel() });
});

settingsRouter.get('/ai/models', async (req, res) => {
  try {
    const catalog = await getAvailableGeminiModels({ force: req.query.refresh === '1' });
    res.json(catalog);
  } catch (error) {
    res.status(502).json({ error: error.message });
  }
});

settingsRouter.get('/network', (_req, res) => {
  const candidates = getLanIpCandidates();
  const selectedAddress = getStudentNetworkAddress();
  const selected = candidates.find((candidate) => candidate.address === selectedAddress) ?? null;
  res.json({ candidates, selectedAddress, selected });
});

settingsRouter.put('/network', (req, res) => {
  const address = typeof req.body?.address === 'string' ? req.body.address.trim() : '';
  const candidates = getLanIpCandidates();
  const selected = candidates.find((candidate) => candidate.address === address);
  if (!selected) return res.status(400).json({ error: '현재 PC에 연결된 네트워크를 선택해주세요.' });
  if (selected.networkCategory === 'Public') {
    return res.status(400).json({ error: 'Windows 공용(Public) 네트워크에서는 학생 접속을 허용할 수 없습니다.' });
  }
  setStudentNetworkAddress(address);
  res.json({ candidates, selectedAddress: address, selected });
});

settingsRouter.get('/data-retention', async (_req, res) => {
  res.json(await repo.getLearningDataRetentionStatus());
});

settingsRouter.delete('/data-retention/:academicYear', async (req, res) => {
  const academicYear = Number(req.params.academicYear);
  const currentYear = new Date().getFullYear();
  if (!Number.isInteger(academicYear) || academicYear < 2000 || academicYear > currentYear + 1) {
    return res.status(400).json({ error: '올바른 학년도를 선택해주세요.' });
  }
  if (req.body?.confirmation !== `${academicYear}학년도 성적 삭제`) {
    return res.status(400).json({ error: '삭제 확인 문구가 일치하지 않습니다.' });
  }
  const deletedSessions = await repo.deleteLearningDataForAcademicYear(academicYear);
  res.json({ ok: true, deletedSessions, status: await repo.getLearningDataRetentionStatus() });
});
