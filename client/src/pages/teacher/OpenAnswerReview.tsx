import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../../api/client';
import type { SessionStatus } from '../../types';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';

interface PendingGroup {
  key: string;
  text: string;
  students: { session_id: number; roll_number: number; name: string | null; status: SessionStatus }[];
}

interface PendingEssay {
  session_id: number;
  roll_number: number;
  name: string | null;
  status: SessionStatus;
  text: string;
  suggested_points: number;
}

interface OpenAnswerQuestion {
  question_id: number;
  order_index: number;
  prompt: string;
  points: number;
  kind: 'short' | 'essay';
  correct_short_answers: string[];
  rejected_short_answers: string[];
  pending_groups: PendingGroup[];
  pending_essays: PendingEssay[];
}

interface OpenAnswersData {
  questions: OpenAnswerQuestion[];
  pending_count: number;
}

interface Props {
  examId: number;
  onChanged: () => void;
}

// 결과 화면 위쪽의 "답안 확인" 카드. 시험지에서 "교사 직접 채점"으로 표시한 문항의 확인 대기 답을 보여준다.
// - 단답형: 같은 답끼리 묶어 보여준다. 정답/오답을 누르면 그 답을 쓴 학생 모두에게 적용되고, 응시 중이거나
//   나중에 같은 답을 내는 학생에게도 자동으로 적용된다.
// - 서술형: 학생마다 답을 보여주고 점수를 직접 넣는다(키워드 자동 채점 점수가 제안값으로 채워져 있다).
//   시험을 마친 학생만 점수를 줄 수 있다.
// 확인하기 전까지 학생 결과에는 "선생님 확인 후 정답 확정"으로 보인다.
export function OpenAnswerReview({ examId, onChanged }: Props) {
  const [data, setData] = useState<OpenAnswersData | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showDecided, setShowDecided] = useState(false);

  const load = useCallback(() => {
    api.get<OpenAnswersData>(`/exams/${examId}/open-answers`).then(setData).catch(() => {});
  }, [examId]);

  useEffect(() => {
    load();
    // 시험 중에도 새로 들어오는 답이 바로 보이도록 결과 화면과 같은 주기로 다시 불러온다.
    const interval = window.setInterval(load, 4000);
    return () => window.clearInterval(interval);
  }, [load]);

  async function act(busy: string, path: string, questionId: number, body: Record<string, unknown>) {
    setBusyKey(busy);
    setError(null);
    try {
      await api.post(`/exams/${examId}/questions/${questionId}/${path}`, { ...body, apply: true });
      load();
      onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '처리하지 못했습니다.');
    } finally {
      setBusyKey(null);
    }
  }

  if (!data || data.questions.length === 0) return null;

  return (
    <Card className="animate-fade-in-up mt-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-base font-bold text-ink">답안 확인</h2>
        <span className="text-xs text-ink-soft">교사 직접 채점 문항</span>
        {data.pending_count > 0 ? (
          <Badge tone="warn">확인할 답 {data.pending_count}개</Badge>
        ) : (
          <Badge tone="good">모두 확인함</Badge>
        )}
        <button
          type="button"
          className="ml-auto text-xs font-bold text-ink-soft hover:text-accent"
          onClick={() => setShowDecided((v) => !v)}
        >
          {showDecided ? '정한 답 숨기기' : '정한 답 보기'}
        </button>
      </div>
      <p className="mt-1 text-xs text-ink-soft">
        단답형은 같은 답을 쓴 학생끼리 묶여 있어요. 정답/오답을 누르면 그 답을 쓴 학생 모두에게 적용되고, 나중에 같은 답을
        내는 학생에게도 자동으로 적용돼요. 서술형은 학생마다 점수를 넣어 주세요(키워드로 계산한 점수가 미리 채워져 있어요).
      </p>

      <div className="mt-3 flex flex-col gap-4">
        {data.questions.map((q) => (
          <div key={q.question_id}>
            <p className="text-sm font-bold text-ink">
              {q.order_index + 1}번
              <span className="ml-2 text-xs font-normal text-ink-soft">
                {q.prompt ? `${q.prompt.slice(0, 50)}${q.prompt.length > 50 ? '…' : ''}` : ''}
              </span>
            </p>
            {q.kind === 'essay' ? (
              q.pending_essays.length === 0 ? (
                <p className="mt-1 text-xs text-ink-soft">채점할 답이 없어요.</p>
              ) : (
                <div className="mt-1.5 flex flex-col divide-y divide-line rounded-lg border border-line">
                  {q.pending_essays.map((e) => (
                    <EssayGradeRow
                      key={e.session_id}
                      examId={examId}
                      questionId={q.question_id}
                      points={q.points}
                      essay={e}
                      disabled={busyKey != null}
                      onSaved={() => {
                        load();
                        onChanged();
                      }}
                    />
                  ))}
                </div>
              )
            ) : q.pending_groups.length === 0 ? (
              <p className="mt-1 text-xs text-ink-soft">확인할 답이 없어요.</p>
            ) : (
              <div className="mt-1.5 flex flex-col divide-y divide-line rounded-lg border border-line">
                {q.pending_groups.map((g) => {
                  const busy = busyKey?.startsWith(`${q.question_id}:${g.key}`) ?? false;
                  return (
                    <div key={g.key} className="flex flex-wrap items-center gap-2 px-3 py-2 text-xs">
                      <span className="min-w-0 flex-1 whitespace-pre-wrap break-words text-sm font-bold text-ink">
                        {g.text}
                      </span>
                      <span className="text-ink-soft">
                        {g.students.length}명 ({g.students.map((s) => `${s.roll_number}번`).join('·')})
                      </span>
                      <Button
                        size="sm"
                        disabled={busyKey != null}
                        onClick={() =>
                          act(`${q.question_id}:${g.key}:ok`, 'accept-short-answer', q.question_id, { answer_text: g.text })
                        }
                      >
                        {busy && busyKey?.endsWith(':ok') ? '처리 중...' : '정답'}
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={busyKey != null}
                        onClick={() =>
                          act(`${q.question_id}:${g.key}:no`, 'reject-short-answer', q.question_id, { answer_text: g.text })
                        }
                      >
                        {busy && busyKey?.endsWith(':no') ? '처리 중...' : '오답'}
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
            {showDecided && q.kind === 'short' && (
              <div className="mt-2 flex flex-col gap-1.5 text-xs">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-bold text-ink-soft">정답</span>
                  {q.correct_short_answers.length === 0 && <span className="text-ink-soft">없음</span>}
                  {q.correct_short_answers.map((answer) => (
                    <span key={answer} className="flex items-center gap-1 rounded-full bg-good/15 px-2 py-0.5 font-bold text-good">
                      {answer}
                      <button
                        type="button"
                        title="정답에서 빼기 - 이 답을 쓴 학생은 다시 확인할 답으로 돌아가요"
                        className="text-ink-soft hover:text-danger"
                        disabled={busyKey != null}
                        onClick={() =>
                          act(`${q.question_id}:c:${answer}`, 'short-answers', q.question_id, {
                            correct_short_answers: q.correct_short_answers.filter((a) => a !== answer),
                          })
                        }
                      >
                        ↺
                      </button>
                    </span>
                  ))}
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-bold text-ink-soft">오답</span>
                  {q.rejected_short_answers.length === 0 && <span className="text-ink-soft">없음</span>}
                  {q.rejected_short_answers.map((answer) => (
                    <span key={answer} className="flex items-center gap-1 rounded-full bg-danger/10 px-2 py-0.5 font-bold text-danger">
                      {answer}
                      <button
                        type="button"
                        title="오답 확정 취소 - 이 답을 쓴 학생은 다시 확인할 답으로 돌아가요"
                        className="text-ink-soft hover:text-accent"
                        disabled={busyKey != null}
                        onClick={() =>
                          act(`${q.question_id}:r:${answer}`, 'reject-short-answer', q.question_id, {
                            answer_text: answer,
                            undo: true,
                          })
                        }
                      >
                        ↺
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
      {error && <p className="mt-2 text-xs font-bold text-danger">{error}</p>}
    </Card>
  );
}

interface EssayGradeRowProps {
  examId: number;
  questionId: number;
  points: number;
  essay: PendingEssay;
  disabled: boolean;
  onSaved: () => void;
}

// 서술형 답 한 명분: 답 전문 + 점수 입력. 점수는 키워드 자동 채점 점수로 미리 채워 둔다.
// 카드가 몇 초마다 다시 불러와도 학생별(key=session_id)로 유지돼 입력 중인 값이 지워지지 않는다.
function EssayGradeRow({ examId, questionId, points, essay, disabled, onSaved }: EssayGradeRowProps) {
  const [value, setValue] = useState(String(essay.suggested_points));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const finished = essay.status === 'submitted' || essay.status === 'force_submitted';

  async function save() {
    const score = Number(value);
    if (value.trim() === '' || !Number.isFinite(score) || score < 0 || score > points) {
      setError(`0~${points}점 사이로 넣어 주세요.`);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.put(`/exams/${examId}/sessions/${essay.session_id}/answers/${questionId}/grade`, {
        awarded_points: score,
      });
      onSaved();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '저장하지 못했습니다.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-1.5 px-3 py-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-bold text-ink">
          {essay.roll_number}번{essay.name ? ` ${essay.name}` : ''}
        </span>
        {!finished && <Badge tone="warn">응시 중 - 제출 후 채점</Badge>}
        <div className="ml-auto flex items-center gap-1.5">
          <input
            type="number"
            min={0}
            max={points}
            step="any"
            className="h-8 w-16 rounded-lg border border-line bg-panel px-2 text-center text-sm text-ink outline-none focus:border-accent"
            value={value}
            disabled={!finished}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && finished && save()}
            title="키워드로 계산한 점수가 미리 채워져 있어요"
          />
          <span className="text-ink-soft">/ {points}점</span>
          <Button size="sm" disabled={!finished || disabled || saving} onClick={save}>
            {saving ? '저장 중...' : '점수 확정'}
          </Button>
        </div>
      </div>
      <p className="whitespace-pre-wrap break-words rounded-lg bg-surface-container px-3 py-2 text-sm text-ink">{essay.text}</p>
      {error && <p className="font-bold text-danger">{error}</p>}
    </div>
  );
}
