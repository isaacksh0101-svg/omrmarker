import { Router } from 'express';
import {
  getGeminiApiKey,
  getGeminiModel,
  setGeminiApiKey,
  setGeminiModel,
} from '../services/appSettings.js';
import { getAvailableGeminiModels } from '../services/geminiModels.js';

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
