import {
  getGeminiApiKey,
  getGeminiModelCatalog,
  setGeminiModelCatalog,
} from './appSettings.js';

const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const UNSUITABLE_MODEL_PATTERN = /(?:embedding|image|tts|live|audio|transcribe|robotics|computer-use|deep-research|omni)/i;

function costProfile(id) {
  if (/lite/i.test(id)) return 'economy';
  if (/pro/i.test(id)) return 'performance';
  return 'balanced';
}

function isSuitableModel(model) {
  const id = model.name?.replace(/^models\//, '') || '';
  const methods = model.supportedGenerationMethods || [];
  return id.startsWith('gemini-') && methods.includes('generateContent') && !UNSUITABLE_MODEL_PATTERN.test(id);
}

function normalizeModel(model) {
  const id = model.name.replace(/^models\//, '');
  return {
    id,
    name: model.displayName || id,
    description: model.description || '',
    costProfile: costProfile(id),
    preview: /preview|exp/i.test(id),
  };
}

async function fetchModels(apiKey) {
  const url = new URL('https://generativelanguage.googleapis.com/v1beta/models');
  url.searchParams.set('key', apiKey);
  url.searchParams.set('pageSize', '1000');
  const response = await fetch(url);
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Gemini 모델 목록 조회 실패 (${response.status}): ${detail}`);
  }
  const data = await response.json();
  return (data.models || [])
    .filter(isSuitableModel)
    .map(normalizeModel)
    .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
}

export async function getAvailableGeminiModels({ force = false } = {}) {
  const apiKey = getGeminiApiKey();
  if (!apiKey) throw new Error('먼저 Gemini API 키를 저장해주세요.');

  const cached = getGeminiModelCatalog();
  const fresh = cached?.fetchedAt && Date.now() - cached.fetchedAt < CACHE_TTL_MS;
  if (!force && fresh && Array.isArray(cached.models)) {
    return { ...cached, stale: false };
  }

  try {
    const models = await fetchModels(apiKey);
    if (models.length === 0) throw new Error('이 API 키에서 사용할 수 있는 Gemini 모델을 찾지 못했습니다.');
    const catalog = { fetchedAt: Date.now(), models };
    setGeminiModelCatalog(catalog);
    return { ...catalog, stale: false };
  } catch (error) {
    if (Array.isArray(cached?.models) && cached.models.length > 0) {
      return { ...cached, stale: true, warning: error.message };
    }
    throw error;
  }
}
