import type { ReactNode } from 'react';
import { MathText } from './MathText';

interface Props {
  prompt: string;
  imagePath: string | null;
  // 이미지가 그림 자료일 뿐이면 true - 문제 설명 텍스트를 위에, 이미지를 아래에 함께 보여준다.
  showPromptText: boolean;
  alt: string;
  // 텍스트도 이미지도 없을 때(종이 마킹 모드 등) 대신 보여줄 내용
  fallback?: ReactNode;
}

// 학생 화면의 문제 영역. 이미지 안에 문제 전체가 있는 문항은 이미지만, 이미지가 그림 자료인
// 문항은 텍스트 설명과 이미지를 함께, 이미지가 없으면 텍스트만 보여준다.
export function QuestionPrompt({ prompt, imagePath, showPromptText, alt, fallback = null }: Props) {
  const text = prompt.trim() && (!imagePath || showPromptText) ? prompt : '';
  if (!text && !imagePath) return <>{fallback}</>;
  return (
    <>
      {text && (
        <p className="whitespace-pre-wrap text-xl font-bold text-ink">
          <MathText text={text} />
        </p>
      )}
      {imagePath && (
        <img
          src={`/uploads/${imagePath}`}
          alt={alt}
          className={`max-w-full rounded-lg border border-line ${text ? 'mt-4' : ''}`}
        />
      )}
    </>
  );
}
