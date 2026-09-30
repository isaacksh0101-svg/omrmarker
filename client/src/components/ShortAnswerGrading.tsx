import { useState } from 'react';
import { api, ApiError } from '../api/client';
import type { MonitorHistoryItem } from '../types';
import { Badge } from './Badge';
import { formatPoints } from '../lib/keywordGrading';

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 답안에서 채점에 인정된 표현을 굵게 표시한다. 채점은 띄어쓰기를 무시하므로 답안에 띄어쓰기가
// 다르게 들어간 표현은 여기서 표시되지 않을 수 있다(점수에는 이미 반영됨).
function HighlightedAnswer({ text, highlights }: { text: string; highlights: string[] }) {
  const terms = highlights.filter(Boolean);
  if (terms.length === 0) return <>{text}</>;
  const pattern = new RegExp(`(${terms.map(escapeRegExp).join('|')})`, 'gi');
  return (
    <>
      {text.split(pattern).map((part, i) =>
        i % 2 === 1 ? (
          <mark key={i} className="rounded bg-good/20 px-0.5 text-inherit">
            {part}
          </mark>
        ) : (
          part
        ),
      )}
    </>
  );
}

interface RegradeChange {
  session_id: number;
  roll_number: number;
  name: string | null;
  before: number;
  after: number;
  is_correct: boolean;
}

interface AcceptProps {
  examId: number;
  questionId: number;
  groupIndex: number;
  initialExpression: string;
  onCancel: () => void;
  onApplied: () => void;
}

