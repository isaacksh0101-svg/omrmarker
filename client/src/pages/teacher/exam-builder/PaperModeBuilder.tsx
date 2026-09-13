import { useState } from 'react';
import type { Question, StandardOption } from '../../../types';
import { Card } from '../../../components/Card';
import { PaperBuildTab } from './PaperBuildTab';
import { PaperAnswerTab } from './PaperAnswerTab';

interface Props {
  examId: number;
  questions: Question[];
  standardOptions: StandardOption[];
  missingByQuestion: Map<number, string[]>;
  onChanged: () => void;
}

export function PaperModeBuilder({ examId, questions, standardOptions, missingByQuestion, onChanged }: Props) {
  const [tab, setTab] = useState<'build' | 'answers'>('build');

  return (
    <Card>
      <div className="flex gap-1 rounded-full bg-bg p-1">
        <button
          className={`flex-1 rounded-full px-3 py-1.5 text-sm font-bold transition-colors duration-150 ${
            tab === 'build' ? 'bg-panel text-ink shadow-sm' : 'text-ink-soft'
          }`}
          onClick={() => setTab('build')}
        >
          1. 틀 만들기
        </button>
        <button
          className={`flex-1 rounded-full px-3 py-1.5 text-sm font-bold transition-colors duration-150 ${
            tab === 'answers' ? 'bg-panel text-ink shadow-sm' : 'text-ink-soft'
          }`}
          onClick={() => setTab('answers')}
        >
          2. 정답 입력
        </button>
      </div>

      <div className="mt-4">
        {tab === 'build' ? (
          <PaperBuildTab examId={examId} questions={questions} onChanged={onChanged} />
        ) : (
          <PaperAnswerTab
            examId={examId}
            questions={questions}
            standardOptions={standardOptions}
            missingByQuestion={missingByQuestion}
            onChanged={onChanged}
          />
        )}
      </div>
    </Card>
  );
}
