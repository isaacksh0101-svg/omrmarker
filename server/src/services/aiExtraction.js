import { filterStandards } from './curriculumStandards.js';
import { getGeminiApiKey, getGeminiModel, getUpstageApiKey } from './appSettings.js';

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
            prompt: {
              type: 'STRING',
              description:
                '문제 지시문과 본문만. 객관식이면 보기 내용(㉠㉡㉢, ①②③④⑤ 뒤에 오는 값/식)은 옮겨 적지 않는다 - bounding_box로 잘라낸 이미지에 보기가 그대로 보이므로 텍스트로 옮길 필요가 없다. 수식(분수·곱셈/나눗셈 기호 등)은 $...$ 안에 LaTeX로 적는다. 텍스트로 옮기기 어려운 도형/표/선긋기 등도 억지로 옮기려 하지 않고 간단한 지시문 정도만 적어도 된다.',
            },
            bounding_box: {
              type: 'OBJECT',
              description:
                '이 문항 전체(발문+도형/표/선긋기 등, 객관식이면 보기(①②③④⑤ 등)까지 전부 포함)를 감싸는 사각형. 이미지 전체를 가로/세로 0~1000으로 정규화한 좌표. 학생에게는 이 좌표로 잘라낸 이미지 그대로 보여주므로 보기를 빠뜨리면 안 된다.',
              properties: {
                ymin: { type: 'INTEGER' },
                xmin: { type: 'INTEGER' },
                ymax: { type: 'INTEGER' },
                xmax: { type: 'INTEGER' },
              },
              required: ['ymin', 'xmin', 'ymax', 'xmax'],
            },
            suggested_standards: {
              type: 'ARRAY',
              description:
                '가장 관련 있는 순서대로 나열한 후보 목록. 1순위가 교사 확인 전까지 자동으로 태그되고,' +
                ' 나머지는 교사가 AI 판단을 검토할 때 참고용으로 함께 보여준다.',
              // 성취기준 태깅이 이 기능의 핵심 목적이다 - 모델이 "가장 가까운 것 하나"만 찍고 끝내는
              // 경향이 있어서, 교사가 대안과 비교할 수 있도록 최소 2개(후보가 부족한 과목/학년군이면
              // 그 수만큼)는 반드시 채우도록 스키마 단계에서 강제한다.
              minItems: Math.min(2, allowedCodes.length),
              maxItems: Math.min(3, allowedCodes.length),
              items: {
                type: 'OBJECT',
                properties: {
                  code: { type: 'STRING', enum: allowedCodes },
                  confidence: { type: 'STRING', enum: ['high', 'medium', 'low'] },
                  rationale: { type: 'STRING' },
                },
                required: ['code', 'confidence', 'rationale'],
              },
            },
          },
          required: ['order_index', 'type', 'prompt', 'suggested_standards'],
        },
      },
    },
    required: ['questions'],
  };
}

