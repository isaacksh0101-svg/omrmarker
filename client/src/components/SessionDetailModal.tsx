import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import type { SessionMonitorDetail } from '../types';
import { statusMeta } from '../lib/sessionStatus';
import { Button } from './Button';
import { MathText } from './MathText';
import { StrokesReplay } from './StrokesReplay';

function formatMs(ms: number | null) {
  if (ms == null) return '-';
  return `${Math.round(ms / 1000)}초`;
}

interface SessionDetailModalProps {
  examId: number;
  sessionId: number;
  questionCount: number;
  // 어느 시험의 상세인지 - 학생별 리포트처럼 여러 시험을 넘나들며 열 때는 이게 없으면
  // 지금 보고 있는 게 어느 시험 결과인지 헷갈린다.
  examTitle?: string;
  onClose: () => void;
  // 실시간 감독 화면에서 쓸 때만 켠다 - 3초마다 다시 불러오고, 강제종료/재참여허용/
  // 되살리기 액션도 같이 보여준다. 리포트(끝난 시험 조회)에서는 꺼둔 채로 한 번만 불러온다.
  live?: boolean;
  onForceEnd?: (sessionId: number) => void;
  onAllowRejoin?: (sessionId: number) => void;
  onRevive?: (sessionId: number) => void;
}

// 감독 화면과 리포트(시험별 분석 결과보기, 학생별 리포트) 양쪽에서 같이 쓰는 "학생 한 명 ×
// 시험 한 번" 상세 보기. 문항별로 무엇을 답했는지, 얼마나 걸렸는지, 필기를 남겼다면 그
// 필기까지 다시 볼 수 있다.
export function SessionDetailModal({
  examId,
  sessionId,
  questionCount,
  examTitle,
  onClose,
  live = false,
  onForceEnd,
  onAllowRejoin,
  onRevive,
}: SessionDetailModalProps) {
  const [detail, setDetail] = useState<SessionMonitorDetail | null>(null);
  const [openStrokesIndex, setOpenStrokesIndex] = useState<number | null>(null);

  const load = useCallback(() => {
    api.get<SessionMonitorDetail>(`/exams/${examId}/sessions/${sessionId}/monitor`).then(setDetail);
  }, [examId, sessionId]);

  useEffect(() => {
    load();
    if (!live) return;
    const interval = setInterval(load, 3000);
    return () => clearInterval(interval);
  }, [load, live]);

  const meta = detail ? statusMeta(detail.session.status, detail.session.disqualify_reason) : null;
  const canForceEnd = live && (detail?.session.status === 'joined' || detail?.session.status === 'in_progress');
  const canRevive = live && detail?.session.status === 'force_submitted';

  return (
    <div
      className="animate-overlay-in fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4"
      onClick={onClose}
    >
      <div
        className="animate-scale-in flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-panel shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div>
            {examTitle && <p className="text-xs font-bold text-ink-soft">{examTitle}</p>}
            <p className="text-sm font-bold text-ink">
              {detail?.student?.roll_number}번 {detail?.student?.name || ''}
            </p>
            {meta && (
              <div className="mt-0.5 flex items-center gap-1.5">
                <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
                <span className="text-xs text-ink-soft">{meta.label}</span>
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full px-2 py-1 text-xs font-bold text-ink-soft transition-colors duration-150 hover:bg-panel hover:text-ink"
          >
            닫기
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {!detail ? (
            <p className="text-sm text-ink-soft">불러오는 중...</p>
          ) : (
            <>
              {detail.currentQuestion && (
                <div className="animate-fade-in-up rounded-xl border border-line bg-bg p-3.5">
                  <p className="text-xs font-bold text-accent-ink">
                    지금 보고 있는 화면 · {detail.currentQuestion.index + 1} / {detail.currentQuestion.total}
                  </p>
                  {detail.currentQuestion.prompt_image_path ? (
                    <img
                      src={`/uploads/${detail.currentQuestion.prompt_image_path}`}
                      alt="문항 이미지"
                      className="mt-2 max-w-full rounded-lg border border-line"
                    />
                  ) : (
                    detail.currentQuestion.prompt && (
                      <p className="mt-2 whitespace-pre-wrap text-sm font-bold text-ink">
                        <MathText text={detail.currentQuestion.prompt} />
                      </p>
                    )
                  )}
                  {detail.currentQuestion.type === 'mc' && (
                    <div className="mt-2 flex flex-col gap-1.5">
                      {detail.currentQuestion.choices.map((c) => (
                        <div
                          key={c.id}
                          className="flex items-center justify-between rounded-lg border border-line bg-panel px-2.5 py-1.5 text-xs text-ink"
                        >
                          <span>
                            <MathText text={c.text} />
                          </span>
                          {c.is_correct && <span className="text-[10px] font-bold text-good">정답(교사용)</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {(detail.session.status === 'submitted' || detail.session.status === 'force_submitted') && (
                <div className="rounded-xl border border-line bg-bg p-3.5">
                  <p className="text-xs font-bold text-ink-soft">최종 점수</p>
                  <p className="mt-1 text-lg font-bold text-ink">
                    {detail.session.score ?? 0} / {detail.session.max_score ?? 0}
                  </p>
                </div>
              )}

              <p className="mt-4 text-xs font-bold text-ink-soft">
                지금까지 응답 ({detail.history.length} / {questionCount})
              </p>
              {detail.history.length === 0 ? (
                <p className="mt-1.5 text-xs text-ink-soft">아직 제출한 답이 없습니다.</p>
              ) : (
                <div className="mt-1.5 flex flex-col divide-y divide-line">
                  {detail.history.map((h) => {
                    const strokesOpen = openStrokesIndex === h.order_index;
                    return (
                      <div key={h.order_index} className="py-2">
                        <div className="flex items-center gap-2">
                          <span
                            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                              h.is_correct ? 'bg-good/15 text-good' : 'bg-danger/15 text-danger'
                            }`}
                          >
                            {h.order_index + 1}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-xs text-ink-soft">
                            {h.selected_choice_text ?? h.short_answer_text ?? '-'}
                          </span>
                          <span className="shrink-0 text-[11px] text-ink-soft">{formatMs(h.time_spent_ms)}</span>
                          {h.strokes && (
                            <button
                              type="button"
                              className="shrink-0 text-[11px] font-bold text-accent hover:underline"
                              onClick={() => setOpenStrokesIndex(strokesOpen ? null : h.order_index)}
                            >
                              필기 {strokesOpen ? '닫기' : '보기'}
                            </button>
                          )}
                        </div>
                        {strokesOpen && h.strokes && (
                          <StrokesReplay
                            payload={h.strokes}
                            className="animate-fade-in-up mt-2 w-full rounded-lg border border-line bg-bg"
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>

        {canForceEnd && (
          <div className="flex flex-col gap-2 border-t border-line px-5 py-3">
            <Button variant="secondary" className="w-full" onClick={() => onAllowRejoin?.(sessionId)}>
              재참여 허용 (다른 기기로 이어가기)
            </Button>
            <Button variant="danger" className="w-full" onClick={() => onForceEnd?.(sessionId)}>
              이 학생 시험 강제 종료
            </Button>
          </div>
        )}
        {canRevive && (
          <div className="border-t border-line px-5 py-3">
            <Button variant="secondary" className="w-full" onClick={() => onRevive?.(sessionId)}>
              강제 종료 취소하고 되살리기
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
