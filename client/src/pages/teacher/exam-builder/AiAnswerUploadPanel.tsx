import { useRef, useState } from 'react';
import { api, ApiError } from '../../../api/client';
import { Card } from '../../../components/Card';
import { Button } from '../../../components/Button';

interface Props {
  examId: number;
  onFilled: () => void;
}

interface AiExtractAnswersResponse {
  applied: number[];
  skipped: number[];
  // 서술형: AI가 채점 키워드를 추천해 채운 문항 / 교사가 이미 입력해 둬서 그대로 둔 문항
  keyword_suggested: number[];
  keyword_kept: number[];
}

export function AiAnswerUploadPanel({ examId, onFilled }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AiExtractAnswersResponse | null>(null);
  const [provider, setProvider] = useState<'gemini' | 'upstage'>('gemini');
  const upstageExpired = Date.now() >= Date.UTC(2027, 2, 20);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setError(null);
    setResult(null);
    setLoading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('provider', provider);
      const res = await api.postForm<AiExtractAnswersResponse>(`/exams/${examId}/ai-extract-answers`, formData);
      setResult(res);
      onFilled();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'AI 추출 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  return (
    <Card>
      <h2 className="text-sm font-bold text-ink">AI로 정답 채우기</h2>
      <p className="mt-1 text-xs text-ink-soft">
        정답지 사진(JPG/PNG) 또는 PDF를 올리면 AI가 문항 번호에 맞춰 정답을 자동으로 채웁니다. 채운
        뒤에도 아래 표에서 확인하고 수정할 수 있습니다. "서술형"으로 표시한 문항은 모범답안에서 채점
        키워드를 추천해 채웁니다(이미 입력한 키워드는 그대로 둡니다).
      </p>
      <div className="mt-3 flex items-center gap-2">
        <select
          value={provider}
          onChange={(e) => setProvider(e.target.value as 'gemini' | 'upstage')}
          disabled={loading}
          className="rounded-xl border border-line bg-white px-3 py-2.5 text-sm text-ink"
        >
          <option value="gemini">Gemini 직접 분석</option>
          <option value="upstage" disabled={upstageExpired}>Upstage Document Parse + Solar Pro 3</option>
        </select>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,application/pdf"
          onChange={handleFileChange}
          className="hidden"
          id="ai-answer-upload-input"
        />
        <Button variant="secondary" disabled={loading} onClick={() => fileInputRef.current?.click()}>
          {loading ? '분석 중...' : '정답지 선택'}
        </Button>
        {fileName && <span className="text-xs text-ink-soft">{fileName}</span>}
      </div>
      {provider === 'upstage' && !upstageExpired && (
        <p className="mt-2 text-[11px] text-ink-soft">
          Upstage가 문서를 판독하고 Solar Pro 3가 정답을 정리합니다. 2027년 3월 19일까지 사용할 수 있습니다.
        </p>
      )}
      {upstageExpired && <p className="mt-2 text-[11px] font-bold text-danger">Upstage 옵션 사용 기간이 종료되었습니다.</p>}
      {error && <p className="mt-2 text-xs font-bold text-danger">{error}</p>}
      {result && (
        <div className="mt-2 flex flex-col gap-1 text-xs">
          <p className="font-bold text-ink">
            {result.applied.length}개 문항의 정답을 채웠습니다.
            {result.skipped.length > 0 && (
              <span className="font-normal text-ink-soft">
                {' '}
                인식하지 못한 문항은 직접 입력해주세요: {result.skipped.join(', ')}번
              </span>
            )}
          </p>
          {result.keyword_suggested.length > 0 && (
            <p className="font-bold text-warn">
              서술형 {result.keyword_suggested.join(', ')}번에 AI가 채점 키워드를 추천했습니다. 아래 표에서 "핵심 내용"을
              펼쳐 빠지거나 잘못된 표현이 없는지 꼭 확인해주세요.
            </p>
          )}
          {result.keyword_kept.length > 0 && (
            <p className="text-ink-soft">
              서술형 {result.keyword_kept.join(', ')}번은 이미 입력한 키워드가 있어 그대로 두었습니다.
            </p>
          )}
        </div>
      )}
    </Card>
  );
}
