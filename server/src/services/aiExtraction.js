import { config } from '../config.js';
import { filterStandards } from './curriculumStandards.js';

// AI(현재는 Gemini) 호출은 이 파일에서만 일어난다. 이 앱에서 유일하게 외부 네트워크를
// 사용하는 지점이며, provider를 바꾸고 싶으면 이 파일의 callGemini()만 교체하면 된다.

function buildResponseSchema(allowedCodes) {
  return {
    type: 'OBJECT',
    properties: {
      questions: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            order_index: { type: 'INTEGER' },
            type: { type: 'STRING', enum: ['mc', 'short'] },
            prompt: { type: 'STRING' },
            choices: {
              type: 'ARRAY',
              items: {
                type: 'OBJECT',
                properties: {
                  order_index: { type: 'INTEGER' },
                  text: { type: 'STRING' },
                },
                required: ['order_index', 'text'],
              },
            },
            suggested_standards: {
              type: 'ARRAY',
              items: {
                type: 'OBJECT',
                properties: {
                  code: { type: 'STRING', enum: allowedCodes },
                  confidence: { type: 'STRING', enum: ['high', 'medium', 'low'] },
                  rationale: { type: 'STRING' },
                },
                required: ['code', 'confidence'],
              },
            },
          },
          required: ['order_index', 'type', 'prompt', 'choices', 'suggested_standards'],
        },
      },
    },
    required: ['questions'],
  };
}

function buildPrompt(gradeLabel, subjectName) {
  return `당신은 초등학교 ${gradeLabel} ${subjectName} 시험지 이미지를 분석하는 보조 도구입니다.

이미지에 있는 문항들을 순서대로 추출하세요. 각 문항에 대해:
1. 문제 내용(prompt)을 이미지에 보이는 그대로 옮겨 적으세요.
2. 유형(type)을 판단하세요: 보기 중에서 고르는 문제는 "mc", 직접 답을 쓰는 문제는 "short".
3. 객관식(mc)이면 보기(choices)를 순서대로 모두 옮겨 적으세요.
4. 이 문항이 어떤 성취기준과 관련 있는지 제공된 성취기준 목록 중에서만 골라 suggested_standards에 담으세요.
   확신 정도를 confidence(high/medium/low)로, 왜 그렇게 판단했는지 rationale에 간단히 적으세요.
   목록에 없는 코드는 절대 만들어내지 마세요.

**중요: 정답이 무엇인지는 절대 판단하거나 표시하지 마세요.** 정답 확정은 교사가 직접 합니다.
당신의 역할은 문항 내용을 옮겨 적고 성취기준을 제안하는 것까지입니다.`;
}

async function callGemini({ imageBase64, mimeType, promptText, responseSchema }) {
  if (!config.gemini.apiKey) {
    throw new Error('GEMINI_API_KEY가 설정되지 않았습니다. server/.env를 확인하세요.');
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.gemini.model}:generateContent?key=${config.gemini.apiKey}`;
  const body = {
    contents: [
      {
        parts: [{ text: promptText }, { inline_data: { mime_type: mimeType, data: imageBase64 } }],
      },
    ],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema,
    },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Gemini API 오류 (${res.status}): ${errBody}`);
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error('Gemini 응답에서 결과를 찾을 수 없습니다.');
  }
  return JSON.parse(text);
}

export async function extractQuestionsFromImage({ imageBase64, mimeType, subjectId, gradeCluster }) {
  const candidateStandards = filterStandards({ subject_id: subjectId, grade_cluster: gradeCluster });
  if (candidateStandards.length === 0) {
    throw new Error('해당 교과/학년군에 대한 성취기준을 찾을 수 없습니다.');
  }
  const allowedCodes = candidateStandards.map((s) => s.code);
  const gradeLabel = candidateStandards[0].grade_label;
  const subjectName = candidateStandards[0].subject_name;

  const promptText = buildPrompt(gradeLabel, subjectName);
  const responseSchema = buildResponseSchema(allowedCodes);

  const result = await callGemini({ imageBase64, mimeType, promptText, responseSchema });

  const allowedSet = new Set(allowedCodes);
  const questions = (result.questions ?? []).map((q, i) => ({
    order_index: q.order_index ?? i,
    type: q.type === 'short' ? 'short' : 'mc',
    prompt: q.prompt ?? '',
    choices: (q.choices ?? []).map((c, ci) => ({ order_index: c.order_index ?? ci, text: c.text ?? '' })),
    // 서버가 다시 한번 필터링한다 - 모델이 스키마를 어기고 목록 밖 코드를 내놓는 경우를 방지.
    suggested_standards: (q.suggested_standards ?? []).filter((s) => allowedSet.has(s.code)),
  }));

  return { questions };
}
