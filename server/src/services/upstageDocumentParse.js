import { getUpstageApiKey } from './appSettings.js';

export const UPSTAGE_AVAILABLE_UNTIL = '2027-03-19';
const UPSTAGE_DISABLE_AT = Date.UTC(2027, 2, 20);

export function isUpstageDocumentParseAvailable(now = Date.now()) {
  return now < UPSTAGE_DISABLE_AT;
}

// Document Parse는 OCR 텍스트만 받는다 - 문항 이미지는 자동으로 자르지 않는다. Solar
// Pro는 텍스트 전용 LLM이라 이미지를 직접 보고 영역을 판단할 방법이 없고(Gemini와 다른
// 점), 요소별 좌표를 코드로 조합해 문항 경계를 추측하는 방식도 2단 편집이나 객관식 보기
// 번호 때문에 계속 오탐이 있었다. 대신 문항 내용은 전부 텍스트(수식은 LaTeX)로 옮기고,
// 표·그림처럼 텍스트로 옮기기 어려운 문항만 교사가 문항 편집 화면에서 원본 페이지를 보고
// 직접 크롭한다(source_image_path에 저장해 둔 원본을 그대로 쓴다).
export async function parseDocumentWithUpstage(buffer, mimeType, filename = 'document') {
  if (!isUpstageDocumentParseAvailable()) {
    throw new Error('Upstage Document Parse + Solar Pro 3 옵션은 2027년 3월 19일까지만 사용할 수 있습니다.');
  }
  const apiKey = getUpstageApiKey();
  if (!apiKey) throw new Error('환경설정에서 Upstage API 키를 먼저 저장해주세요.');

  const form = new FormData();
  form.append('document', new Blob([buffer], { type: mimeType }), filename);
  form.append('model', 'document-parse');
  form.append('ocr', 'force');
  form.append('output_formats', "['markdown']");

  const response = await fetch('https://api.upstage.ai/v1/document-digitization', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Upstage Document Parse 오류 (${response.status}): ${detail}`);
  }
  const result = await response.json();
  const parsed = result?.content?.markdown || result?.content?.text || result?.content?.html;
  if (!parsed) throw new Error('Upstage 응답에서 문서 내용을 찾을 수 없습니다.');
  return { text: parsed };
}
