import { useEffect, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../../../api/client';
import type { Exam, FinalizeMissing, StandardOption } from '../../../types';
import { Card } from '../../../components/Card';
import { Button } from '../../../components/Button';
import { Badge } from '../../../components/Badge';
import { QuestionEditor } from './QuestionEditor';
import { AiUploadPanel } from './AiUploadPanel';

const GRADE_LABEL: Record<string, string> = {
  elem_1_2: '1~2학년군',
  elem_3_4: '3~4학년군',
  elem_5_6: '5~6학년군',
};

export function ExamBuilder() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [exam, setExam] = useState<Exam | null>(null);
  const [standardOptions, setStandardOptions] = useState<StandardOption[]>([]);
  const [missing, setMissing] = useState<FinalizeMissing[] | null>(null);
  const [finalizeError, setFinalizeError] = useState<string | null>(null);
  const [finalizing, setFinalizing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const reload = useCallback(() => {
    api.get<Exam>(`/exams/${id}`).then(setExam);
  }, [id]);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    if (!exam) return;
    api
      .get<StandardOption[]>(`/standards?subject_id=${exam.subject_id}&grade_cluster=${exam.grade_cluster}`)
      .then(setStandardOptions);
  }, [exam?.subject_id, exam?.grade_cluster]);

  async function addQuestion(type: 'mc' | 'short') {
    setActionError(null);
    try {
      await api.post(`/exams/${id}/questions`, { type, points: 1 });
      reload();
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : '문항 추가 중 오류가 발생했습니다.');
    }
  }

  async function finalize() {
    setFinalizing(true);
    setMissing(null);
    setFinalizeError(null);
    try {
      const updated = await api.post<Exam>(`/exams/${id}/finalize`);
      setExam(updated);
    } catch (e) {
      if (e instanceof ApiError && e.status === 400) {
        const body = e.body as { error: string; missing?: FinalizeMissing[] };
        setFinalizeError(body.error);
        setMissing(body.missing ?? []);
      } else {
        setFinalizeError('확정 중 오류가 발생했습니다.');
      }
    } finally {
      setFinalizing(false);
    }
  }

  if (!exam) return <div className="p-10 text-sm text-ink-soft">불러오는 중...</div>;

  const missingByQuestion = new Map((missing ?? []).map((m) => [m.question_id, m.reasons]));

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 pb-24">
      <button className="text-xs font-bold text-ink-soft hover:text-accent" onClick={() => navigate('/')}>
        ← 시험 목록
      </button>

      <div className="mt-3 flex items-center gap-2">
        <h1 className="text-xl font-bold text-ink">{exam.title}</h1>
        <Badge tone={exam.status === 'finalized' ? 'good' : 'neutral'}>
          {exam.status === 'finalized' ? '확정됨' : '작성 중'}
        </Badge>
        <Badge tone="neutral">{exam.mode === 'paper_marking' ? '종이 시험지 + 마킹' : '온라인 응시'}</Badge>
      </div>
      <p className="mt-1 text-sm text-ink-soft">
        {GRADE_LABEL[exam.grade_cluster] || exam.grade_cluster} · {exam.subject_id} ·{' '}
        {Math.round(exam.time_limit_sec / 60)}분
      </p>
      {exam.mode === 'paper_marking' && (
        <p className="mt-2 rounded-xl bg-accent-soft px-3 py-2 text-xs text-accent-ink">
          종이 시험지 + 마킹 모드입니다. 학생 화면에는 문제 내용 없이 마킹 UI만 표시되므로, 아래 문제 내용
          입력은 성취기준 태깅을 돕기 위한 참고용이며 생략해도 확정할 수 있습니다.
        </p>
      )}

      <div className="mt-6">
        <AiUploadPanel examId={exam.id} onExtracted={reload} />
      </div>

      <div className="mt-6 flex flex-col gap-4">
        {(exam.questions ?? []).map((q, i) => (
          <QuestionEditor
            key={q.id}
            examId={exam.id}
            examMode={exam.mode}
            question={q}
            index={i}
            standardOptions={standardOptions}
            missingReasons={missingByQuestion.get(q.id)}
            onChanged={reload}
          />
        ))}
      </div>

      <div className="mt-4 flex gap-2">
        <Button variant="secondary" onClick={() => addQuestion('mc')}>
          + 객관식 문항 추가
        </Button>
        <Button variant="secondary" onClick={() => addQuestion('short')}>
          + 단답형 문항 추가
        </Button>
      </div>
      {actionError && <p className="mt-2 text-xs font-bold text-danger">{actionError}</p>}

      <Card className="mt-8">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold text-ink">시험 확정</h2>
            <p className="mt-1 text-xs text-ink-soft">
              모든 문항에 정답과 성취기준이 설정되어야 확정할 수 있습니다.
            </p>
          </div>
          <Button onClick={finalize} disabled={finalizing || (exam.questions ?? []).length === 0}>
            확정하기
          </Button>
        </div>
        {finalizeError && (
          <div className="mt-3 rounded-xl bg-danger/10 p-3 text-xs text-danger">
            <p className="font-bold">{finalizeError}</p>
            {missing && missing.length > 0 && (
              <ul className="mt-1 list-disc pl-4">
                {missing.map((m) => (
                  <li key={m.question_id}>
                    {m.order_index + 1}번 문항: {m.reasons.join(', ')}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
