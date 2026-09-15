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
            prompt: {
              type: 'STRING',
              description:
                '문제 지시문과 본문만. 객관식이면 보기 내용(㉠㉡㉢, ①②③④⑤ 뒤에 오는 값/식)은 여기 반복해서 적지 않고 choices에만 적는다. 수식(분수·곱셈/나눗셈 기호 등)은 $...$ 안에 LaTeX로 적는다. bounding_box로 이미지를 잘라 보여줄 것이므로, 텍스트로 옮기기 어려운 도형/표/선긋기 등은 억지로 옮기려 하지 않고 간단한 지시문 정도만 적어도 된다.',
            },
            bounding_box: {
              type: 'OBJECT',
              description:
                '이 문항의 발문(지시문+본문, 도형/표/선긋기 등 포함, 객관식이면 보기는 제외)을 감싸는 사각형. 이미지 전체를 가로/세로 0~1000으로 정규화한 좌표.',
              properties: {
                ymin: { type: 'INTEGER' },
                xmin: { type: 'INTEGER' },
                ymax: { type: 'INTEGER' },
                xmax: { type: 'INTEGER' },
              },
              required: ['ymin', 'xmin', 'ymax', 'xmax'],
            },
            choices: {
              type: 'ARRAY',
              description: '객관식일 때만 채운다. 각 보기의 기호와 실제 내용을 함께 담는다.',
              items: {
                type: 'OBJECT',
                properties: {
                  order_index: { type: 'INTEGER' },
                  text: {
                    type: 'STRING',
                    description:
                      '이 보기의 기호(㉠, ①, 가 등)와 그 뒤에 오는 실제 내용(수식 포함)을 전부 담는다. 기호만 담고 끝내지 않는다. 수식 부분은 $...$ 안에 LaTeX로 적는다. 예: "① $15/8 \\div 5/24$".',
                  },
                },
                required: ['order_index', 'text'],
              },
            },
            suggested_standards: {
              type: 'ARRAY',
              // 성취기준 태깅이 이 기능의 핵심 목적이다 - 최소 1개는 반드시 채우도록 스키마
              // 단계에서도 강제한다(프롬프트 지시만으로는 모델이 비워버리는 경우가 있었다).
              minItems: 1,
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

function buildPrompt(gradeLabel, subjectName, candidateStandards) {
  // 코드만 나열하면 모델이 "6수01-01" 같은 코드가 실제로 뭘 말하는지 모른 채(자기가 학습 때 본 것에
  // 기대어) 찍는 경우가 있었다(예: 분수 나눗셈 문제에 각기둥 성취기준을 고르는 식). 그래서 각 코드가
  // 무슨 내용인지 여기서 직접 알려주고, 반드시 그 내용을 문제와 비교해서 고르라고 명시한다.
  const standardsList = candidateStandards.map((s) => `- ${s.code}: ${s.statement}`).join('\n');

  return `당신은 초등학교 ${gradeLabel} ${subjectName} 시험지 이미지를 분석하는 보조 도구입니다.

이미지에 있는 문항들을 순서대로 추출하세요. 각 문항에 대해:
1. 문제 내용(prompt)을 이미지에 보이는 그대로 옮겨 적으세요. **단, 객관식이면 보기 내용은 prompt에 넣지 않습니다** (아래 3번 참고).
2. 유형(type)을 판단하세요: 보기 중에서 고르는 문제는 "mc", 직접 답을 쓰는 문제는 "short".
3. 객관식(mc)이면 보기(choices)를 순서대로 모두 옮겨 적으세요. **각 보기의 text에는 기호(㉠, ①, 가 등)와 그
   뒤에 오는 실제 내용을 반드시 함께 담으세요.** 보기 내용이 분수식·계산식이라 복잡해 보여도 기호만 담고
   끝내지 마세요. 예를 들어 이미지에 "① 15/8 ÷ 5/24"라고 쓰여 있으면 choices의 text는 아래 4번 규칙대로
   "① $15/8 \\div 5/24$" 전체여야 하며, "①"만 담고 실제 식은 prompt 쪽에 남겨두면 안 됩니다.
4. **수식은 화면에 실제 분수·연산 기호로 보이도록 LaTeX로 적으세요.** 수식이 나오는 부분만 $...$로
   감싸고, 그 안에 LaTeX 문법을 씁니다. 분수는 반드시 "1/6"처럼 슬래시로 적지 말고 \\frac{1}{6}로,
   대분수는 2\\frac{1}{3}로, 나눗셈은 \\div, 곱셈은 \\times로 적으세요. 예: "9/10 ÷ 3/10"은
   "$\\frac{9}{10} \\div \\frac{3}{10}$"로, "8 ÷ 4/7 = ▢"는 "$8 \\div \\frac{4}{7} = $ ▢"로 적습니다.
   순수 정수·글(예: "3번", "빈칸에")나 도형·○/▢ 같은 기호는 $ 없이 그냥 텍스트로 둡니다.
5. **bounding_box로 이 문항의 발문 영역을 표시하세요.** 학생 화면엔 텍스트 대신 이 좌표로 원본
   이미지에서 잘라낸 그림을 보여줍니다. 그래서 도형·표·선긋기·복잡한 배치처럼 텍스트로는 정확히
   옮기기 어려운 내용도 원본 그대로 보여줄 수 있습니다. 이 문항의 지시문+본문 전체(객관식이면 보기는
   제외)를 넉넉하지도 빠듯하지도 않게 감싸고, 다른 문항 영역은 포함하지 마세요. 선 긋기(매칭)처럼
   객관식/단답형 어느 쪽에도 깔끔히 안 맞는 문제는 type을 "short"로 하고, prompt는 짧은 지시문만
   적은 뒤 bounding_box로 전체 내용(선긋기 도식 포함)을 보여주는 쪽에 맡기세요.
6. **성취기준 태깅은 이 작업에서 가장 중요한 부분입니다. 예외 없이 모든 문항에 최소 1개 이상의
   성취기준을 반드시 붙이세요 - 비워두는 것은 허용되지 않습니다.** 아래 목록은 이미 이 시험지의
   학년군·교과로 좁혀져 있으므로, 그 안에서 이 문항과 가장 관련 있는 성취기준이 반드시 존재합니다.
   **코드만 보고 짐작하지 말고, 코드 옆에 적힌 성취기준 내용을 문제 내용과 직접 비교해서** 가장 주제가
   가까운 것을 고르세요. 예를 들어 문제가 분수의 나눗셈이라면, 도형(각기둥·각뿔 등)이나 측정, 자료와
   가능성처럼 명백히 다른 영역의 성취기준보다는 수와 연산 영역의 성취기준을 우선하세요. 100% 완벽하게
   일치하는 항목이 없어 보이더라도 목록 중 가장 가까운 것을 선택하고, 그 판단이 얼마나 확실한지는
   confidence(완전히 일치하면 high, 근접하지만 확실하지 않으면 medium 또는 low)로 표현하세요 - confidence가
   낮다는 이유로 아예 태깅을 생략하면 안 됩니다. rationale에는 왜 그 성취기준을 골랐는지 간단히 적으세요.
   단, 목록에 없는 코드를 새로 만들어내는 것만은 절대 금지입니다.

성취기준 목록(코드: 내용):
${standardsList}

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

  const promptText = buildPrompt(gradeLabel, subjectName, candidateStandards);
  const responseSchema = buildResponseSchema(allowedCodes);

  const result = await callGemini({ imageBase64, mimeType, promptText, responseSchema });

  const allowedSet = new Set(allowedCodes);
  const questions = (result.questions ?? []).map((q, i) => ({
    order_index: q.order_index ?? i,
    type: q.type === 'short' ? 'short' : 'mc',
    prompt: q.prompt ?? '',
    bounding_box: q.bounding_box ?? null,
    choices: (q.choices ?? []).map((c, ci) => ({ order_index: c.order_index ?? ci, text: c.text ?? '' })),
    // 서버가 다시 한번 필터링한다 - 모델이 스키마를 어기고 목록 밖 코드를 내놓는 경우를 방지.
    suggested_standards: (q.suggested_standards ?? []).filter((s) => allowedSet.has(s.code)),
  }));

  return { questions };
}