// 이의 제기로 학생이 쓴 표현을 인정한다. 그 표현을 핵심 내용의 동의어로 추가하면 같은 표현을 쓴
// 다른 학생도 함께 다시 채점되므로, 적용 전에 점수가 바뀌는 학생을 먼저 보여준다.
function KeywordExpressionAccept({ examId, questionId, groupIndex, initialExpression, onCancel, onApplied }: AcceptProps) {
  const [expression, setExpression] = useState(initialExpression);
  const [preview, setPreview] = useState<{ points: number; changes: RegradeChange[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(apply: boolean) {
    setBusy(true);
    setError(null);
    try {
      const result = await api.post<{ points: number; changes: RegradeChange[] }>(
        `/exams/${examId}/questions/${questionId}/keyword-expression`,
        { group_index: groupIndex, expression, apply },
      );
      if (apply) onApplied();
      else setPreview(result);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : '처리하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="my-1 flex flex-col gap-1.5 rounded-lg border border-accent/30 bg-accent-soft/30 p-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <input
          autoFocus
          className="h-7 min-w-0 flex-1 rounded-lg border border-line bg-panel px-2 text-xs text-ink outline-none focus:border-accent"
          placeholder="학생 답에서 인정할 표현 (예: 탄산가스)"
          value={expression}
          onChange={(e) => {
            setExpression(e.target.value);
            setPreview(null);
          }}
        />
        <button
          className="font-bold text-accent hover:underline disabled:opacity-50"
          disabled={busy || !expression.trim()}
          onClick={() => run(false)}
        >
          영향 확인
        </button>
        <button className="text-ink-soft hover:text-danger" onClick={onCancel}>
          취소
        </button>
      </div>
      {preview && (
        <>
          {preview.changes.length === 0 ? (
            <p className="text-ink-soft">이 표현으로 점수가 바뀌는 학생이 없습니다. 표현을 다시 확인해주세요.</p>
          ) : (
            <div className="flex flex-col gap-0.5">
              <p className="font-bold text-ink">
                "{expression.trim()}"을(를) 인정하면 {preview.changes.length}명의 점수가 바뀝니다.
              </p>
              {preview.changes.map((c) => (
                <span key={c.session_id} className="text-ink-soft">
                  {c.roll_number}번 {c.name ?? ''}: {formatPoints(c.before)} → {formatPoints(c.after)}점
                  {c.is_correct ? ' (정답 처리, 오답 재풀이에서 빠짐)' : ''}
                </span>
              ))}
            </div>
          )}
          <button
            className="self-start rounded-lg bg-accent px-2.5 py-1 font-bold text-white disabled:opacity-50"
            disabled={busy}
            onClick={() => run(true)}
          >
            {preview.changes.length === 0 ? '키워드만 추가' : '인정하고 다시 채점'}
          </button>
        </>
      )}
      {error && <p className="font-bold text-danger">{error}</p>}
    </div>
  );
}

interface Props {
  examId: number;
  sessionId: number;
  item: MonitorHistoryItem;
  editable: boolean;
  onSaved: () => void;
}

// 학생별 상세 화면의 단답형·서술형 답안 칸. 서술형은 핵심 내용별 채점 결과를 보여주고,
// 끝난 시험이면 교사가 점수를 직접 고칠 수 있다(키워드 자동 채점은 초안일 뿐이므로).
export function ShortAnswerGrading({ examId, sessionId, item, editable, onSaved }: Props) {
  const [score, setScore] = useState(String(item.awarded_points ?? 0));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const answer = item.short_answer_text ?? '';
  const groups = item.keyword_groups ?? [];
  const changed = Number(score) !== (item.awarded_points ?? 0);
  // 이의 제기 처리 중인 핵심 내용 줄(없으면 null)
  const [acceptGroup, setAcceptGroup] = useState<number | null>(null);
  const [acceptExpression, setAcceptExpression] = useState('');

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await api.put(`/exams/${examId}/sessions/${sessionId}/answers/${item.question_id}/grade`, {
        awarded_points: Number(score),
      });
      onSaved();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : '점수를 저장하지 못했습니다.');
    } finally {
      setSaving(false);
    }
  }

  const tone = item.is_correct ? 'text-good' : (item.awarded_points ?? 0) > 0 ? 'text-warn' : 'text-danger';

  return (
    <div className="mt-2 flex flex-col gap-1.5 text-xs">
      <p className={`whitespace-pre-wrap font-bold ${tone}`}>
        학생 답:{' '}
        {answer ? (
          <HighlightedAnswer text={answer} highlights={groups.map((g) => g.matched ?? '')} />
        ) : (
          '(무응답)'
        )}
      </p>

      {item.essay && groups.length > 0 && (
        <div className="flex flex-col gap-0.5 rounded-lg border border-line bg-bg px-2.5 py-1.5">
          {groups.map((g, i) => (
            <div key={i}>
              <div className="flex items-center gap-2">
                <span className={g.matched ? 'text-good' : 'text-ink-soft'}>
                  {g.matched ? '✓' : '✗'} {g.keywords.join(' / ')}
                  {g.weight !== 1 ? ` (비중 ${g.weight})` : ''}
                </span>
                {editable && !g.matched && answer && acceptGroup !== i && (
                  <button
                    className="shrink-0 font-bold text-accent hover:underline"
                    title="학생 답에서 인정할 부분을 드래그해 선택한 뒤 누르면 그 표현이 채워집니다"
                    onClick={() => {
                      // 교사가 답안에서 드래그해 둔 부분이 있으면 그 표현으로 채운다.
                      setAcceptExpression(window.getSelection()?.toString().trim() ?? '');
                      setAcceptGroup(i);
                    }}
                  >
                    키워드 추가
                  </button>
                )}
              </div>
              {acceptGroup === i && (
                <KeywordExpressionAccept
                  examId={examId}
                  questionId={item.question_id}
                  groupIndex={i}
                  initialExpression={acceptExpression}
                  onCancel={() => setAcceptGroup(null)}
                  onApplied={() => {
                    setAcceptGroup(null);
                    onSaved();
                  }}
                />
              )}
            </div>
          ))}
        </div>
      )}

      {!item.essay && !item.is_correct && item.correct_short_answers && item.correct_short_answers.length > 0 && (
        <p className="text-ink-soft">정답: {item.correct_short_answers.join(', ')}</p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <span className="font-bold text-ink-soft">점수</span>
        {editable ? (
          <>
            <input
              type="number"
              min={0}
              max={item.points}
              step={0.5}
              aria-label={`${item.order_index + 1}번 점수`}
              className="h-7 w-16 rounded-lg border border-line bg-bg px-1.5 text-center text-xs text-ink outline-none focus:border-accent"
              value={score}
              onChange={(e) => setScore(e.target.value)}
            />
            <span className="text-ink-soft">/ {formatPoints(item.points)}점</span>
            {changed && (
              <button
                className="font-bold text-accent hover:underline disabled:opacity-50"
                disabled={saving}
                onClick={save}
              >
                {saving ? '저장 중...' : '점수 저장'}
              </button>
            )}
            {changed && !item.is_correct && Number(score) >= item.points && (
              <span className="text-ink-soft">만점으로 저장하면 정답 처리되고 오답 재풀이에서 빠집니다.</span>
            )}
            {changed && item.is_correct && Number(score) < item.points && (
              <span className="text-ink-soft">만점보다 낮추면 오답 처리되고 오답 재풀이에 다시 들어갑니다.</span>
            )}
          </>
        ) : (
          <span className="text-ink">
            {formatPoints(item.awarded_points ?? 0)} / {formatPoints(item.points)}점
          </span>
        )}
        {item.needs_review && (
          <Badge tone="warn" title="부분 점수이거나 부정 표현이 섞인 답안입니다 - 뜻이 맞는지 확인해주세요.">
            검토 필요
          </Badge>
        )}
        {item.graded_by_teacher && <Badge tone="neutral">교사 채점</Badge>}
      </div>
      {error && <p className="font-bold text-danger">{error}</p>}
    </div>
  );
}
