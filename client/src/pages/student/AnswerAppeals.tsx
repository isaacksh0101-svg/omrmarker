import { useState } from 'react';
import { api, ApiError } from '../../api/client';
import type { AppealStatus, SessionAnswerSummary } from '../../types';
import { Button } from '../../components/Button';

const APPEAL_REASON_MAX = 300;

const STATUS_LABEL: Record<AppealStatus, { text: string; className: string }> = {
  pending: { text: '선생님께 보냈어요', className: 'text-accent-ink' },
  accepted: { text: '이의 제기가 받아들여졌어요', className: 'text-good' },
  rejected: { text: '이의 제기가 기각됐어요', className: 'text-ink-soft' },
};

interface Props {
  examId: number;
  sessionToken: string;
  targets: SessionAnswerSummary[];
  onSent: () => void;
}

// 오답 재풀이를 다 마친 화면에서, 아직 이의 제기를 안 보낸 문항도 마저 보낼 수 있게 모아 보여준다.
export function AnswerAppeals({ examId, sessionToken, targets, onSent }: Props) {
  if (targets.length === 0) return null;
  return (
    <div className="mt-7">
      <p className="text-sm font-bold text-ink">단답형·서술형 채점 확인</p>
      <p className="mt-1 text-xs text-ink-soft">
        시험 때 쓴 답의 채점이 잘못됐다고 생각하면 이의 제기를 보내세요. 문항마다 한 번만 보낼 수 있어요.
      </p>
      <div className="mt-3 flex flex-col gap-2.5">
        {targets.map((a) => (
          <AppealItem key={a.question_id} examId={examId} sessionToken={sessionToken} answer={a} onSent={onSent} />
        ))}
      </div>
    </div>
  );
}

// 오답 재풀이 중 단답형·서술형 문항에서 "시험 때 쓴 답"과 받은 점수를 보여주고 이의 제기를 받는다.
// 정답은 보여주지 않는다.
export function AppealItem({
  examId,
  sessionToken,
  answer,
  onSent,
}: {
  examId: number;
  sessionToken: string;
  answer: SessionAnswerSummary;
  onSent: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    const text = reason.trim();
    if (!text) {
      setError('이의 제기 이유를 적어주세요.');
      return;
    }
    setSending(true);
    setError(null);
    try {
      await api.post(`/exams/${examId}/sessions/${sessionToken}/appeals`, {
        question_id: answer.question_id,
        reason: text,
      });
      setOpen(false);
      onSent();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '보내는 중 오류가 발생했어요. 선생님께 말씀해주세요.');
    } finally {
      setSending(false);
    }
  }

  const status = answer.appeal_status ? STATUS_LABEL[answer.appeal_status] : null;

  return (
    <div className="rounded-xl border border-line bg-panel px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-sm font-bold text-ink">{answer.order_index + 1}번</span>
        <span className="text-xs text-ink-soft">{answer.grading_mode === 'keyword' ? '서술형' : '단답형'}</span>
        <span className="text-xs font-bold text-ink-soft">
          {answer.awarded_points ?? 0} / {answer.points}점
        </span>
        <span className="ml-auto">
          {status ? (
            <span className={`text-xs font-bold ${status.className}`}>{status.text}</span>
          ) : (
            !open && (
              <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
                이의 제기
              </Button>
            )
          )}
        </span>
      </div>
      <p className="mt-1.5 whitespace-pre-wrap break-words text-sm text-ink">
        <span className="text-xs font-bold text-ink-soft">시험 때 쓴 답 </span>
        {answer.short_answer_text || '(빈 답)'}
      </p>
      {open && !status && (
        <div className="mt-2.5">
          <textarea
            autoFocus
            value={reason}
            maxLength={APPEAL_REASON_MAX}
            disabled={sending}
            onChange={(e) => setReason(e.target.value)}
            placeholder="시험 때 쓴 답이 왜 맞다고 생각하는지 적어주세요."
            rows={3}
            className="w-full rounded-xl border border-line bg-bg px-3 py-2 text-sm text-ink outline-none focus:border-accent"
          />
          <div className="mt-1.5 flex items-center gap-2">
            <span className="text-xs text-ink-soft">
              {reason.length}/{APPEAL_REASON_MAX}
            </span>
            <span className="ml-auto flex gap-2">
              <Button size="sm" variant="secondary" disabled={sending} onClick={() => setOpen(false)}>
                취소
              </Button>
              <Button size="sm" disabled={sending || !reason.trim()} onClick={send}>
                {sending ? '보내는 중...' : '보내기'}
              </Button>
            </span>
          </div>
        </div>
      )}
      {error && <p className="mt-1.5 text-xs font-bold text-danger">{error}</p>}
    </div>
  );
}
