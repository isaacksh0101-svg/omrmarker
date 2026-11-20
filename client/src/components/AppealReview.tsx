import { useState } from 'react';
import { api, ApiError } from '../api/client';
import type { AnswerAppeal, AppealStatus, MonitorHistoryItem } from '../types';
import { formatPoints } from '../lib/keywordGrading';
import { Badge } from './Badge';
import { Button } from './Button';

interface Props {
  examId: number;
  sessionId: number;
  appeal: AnswerAppeal;
  item: MonitorHistoryItem;
  onChanged: () => void;
}

interface RegradeChange {
  session_id: number;
  roll_number: number;
  name: string | null;
  before: number;
  after: number;
  is_correct: boolean;
}

// 받아들일 때 점수를 어떻게 고칠지.
// - student: 이 학생만 만점
// - answer: 답안(정답) 오류 - 학생 답을 정답으로 추가하고 같은 답 쓴 학생 모두 다시 채점(단답형)
// - question: 문제 오류 - 이 문항을 시험 본 학생 전원 만점
// - none: 점수는 그대로 두고 받아들임만
type Fix = 'student' | 'answer' | 'question' | 'none';

// 교사 복습 화면에서 학생이 낸 이의 제기를 보여주고 처리한다. 받아들일 때 점수 정정 방법을 고르면
// 점수를 고친 뒤 받아들임으로 마무리한다. 여러 학생에게 영향이 가는 정정은 먼저 영향을 보여준다.
export function AppealReview({ examId, sessionId, appeal, item, onChanged }: Props) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [fix, setFix] = useState<Fix>('student');
  const [answerText, setAnswerText] = useState(item.short_answer_text ?? '');
  const [preview, setPreview] = useState<RegradeChange[] | null>(null);

  const exactShort = item.type === 'short' && !item.essay;
  const alreadyFull = (item.awarded_points ?? 0) >= item.points && !!item.is_correct;

  async function setStatus(status: AppealStatus) {
    await api.put(`/exams/${examId}/sessions/${sessionId}/appeals/${appeal.id}`, { status });
  }

  async function run(action: () => Promise<void>) {
    setSaving(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '이의 제기 처리 중 오류가 발생했습니다.');
    } finally {
      setSaving(false);
    }
  }

  function bulkUrl(kind: 'answer' | 'question') {
    return kind === 'answer'
      ? `/exams/${examId}/questions/${item.question_id}/accept-short-answer`
      : `/exams/${examId}/questions/${item.question_id}/full-credit`;
  }

  function bulkBody(kind: 'answer' | 'question', apply: boolean) {
    return kind === 'answer' ? { answer_text: answerText, apply } : { apply };
  }

  const checkImpact = () =>
    run(async () => {
      if (fix !== 'answer' && fix !== 'question') return;
      const result = await api.post<{ changes: RegradeChange[] }>(bulkUrl(fix), bulkBody(fix, false));
      setPreview(result.changes);
    });

  const confirmAccept = () =>
    run(async () => {
      if (fix === 'student' && !alreadyFull) {
        await api.put(`/exams/${examId}/sessions/${sessionId}/answers/${item.question_id}/grade`, {
          awarded_points: item.points,
        });
      } else if (fix === 'answer' || fix === 'question') {
        await api.post(bulkUrl(fix), bulkBody(fix, true));
      }
      // 일괄 정정은 만점이 된 학생의 이의 제기를 서버에서 같이 받아들인다 - 이 학생은 여기서 확실히 마무리한다.
      await setStatus('accepted');
      setAccepting(false);
      onChanged();
    });

  const pending = appeal.status === 'pending';
  const needsPreview = fix === 'answer' || fix === 'question';

  return (
    <div
      className={`mt-2 rounded-lg border px-3 py-2 ${
        pending ? 'border-warn/40 bg-warn/10' : 'border-line bg-bg'
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-bold text-ink">학생 이의 제기</span>
        {pending ? (
          <Badge tone="warn">처리 전</Badge>
        ) : appeal.status === 'accepted' ? (
          <Badge tone="good">받아들임</Badge>
        ) : (
          <Badge tone="neutral">기각</Badge>
        )}
        <span className="ml-auto flex gap-1.5">
          {pending ? (
            !accepting && (
              <>
                <Button size="sm" disabled={saving} onClick={() => setAccepting(true)}>
                  받아들임
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={saving}
                  onClick={() =>
                    run(async () => {
                      await setStatus('rejected');
                      onChanged();
                    })
                  }
                >
                  기각
                </Button>
              </>
            )
          ) : (
            <button
              type="button"
              className="text-[11px] font-bold text-ink-soft hover:text-accent"
              disabled={saving}
              onClick={() =>
                run(async () => {
                  await setStatus('pending');
                  onChanged();
                })
              }
              title="처리 상태만 되돌립니다. 이미 고친 점수는 그대로입니다."
            >
              처리 취소
            </button>
          )}
        </span>
      </div>
      <p className="mt-1 whitespace-pre-wrap break-words text-sm text-ink">{appeal.reason}</p>

      {pending && accepting && (
        <div className="mt-2 flex flex-col gap-1.5 rounded-lg border border-line bg-panel p-2.5 text-xs">
          <p className="font-bold text-ink">점수를 어떻게 고칠까요?</p>
          <FixOption value="student" current={fix} onPick={(v) => { setFix(v); setPreview(null); }}>
            이 학생만 만점 ({formatPoints(item.awarded_points ?? 0)} → {formatPoints(item.points)}점)
            {alreadyFull && ' - 이미 만점이에요'}
          </FixOption>
          {exactShort && (
            <FixOption value="answer" current={fix} onPick={(v) => { setFix(v); setPreview(null); }}>
              답안 오류 - 이 답도 정답으로 추가하고, 같은 답을 쓴 학생 모두 다시 채점
            </FixOption>
          )}
          {fix === 'answer' && (
            <input
              className="ml-5 h-7 rounded-lg border border-line bg-bg px-2 text-xs text-ink outline-none focus:border-accent"
              value={answerText}
              onChange={(e) => {
                setAnswerText(e.target.value);
                setPreview(null);
              }}
              placeholder="정답으로 추가할 답"
            />
          )}
          {item.essay && (
            <p className="ml-5 text-ink-soft">
              서술형에서 표현을 인정하려면 위 채점 칸의 "키워드 추가"를 쓰세요. 같은 표현을 쓴 학생도 함께 다시 채점돼요.
            </p>
          )}
          <FixOption value="question" current={fix} onPick={(v) => { setFix(v); setPreview(null); }}>
            문제 오류 - 이 문항을 시험 본 학생 전원 만점
          </FixOption>
          <FixOption value="none" current={fix} onPick={(v) => { setFix(v); setPreview(null); }}>
            점수는 그대로 두고 받아들임만
          </FixOption>

          {preview && (
            <div className="mt-1 flex flex-col gap-0.5">
              {preview.length === 0 ? (
                <p className="text-ink-soft">점수가 바뀌는 학생이 없어요.</p>
              ) : (
                <>
                  <p className="font-bold text-ink">{preview.length}명의 점수가 바뀝니다.</p>
                  {preview.map((c) => (
                    <span key={c.session_id} className="text-ink-soft">
                      {c.roll_number}번 {c.name ?? ''}: {formatPoints(c.before)} → {formatPoints(c.after)}점
                    </span>
                  ))}
                </>
              )}
            </div>
          )}

          <div className="mt-1 flex gap-1.5">
            {needsPreview && !preview ? (
              <Button size="sm" disabled={saving || (fix === 'answer' && !answerText.trim())} onClick={checkImpact}>
                영향 확인
              </Button>
            ) : (
              <Button size="sm" disabled={saving} onClick={confirmAccept}>
                {saving ? '처리 중...' : '고치고 받아들임'}
              </Button>
            )}
            <Button
              size="sm"
              variant="secondary"
              disabled={saving}
              onClick={() => {
                setAccepting(false);
                setPreview(null);
              }}
            >
              취소
            </Button>
          </div>
        </div>
      )}
      {error && <p className="mt-1 text-xs font-bold text-danger">{error}</p>}
    </div>
  );
}

function FixOption({
  value,
  current,
  onPick,
  children,
}: {
  value: Fix;
  current: Fix;
  onPick: (value: Fix) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-1.5 text-ink">
      <input type="radio" className="mt-0.5" checked={current === value} onChange={() => onPick(value)} />
      <span>{children}</span>
    </label>
  );
}
