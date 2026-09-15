import katex from 'katex';
import 'katex/dist/katex.min.css';

// AI가 새로 불러오는 문제는 분수/식을 "$...$" 안에 LaTeX로 담아 보낸다(예: "$\frac{1}{6}$").
// 이 컴포넌트는 그 구간만 KaTeX로 실제 수학 기호로 그리고, 나머지는 그냥 텍스트로 둔다.
// "$"가 아예 없는 텍스트(예전에 저장된 "1/6" 같은 일반 텍스트)는 그대로 보여지므로,
// 기존 문제를 따로 변환하지 않아도 안전하다.
function renderMathSegment(latex: string, key: number) {
  try {
    const html = katex.renderToString(latex, { throwOnError: false, output: 'html' });
    // eslint-disable-next-line react/no-danger
    return <span key={key} dangerouslySetInnerHTML={{ __html: html }} />;
  } catch {
    return <span key={key}>{latex}</span>;
  }
}

export function MathText({ text, className }: { text: string; className?: string }) {
  if (!text) return null;
  const parts = text.split(/\$([^$]+)\$/g);
  return (
    <span className={className}>
      {parts.map((part, i) => (i % 2 === 1 ? renderMathSegment(part, i) : <span key={i}>{part}</span>))}
    </span>
  );
}
