import { useEffect, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../../../api/client';
import type { Exam, FinalizeMissing, StandardOption } from '../../../types';
import { Card } from '../../../components/Card';
import { Button } from '../../../components/Button';
import { Badge } from '../../../components/Badge';
import { QuestionEditor } from './QuestionEditor';
import { AiUploadPanel } from './AiUploadPanel';
import { AiAnswerUploadPanel } from './AiAnswerUploadPanel';
import { PaperModeBuilder } from './PaperModeBuilder';
import { AnswerGridInput } from './AnswerGridInput';

const GRADE_LABEL: Record<string, string> = {
  elem_1_2: '1~2학년군',
  elem_3_4: '3~4학년군',
  elem_5_6: '5~6학년군',
};

export function ExamBuilder() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [exam, setExam] = useState<Exam | null>(null);
  const [tab, setTab] = useState<'build' | 'answers'>('build');
  const [standardOptions, setStandardOptions] = useState<StandardOption[]>([]);
  const [missing, setMissing] = useState<FinalizeMissing[] | null>(null);
  const [finalizeError, setFinalizeError] = useState<string | null>(null);
  const [finalizing, setFinalizing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // 시험지 이름 바꾸기 - 확정된 시험도 가능하다(이름은 응시 기록·채점에 영향이 없다).
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [savingTitle, setSavingTitle] = useState(false);
  const [titleError, setTitleError] = useState<string | null>(null);

  async function saveTitle() {
    const title = titleDraft.trim();
    if (!exam || !title || title === exam.title) {
      setEditingTitle(false);
      return;
    }
    setSavingTitle(true);
    setTitleError(null);
    try {
      setExam(await api.put<Exam>(`/exams/${id}`, { title }));
      setEditingTitle(false);
    } catch (e) {
      setTitleError(e instanceof ApiError ? e.message : '이름 변경 중 오류가 발생했습니다.');
    } finally {
      setSavingTitle(false);
    }
  }

  // 온라인 응시 ↔ 종이 시험지+마킹 모드 변환. 한 번 누르면 안내를 보여주고, 한 번 더 눌러야
  // 바뀐다. 학생이 참여한 시험이면 서버가 막는다.
  const [confirmingMode, setConfirmingMode] = useState(false);
  const [changingMode, setChangingMode] = useState(false);
  const [modeMessage, setModeMessage] = useState<{ tone: 'error' | 'info'; text: string } | null>(null);

  async function changeMode() {
    if (!exam) return;
    const next = exam.mode === 'online' ? 'paper_marking' : 'online';
    setChangingMode(true);
    setModeMessage(null);
    try {
      const updated = await api.put<Exam & { mode_change?: { empty_prompts: number; back_to_draft: boolean } }>(
        `/exams/${id}/mode`,
        { mode: next },
      );
      setExam(updated);
      setMissing(null);
      setTab('build');
      const info = updated.mode_change;
      if (next === 'online' && info && info.empty_prompts > 0) {
        setModeMessage({
          tone: 'info',
          text: `온라인 응시로 바꿨어요. 문제 내용이 비어 있는 문항이 ${info.empty_prompts}개 있어요 - 문제를 입력하거나 AI로 불러온 뒤${
            info.back_to_draft ? ' 다시 확정해주세요(작성 중으로 되돌렸어요).' : ' 확정해주세요.'
          }`,
        });
      } else {
        setModeMessage({
          tone: 'info',
          text:
            next === 'online'
              ? '온라인 응시로 바꿨어요. 학생 화면에 문제와 보기가 보여요.'
              : '종이 시험지 + 마킹으로 바꿨어요. 문제 내용은 그대로 남아 있고 학생 화면에만 안 보여요.',
        });
      }
    } catch (e) {
      setModeMessage({ tone: 'error', text: e instanceof ApiError ? e.message : '모드 변경 중 오류가 발생했습니다.' });
    } finally {
      setChangingMode(false);
      setConfirmingMode(false);
    }
  }

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
      await api.post<Exam>(`/exams/${id}/finalize`);
      navigate('/');
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
    <div className="mx-auto max-w-3xl px-6 py-12 pb-24">
      <button
        className="text-xs font-bold text-ink-soft transition-colors duration-150 hover:text-accent"
        onClick={() => navigate('/exam-management')}
      >
        ← 시험지 관리
      </button>
      <div className="animate-fade-in-up mt-3 flex flex-wrap items-center gap-2">
        {editingTitle ? (
          <form
            className="flex min-w-0 flex-1 items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              saveTitle();
            }}
          >
            <input
              autoFocus
              maxLength={100}
              value={titleDraft}
              disabled={savingTitle}
              onChange={(e) => setTitleDraft(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && setEditingTitle(false)}
              className="min-w-0 flex-1 rounded-lg border border-line bg-panel px-3 py-1.5 text-lg font-bold text-ink outline-none focus:border-accent"
            />
            <Button type="submit" size="sm" disabled={savingTitle || !titleDraft.trim()}>
              {savingTitle ? '저장 중...' : '저장'}
            </Button>
            <Button type="button" variant="secondary" size="sm" disabled={savingTitle} onClick={() => setEditingTitle(false)}>
              취소
            </Button>
          </form>
        ) : (
          <>
            <h1 className="text-2xl font-bold tracking-tight text-ink">{exam.title}</h1>
            <button
              className="text-xs font-bold text-ink-soft hover:text-accent"
              onClick={() => {
                setTitleDraft(exam.title);
                setTitleError(null);
                setEditingTitle(true);
              }}
            >
              이름 바꾸기
            </button>
          </>
        )}
        <Badge tone={exam.status === 'finalized' ? 'good' : 'neutral'}>
          {exam.status === 'finalized' ? '확정됨' : '작성 중'}
        </Badge>
        <Badge tone="neutral">{exam.mode === 'paper_marking' ? '종이 시험지 + 마킹' : '온라인 응시'}</Badge>
        {exam.status !== 'archived' &&
          (confirmingMode ? (
            <span className="flex items-center gap-1.5">
              <Button size="sm" disabled={changingMode} onClick={changeMode}>
                {changingMode
                  ? '바꾸는 중...'
                  : exam.mode === 'online'
                    ? '종이 시험지로 바꾸기'
                    : '온라인 응시로 바꾸기'}
              </Button>
              <Button size="sm" variant="secondary" disabled={changingMode} onClick={() => setConfirmingMode(false)}>
                취소
              </Button>
            </span>
          ) : (
            <button
              className="text-xs font-bold text-ink-soft hover:text-accent"
              onClick={() => {
                setModeMessage(null);
                setConfirmingMode(true);
              }}
            >
              모드 바꾸기
            </button>
          ))}
        {exam.status === 'finalized' && (
          <button
            className="ml-auto text-xs font-bold text-accent hover:underline"
            onClick={() => navigate(`/exams/${exam.id}/results`)}
          >
            결과 보기
          </button>
        )}
      </div>
      {titleError && <p className="mt-1 text-xs font-bold text-danger">{titleError}</p>}
      {confirmingMode && (
        <p className="mt-1 text-xs text-ink-soft">
          {exam.mode === 'online'
            ? '종이 시험지 모드에서는 학생 화면에 문제 없이 답 번호만 보여요. 입력한 문제 내용은 지워지지 않아서 다시 온라인으로 돌릴 수 있어요.'
            : '온라인 모드에서는 학생 화면에 문제와 보기를 보여줘요. 틀만 만든 문항은 문제 내용이 비어 있으니 바꾼 뒤 채워야 해요.'}{' '}
          학생이 이미 참여한 시험은 바꿀 수 없어요.
        </p>
      )}
      {modeMessage && (
        <p className={`mt-1 text-xs font-bold ${modeMessage.tone === 'error' ? 'text-danger' : 'text-accent'}`}>
          {modeMessage.text}
        </p>
      )}
      <p className="mt-1 text-sm text-ink-soft">
        {GRADE_LABEL[exam.grade_cluster] || exam.grade_cluster} · {exam.subject_id} ·{' '}
        {Math.round(exam.time_limit_sec / 60)}분
      </p>
      {exam.mode === 'paper_marking' ? (
        <div className="mt-6">
          <PaperModeBuilder
            examId={exam.id}
            questions={exam.questions ?? []}
            standardOptions={standardOptions}
            missingByQuestion={missingByQuestion}
            onChanged={reload}
          />
        </div>
      ) : (
        <Card className="mt-6">
          <div className="flex gap-1 rounded-full bg-bg p-1">
            <button
              className={`flex-1 rounded-full px-3 py-1.5 text-sm font-bold transition-colors duration-150 ${
                tab === 'build' ? 'bg-panel text-ink shadow-sm' : 'text-ink-soft'
              }`}
              onClick={() => setTab('build')}
            >
              1. 문항 만들기
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
              <>
                <AiUploadPanel examId={exam.id} onExtracted={reload} />

                <div className="mt-6 flex flex-col gap-4">
                  {(exam.questions ?? []).map((q, i) => (
                    <QuestionEditor
                      key={q.id}
                      examId={exam.id}
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
              </>
            ) : (
              <>
                <p className="text-xs text-ink-soft">
                  정답지를 보면서 순서대로 빠르게 입력하세요. 객관식은 정답 번호를, 단답형은 정답을
                  입력합니다.
                </p>
                <div className="mt-3">
                  <AiAnswerUploadPanel examId={exam.id} onFilled={reload} />
                </div>
                <div className="mt-3">
                  <AnswerGridInput
                    examId={exam.id}
                    questions={exam.questions ?? []}
                    missingByQuestion={missingByQuestion}
                    onChanged={reload}
                  />
                </div>
              </>
            )}
          </div>
        </Card>
      )}

      <Card className="mt-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 sm:pr-4">
            <h2 className="text-sm font-bold text-ink">시험지 만들기</h2>
            <p className="mt-1 text-xs text-ink-soft">
              모든 문항에 정답이 설정되어야 확정할 수 있습니다. 성취기준 태깅은 선택이지만, AI로
              불러온 문항은 AI가 저절로 태깅합니다.
            </p>
          </div>
          <Button
            className="shrink-0 whitespace-nowrap"
            onClick={finalize}
            disabled={finalizing || (exam.questions ?? []).length === 0}
          >
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