function buildPrompt(gradeLabel, subjectName, candidateStandards, documentText = '') {
  // 코드만 나열하면 모델이 "6수01-01" 같은 코드가 실제로 뭘 말하는지 모른 채(자기가 학습 때 본 것에
  // 기대어) 찍는 경우가 있었다(예: 분수 나눗셈 문제에 각기둥 성취기준을 고르는 식). 그래서 각 코드가
  // 무슨 내용인지 여기서 직접 알려주고, 반드시 그 내용을 문제와 비교해서 고르라고 명시한다.
  const standardsList = candidateStandards.map((s) => `- ${s.code}: ${s.statement}`).join('\n');

  return `당신은 초등학교 ${gradeLabel} ${subjectName} 시험지 이미지를 분석하는 보조 도구입니다.

이미지에 있는 문항들을 순서대로 추출하세요. 각 문항에 대해:
1. 문제 내용(prompt)을 이미지에 보이는 그대로 옮겨 적으세요. **객관식이면 보기 내용(㉠㉡㉢, ①②③④⑤
   뒤에 오는 값/식)은 옮겨 적지 마세요** - bounding_box로 잘라낸 이미지에 보기가 그대로 보이므로
   텍스트로 따로 옮길 필요가 없습니다.
2. 유형(type)을 판단하세요: 보기 중에서 고르는 문제는 "mc", 직접 답을 쓰는 문제는 "short".
3. **수식은 화면에 실제 분수·연산 기호로 보이도록 LaTeX로 적으세요.** 수식이 나오는 부분만 $...$로
   감싸고, 그 안에 LaTeX 문법을 씁니다. 분수는 반드시 "1/6"처럼 슬래시로 적지 말고 \\frac{1}{6}로,
   대분수는 2\\frac{1}{3}로, 나눗셈은 \\div, 곱셈은 \\times로 적으세요. 예: "9/10 ÷ 3/10"은
   "$\\frac{9}{10} \\div \\frac{3}{10}$"로, "8 ÷ 4/7 = ▢"는 "$8 \\div \\frac{4}{7} = $ ▢"로 적습니다.
   순수 정수·글(예: "3번", "빈칸에")나 도형·○/▢ 같은 기호는 $ 없이 그냥 텍스트로 둡니다.
4. **bounding_box로 이 문항 전체 영역을 표시하세요.** 학생 화면엔 텍스트 대신 이 좌표로 원본
   이미지에서 잘라낸 그림을 그대로 보여줍니다. 그래서 도형·표·선긋기·복잡한 배치처럼 텍스트로는 정확히
   옮기기 어려운 내용도 원본 그대로 보여줄 수 있습니다. **객관식이면 보기(①②③④⑤ 등)까지 반드시
   포함해서** 이 문항의 지시문+본문+보기 전체를 넉넉하지도 빠듯하지도 않게 감싸고, 다른 문항 영역은
   포함하지 마세요. 선 긋기(매칭)처럼 객관식/단답형 어느 쪽에도 깔끔히 안 맞는 문제는 type을 "short"로
   하고, prompt는 짧은 지시문만 적은 뒤 bounding_box로 전체 내용(선긋기 도식 포함)을 보여주는 쪽에
   맡기세요.
5. **성취기준 태깅은 이 작업에서 가장 중요한 부분입니다. 예외 없이 모든 문항에 대해, 가장 관련
   있는 순서대로 2~3개의 성취기준 후보를 반드시 제시하세요 - 1개만 내놓거나 비워두는 것은 허용되지
   않습니다.** 아래 목록은 이미 이 시험지의 학년군·교과로 좁혀져 있으므로, 그 안에서 이 문항과 관련
   있는 성취기준이 최소 2개는 반드시 존재합니다. **코드만 보고 짐작하지 말고, 코드 옆에 적힌 성취기준
   내용을 문제 내용과 직접 비교해서** 가장 주제가 가까운 순서대로 나열하세요(suggested_standards
   배열의 첫 번째 항목이 교사에게 1순위로 자동 적용됩니다). 예를 들어 문제가 분수의 나눗셈이라면,
   도형(각기둥·각뿔 등)이나 측정, 자료와 가능성처럼 명백히 다른 영역의 성취기준보다는 수와 연산
   영역의 성취기준을 우선하세요. 두 번째·세 번째 후보는 1순위만큼 확실하지 않아도 괜찮습니다 -
   그럴 때를 위해 confidence(1순위처럼 명확히 일치하면 high, 근접하지만 확실하지 않으면 medium
   또는 low)가 있는 것입니다. confidence가 낮다는 이유로 후보 자체를 생략하면 안 됩니다. 각 후보의
   rationale에는 왜 그 성취기준을 골랐는지(또는 몇 번째 후보로 남겨뒀는지) 간단히 적어서, 교사가
   나중에 이 판단이 맞는지 검토할 때 참고할 수 있게 하세요. 단, 목록에 없는 코드를 새로 만들어내는
   것만은 절대 금지입니다.

성취기준 목록(코드: 내용):
${standardsList}

${documentText ? `Upstage Document Parse가 먼저 판독한 문서 내용입니다. 이미지 판독 시 번호·문장·수식을 교차 확인하는 참고자료로 사용하세요:\n\n${documentText}` : ''}

**중요: 정답이 무엇인지는 절대 판단하거나 표시하지 마세요.** 정답 확정은 교사가 직접 합니다.
당신의 역할은 문항 지시문을 옮겨 적고, 영역을 표시하고, 성취기준을 제안하는 것까지입니다.`;
}

async function callGemini({ imageBase64, mimeType, promptText, responseSchema }) {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    throw new Error('AI API 키가 설정되지 않았습니다. 환경설정 화면에서 입력해주세요.');
  }

  const model = getGeminiModel();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
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

function buildAnswerKeySchema() {
  return {
    type: 'OBJECT',
    properties: {
      answers: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            question_number: {
              type: 'INTEGER',
              description: '정답지에 적힌 문항 번호. 아래 목록의 번호와 반드시 일치해야 한다.',
            },
            answer: {
              type: 'STRING',
              description:
                '객관식이면 정답 보기의 번호(1~보기 개수)를 아라비아 숫자로. ①②③처럼 동그라미 숫자로 ' +
                '표시돼 있어도 해당 아라비아 숫자로 바꿔 적는다. 단답형이면 정답 텍스트를 그대로 옮기고, ' +
                '정답이 여러 개 인정되면 쉼표로 구분한다.',
            },
          },
          required: ['question_number', 'answer'],
        },
      },
    },
    required: ['answers'],
  };
}

