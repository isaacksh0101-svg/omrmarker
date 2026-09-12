import { useRef, useState } from 'react';
import { api, ApiError } from '../../../api/client';
import { Card } from '../../../components/Card';
import { Button } from '../../../components/Button';

interface Props {
  examId: number;
  onExtracted: () => void;
}

export function AiUploadPanel({ examId, onExtracted }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setError(null);
    setLoading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      await api.postForm(`/exams/${examId}/ai-extract`, formData);
      onExtracted();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'AI 추출 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  return (
    <Card>
      <h2 className="text-sm font-bold text-ink">AI로 문항 불러오기</h2>
      <p className="mt-1 text-xs text-ink-soft">
        시험지 사진(JPG/PNG) 또는 PDF를 올리면 AI가 문항과 보기를 옮겨 적고 성취기준을 제안합니다. 정답은
        AI가 판단하지 않으니, 추출된 문항마다 직접 정답을 확인·입력해야 확정할 수 있습니다.
      </p>
      <div className="mt-3 flex items-center gap-2">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,application/pdf"
          onChange={handleFileChange}
          className="hidden"
          id="ai-upload-input"
        />
        <Button
          variant="secondary"
          disabled={loading}
          onClick={() => fileInputRef.current?.click()}
        >
          {loading ? '분석 중...' : '이미지 선택'}
        </Button>
        {fileName && <span className="text-xs text-ink-soft">{fileName}</span>}
      </div>
      {error && <p className="mt-2 text-xs font-bold text-danger">{error}</p>}
    </Card>
  );
}
