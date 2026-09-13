// 목록/필터에서는 원래 교과명이 너무 길어 줄바꿈되거나 답답해 보이므로 화면 표시용으로만
// 줄여 쓴다. 실제 데이터(subject_id)나 서버 쪽 성취기준 데이터는 그대로 둔다.
const SHORT_NAMES: Record<string, string> = {
  '실과(기술가정)·정보': '실과',
  '바른생활·슬기로운생활·건강한생활·즐거운생활': '바슬즐',
};

export function displaySubjectName(name: string): string {
  return SHORT_NAMES[name] ?? name;
}