function buildAnswerKeyPrompt(questions, { sourceLabel, documentText } = {}) {
  const list = questions
    .map((q) =>
      q.type === 'mc'
        ? `- ${q.order_index + 1}번: 객관식(보기 ${q.numChoices}개 중 정답 번호 1~${q.numChoices})`
        : `- ${q.order_index + 1}번: 단답형(정답 텍스트)`,
    )
    .join('\n');

  return `당신은 초등학교 시험 정답지(답안지)를 읽어 문항 번호별 정답을 추출하는 보조 도구입니다.

이 시험은 다음 문항들로 구성되어 있습니다:
${list}

${sourceLabel}, 각 문항 번호에 대한 정답을 추출하세요.
- 객관식 문항은 정답 보기의 번호만 숫자로 적으세요. ①②③④⑤처럼 동그라미 숫자로 표시돼 있어도 해당하는
  아라비아 숫자(1~보기 개수)로 바꿔 적으세요.
- 단답형 문항은 정답으로 적힌 텍스트를 그대로 옮겨 적으세요. 정답이 여러 개 인정되는 경우(예: "5 또는
  5개")는 쉼표로 구분해서 적으세요.
- 문항 번호는 반드시 위 목록의 번호와 일치시키세요. 실제로 읽을 수 있는 문항만 결과에 포함하고,
  흐릿하거나 확실하지 않은 문항은 억지로 추측해서 넣지 말고 빼세요.
- 정답 이외의 해설이나 다른 정보는 옮기지 마세요.${documentText ? `\n\n판독 문서:\n${documentText}` : ''}`;
}

export async function extractAnswerKeyFromImage({ imageBase64, mimeType, questions }) {
  const promptText = buildAnswerKeyPrompt(questions, { sourceLabel: '이미지에 있는 정답지를 읽고' });
  const responseSchema = buildAnswerKeySchema();

  const result = await callGemini({ imageBase64, mimeType, promptText, responseSchema });

  return (result.answers ?? [])
    .filter((a) => Number.isInteger(a?.question_number) && typeof a?.answer === 'string' && a.answer.trim())
    .map((a) => ({ question_number: a.question_number, answer: a.answer.trim() }));
}

export async function extractAnswerKeyFromDocumentText({ documentText, questions }) {
  const apiKey = getUpstageApiKey();
  if (!apiKey) throw new Error('환경설정에서 Upstage API 키를 먼저 저장해주세요.');

  const promptText = buildAnswerKeyPrompt(questions, {
    sourceLabel: '아래 판독 문서를 보고',
    documentText,
  });

  const response = await fetch('https://api.upstage.ai/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'solar-pro3',
      reasoning_effort: 'medium',
      messages: [{ role: 'user', content: promptText }],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'scorelab_answer_key',
          strict: true,
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              answers: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    question_number: { type: 'integer' },
                    answer: { type: 'string' },
                  },
                  required: ['question_number', 'answer'],
                },
              },
            },
            required: ['answers'],
          },
        },
      },
      temperature: 0.1,
    }),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Solar Pro 3 오류 (${response.status}): ${detail}`);
  }
  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content;
  if (!content) throw new Error('Solar Pro 3 응답에서 결과를 찾을 수 없습니다.');
  const result = JSON.parse(content);

  return (result.answers ?? [])
    .filter((a) => Number.isInteger(a?.question_number) && typeof a?.answer === 'string' && a.answer.trim())
    .map((a) => ({ question_number: a.question_number, answer: a.answer.trim() }));
}

export async function extractQuestionsFromImage({ imageBase64, mimeType, subjectId, gradeCluster, documentText = '' }) {
  const candidateStandards = filterStandards({ subject_id: subjectId, grade_cluster: gradeCluster });
  if (candidateStandards.length === 0) {
    throw new Error('해당 교과/학년군에 대한 성취기준을 찾을 수 없습니다.');
  }
  const allowedCodes = candidateStandards.map((s) => s.code);
  const gradeLabel = candidateStandards[0].grade_label;
  const subjectName = candidateStandards[0].subject_name;

  const promptText = buildPrompt(gradeLabel, subjectName, candidateStandards, documentText);
  const responseSchema = buildResponseSchema(allowedCodes);

  const result = await callGemini({ imageBase64, mimeType, promptText, responseSchema });

  const allowedSet = new Set(allowedCodes);
  const questions = (result.questions ?? []).map((q, i) => ({
    order_index: q.order_index ?? i,
    type: q.type === 'short' ? 'short' : 'mc',
    prompt: q.prompt ?? '',
    bounding_box: q.bounding_box ?? null,
    // 서버가 다시 한번 필터링한다 - 모델이 스키마를 어기고 목록 밖 코드를 내놓는 경우를 방지.
    suggested_standards: (q.suggested_standards ?? []).filter((s) => allowedSet.has(s.code)),
  }));

  return { questions };
}

export async function extractQuestionsFromDocumentText({ documentText, subjectId, gradeCluster }) {
  const candidateStandards = filterStandards({ subject_id: subjectId, grade_cluster: gradeCluster });
  if (candidateStandards.length === 0) {
    throw new Error('해당 교과/학년군에 대한 성취기준을 찾을 수 없습니다.');
  }
  const apiKey = getUpstageApiKey();
  if (!apiKey) throw new Error('환경설정에서 Upstage API 키를 먼저 저장해주세요.');

  const allowedCodes = candidateStandards.map((standard) => standard.code);
  const standardsList = candidateStandards.map((standard) => `- ${standard.code}: ${standard.statement}`).join('\n');
  const prompt = `당신은 초등학교 시험지를 ScoreLab 데이터로 변환하는 도구입니다.
