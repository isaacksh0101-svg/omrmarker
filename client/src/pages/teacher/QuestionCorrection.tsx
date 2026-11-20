import { useEffect, useState } from 'react';
import { api, ApiError } from '../../api/client';
import type { Question, RegradeChange } from '../../types';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { formatPoints } from '../../lib/keywordGrading';

interface Props {
  examId: number;
  question: Question;
  wrongAnswerGroups: { text: string; count: number }[] | null;
  onApplied: () => void;
}

interface PendingAction {
  label: string;
  url: string;
  body: Record<string, unknown>;
  changes: RegradeChange[];
}

// 결과 화면의 문항별 "문항 정정". 정답 오류(정답 추가·변경, 복수 정답)나 문제 오류(전원 정답)를
// 고치고, 이미 낸 답안을 모두 다시 채점한다. 시험을 마친 학생뿐 아니라 응시 중인 학생의 답도 바로
// 반영된다. 적용 전에 점수가 바뀌는 학생을 먼저 보여준다. 교사가 직접 고친 점수는 건드리지 않는다.
export function QuestionCorrection({ examId, question, wrongAnswerGroups, onApplied }: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [newAnswer, setNewAnswer] = useState('');
  const correctKey = question.choices.filter((c) => c.is_correct).map((c) => c.id).join(',');
  const [selectedChoiceIds, setSelectedChoiceIds] = useState<number[]>(
    question.choices.filter((c) => c.is_correct).map((c) => c.id),
  );
  // 정정을 적용해 정답이 바뀌면 체크 상태를 새 정답에 맞춘다.
  useEffect(() => {
    setSelectedChoiceIds(correctKey ? correctKey.split(',').map(Number) : []);
  }, [correctKey]);

  const base = `/exams/${examId}/questions/${question.id}`;
  const essay = question.type === 'short' && question.grading_mode === 'keyword';
  const currentCorrectIds = question.choices.filter((c) => c.is_correct).map((c) => c.id);
  const choicesChanged =
    selectedChoiceIds.length !== currentCorrectIds.length || selectedChoiceIds.some((id) => !currentCorrectIds.includes(id));

  async function preview(label: string, path: string, body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const url = `${base}/${path}`;
      const result = await api.post<{ changes: RegradeChange[] }>(url, { ...body, apply: false });
      setPending({ label, url, body, changes: result.changes });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '확인하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    if (!pending) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.post<{ changes: RegradeChange[] }>(pending.url, { ...pending.body, apply: true });
      setNotice(`${pending.label} - ${result.changes.length}명의 점수를 고쳤습니다.`);
      setPending(null);
      setNewAnswer('');
      onApplied();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '적용하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div className="mt-3 flex items-center gap-2 border-t border-line pt-3">
        <button type="button" className="text-xs font-bold text-accent hover:underline" onClick={() => setOpen(true)}>
          문항 정정 (정답 오류·문제 오류)
        </button>
        {question.full_credit && <Badge tone="warn">전원 정답 처리됨</Badge>}
      </div>
    );
  }

  const disabled = busy || !!pending;

  return (
    <div className="mt-3 flex flex-col gap-3 border-t border-line pt-3 text-xs">
      <div className="flex items-center gap-2">
        <p className="font-bold text-ink">문항 정정</p>
        <span className="text-ink-soft">고치면 이미 낸 답안(응시 중인 학생 포함)을 모두 다시 채점해요.</span>
        <button type="button" className="ml-auto text-ink-soft hover:text-ink" onClick={() => setOpen(false)}>
          닫기
        </button>
      </div>

      {question.full_credit ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2">
          <span className="font-bold text-ink">문제 오류로 전원 정답 처리된 문항이에요.</span>
          <Button
            size="sm"
            variant="secondary"
            disabled={disabled}
            onClick={() => preview('전원 정답 취소', 'full-credit', { enabled: false })}
          >
            전원 정답 취소
          </Button>
        </div>
      ) : (
        <>
          {question.type === 'mc' && (
            <div className="flex flex-col gap-1.5">
              <p className="font-bold text-ink-soft">
                정답 보기 {question.multi_select ? '(모두 고르기 문항 - 고른 보기 전체와 일치해야 정답)' : '(여러 개 고르면 복수 정답 인정)'}
              </p>
              {question.choices.map((c, i) => (
                <label key={c.id} className="flex cursor-pointer items-start gap-1.5 text-ink">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    disabled={disabled}
                    checked={selectedChoiceIds.includes(c.id)}
                    onChange={(e) =>
                      setSelectedChoiceIds((prev) => (e.target.checked ? [...prev, c.id] : prev.filter((id) => id !== c.id)))
                    }
                  />
                  <span>
                    {i + 1}번 {c.text && c.text !== String(i + 1) ? `- ${c.text.slice(0, 40)}` : ''}
                    {c.is_correct && <span className="ml-1 font-bold text-good">(현재 정답)</span>}
                  </span>
                </label>
              ))}
              <Button
                size="sm"
                className="self-start"
                disabled={disabled || !choicesChanged || selectedChoiceIds.length === 0}
                onClick={() => preview('정답 보기 변경', 'correct-choices', { choice_ids: selectedChoiceIds })}
              >
                정답 바꾸기
              </Button>
            </div>
          )}

          {question.type === 'short' && !essay && (
            <div className="flex flex-col gap-1.5">
              <p className="font-bold text-ink-soft">인정하는 정답</p>
              <div className="flex flex-wrap gap-1.5">
                {(question.correct_short_answers ?? []).map((answer) => (
                  <span key={answer} className="flex items-center gap-1 rounded-full bg-good/15 px-2 py-0.5 font-bold text-good">
                    {answer}
                    {(question.correct_short_answers ?? []).length > 1 && (
                      <button
                        type="button"
                        aria-label={`${answer} 정답에서 빼기`}
                        className="text-ink-soft hover:text-danger"
                        disabled={disabled}
                        onClick={() =>
                          preview(`"${answer}" 정답에서 빼기`, 'short-answers', {
                            correct_short_answers: (question.correct_short_answers ?? []).filter((a) => a !== answer),
                          })
                        }
                      >
                        ×
                      </button>
                    )}
                  </span>
                ))}
              </div>
              {wrongAnswerGroups && wrongAnswerGroups.length > 0 && (
                <>
                  <p className="mt-1 font-bold text-ink-soft">학생들이 쓴 오답 - 눌러서 정답으로 인정</p>
                  <div className="flex flex-wrap gap-1.5">
                    {wrongAnswerGroups.map((group) => (
                      <button
                        key={group.text}
                        type="button"
                        disabled={disabled}
                        className="rounded-full border border-line bg-panel px-2 py-0.5 text-ink hover:border-accent disabled:opacity-50"
                        onClick={() => preview(`"${group.text}" 정답 인정`, 'accept-short-answer', { answer_text: group.text })}
                      >
                        {group.text} <span className="text-ink-soft">({group.count}명)</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
              <div className="flex items-center gap-1.5">
                <input
                  className="h-7 min-w-0 flex-1 rounded-lg border border-line bg-bg px-2 text-xs text-ink outline-none focus:border-accent sm:max-w-xs"
                  placeholder="정답으로 추가할 답"
                  value={newAnswer}
                  disabled={disabled}
                  onChange={(e) => setNewAnswer(e.target.value)}
                />
                <Button
                  size="sm"
                  disabled={disabled || !newAnswer.trim()}
                  onClick={() => preview(`"${newAnswer.trim()}" 정답 추가`, 'accept-short-answer', { answer_text: newAnswer })}
                >
                  추가
                </Button>
              </div>
            </div>
          )}

          {essay && (
            <p className="text-ink-soft">
              서술형은 학생별 상세 화면의 채점 칸에서 "키워드 추가"로 표현을 인정하세요. 같은 표현을 쓴 학생도 함께 다시
              채점돼요.
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              disabled={disabled}
              onClick={() => preview('전원 정답 처리', 'full-credit', { enabled: true })}
            >
              문제 오류 - 전원 정답 처리
            </Button>
            <span className="text-ink-soft">답하지 않은 학생, 지금 응시 중인 학생도 이 문항은 만점이 돼요.</span>
          </div>
        </>
      )}

      {pending && (
        <div className="flex flex-col gap-1 rounded-lg border border-accent/30 bg-accent-soft/30 p-2.5">
          <p className="font-bold text-ink">
            {pending.label}: {pending.changes.length === 0 ? '점수가 바뀌는 학생은 없어요.' : `${pending.changes.length}명의 점수가 바뀝니다.`}
          </p>
          {pending.changes.map((c) => (
            <span key={c.session_id} className="text-ink-soft">
              {c.roll_number}번 {c.name ?? ''}: {formatPoints(c.before)} → {formatPoints(c.after)}점
              {c.status === 'in_progress' ? ' (응시 중)' : ''}
            </span>
          ))}
          <div className="mt-1 flex gap-1.5">
            <Button size="sm" disabled={busy} onClick={apply}>
              {busy ? '적용 중...' : '적용'}
            </Button>
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => setPending(null)}>
              취소
            </Button>
          </div>
        </div>
      )}
      {notice && <p className="font-bold text-good">{notice}</p>}
      {error && <p className="font-bold text-danger">{error}</p>}
    </div>
  );
}