아래 문서는 Upstage Document Parse가 판독한 결과입니다. 제공된 JSON 스키마에 맞춰 반환하세요.

각 문항에 대해 다음 필드를 만드세요.
- order_index: 문서 안 순서를 0부터 센 정수
- type: 객관식은 "mc", 단답형은 "short"
- prompt: 문제 지시문과 본문을 판독 결과에 보이는 그대로 옮겨 적으세요. 객관식 보기
  문구는 choices에 담고 여기엔 넣지 마세요.
- choices: 객관식 보기의 실제 문구 배열(①②③④⑤ 등 번호는 빼고 내용만). 단답형은 빈 배열.
- prompt와 choices 안의 **수식은 화면에 실제 분수·연산 기호로 보이도록 LaTeX로 적으세요.**
  수식이 나오는 부분만 $...$로 감싸고 그 안에 LaTeX 문법을 씁니다. 분수는 "1/6"처럼
  슬래시로 적지 말고 \\frac{1}{6}로, 대분수는 2\\frac{1}{3}로, 나눗셈은 \\div, 곱셈은
  \\times로 적으세요. 예: "9/10 ÷ 3/10"은 "$\\frac{9}{10} \\div \\frac{3}{10}$"로 적습니다.
  순수 정수·글·도형 기호는 $ 없이 그냥 텍스트로 둡니다.
- 표·그림·선긋기처럼 판독 결과만으로는 정확히 옮기기 어려운 내용이 있으면, prompt에는
  "(그림 있음 - 원본 확인 필요)"처럼 짧게 남겨두세요. 이 문항은 나중에 교사가 원본
  이미지에서 직접 잘라 넣을 수 있습니다.
- suggested_standards: 관련도순 2~3개. 각 항목은 code, confidence(high/medium/low), rationale

목록에 없는 성취기준 코드는 절대 만들지 마세요. 정답은 판단하지 마세요.
성취기준 목록:
${standardsList}

판독 문서:
${documentText}`;

  const response = await fetch('https://api.upstage.ai/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'solar-pro3',
      reasoning_effort: 'medium',
      messages: [{ role: 'user', content: prompt }],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'scorelab_exam_questions',
          strict: true,
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              questions: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    order_index: { type: 'integer' },
                    type: { type: 'string', enum: ['mc', 'short'] },
                    prompt: { type: 'string' },
                    choices: { type: 'array', items: { type: 'string' } },
                    suggested_standards: {
                      type: 'array',
                      items: {
                        type: 'object',
                        additionalProperties: false,
                        properties: {
                          code: { type: 'string', enum: allowedCodes },
                          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
                          rationale: { type: 'string' },
                        },
                        required: ['code', 'confidence', 'rationale'],
                      },
                    },
                  },
                  required: ['order_index', 'type', 'prompt', 'choices', 'suggested_standards'],
                },
              },
            },
            required: ['questions'],
          },
        },
      },
      temperature: 0.1,
    }),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Solar Pro 3 오류 (${response.status}): ${detail}`);
  }
  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content;
  if (!content) throw new Error('Solar Pro 3 응답에서 결과를 찾을 수 없습니다.');
  const result = JSON.parse(content);
  const allowedSet = new Set(allowedCodes);
  const questions = (result.questions ?? []).map((question, index) => ({
    order_index: Number.isInteger(question.order_index) ? question.order_index : index,
    type: question.type === 'short' ? 'short' : 'mc',
    prompt: typeof question.prompt === 'string' ? question.prompt : '',
    choices: Array.isArray(question.choices)
      ? question.choices.filter((choice) => typeof choice === 'string' && choice.trim()).map((choice) => choice.trim())
      : [],
    suggested_standards: (question.suggested_standards ?? []).filter((standard) => allowedSet.has(standard.code)),
  }));
  if (questions.length === 0) {
    throw new Error('Solar Pro 3가 문항을 찾지 못했습니다. 원본이 선명한지 확인하거나 Gemini 직접 분석을 사용해주세요.');
  }
  return { questions };
}
