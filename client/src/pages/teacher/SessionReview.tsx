import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ApiError, api } from '../../api/client';
import type { Exam, ExamResultsData, SessionMonitorDetail, SessionQuestionOutlier } from '../../types';
import type { StrokesPayload } from '../../lib/strokes';
import { Card } from '../../components/Card';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { MathText } from '../../components/MathText';
import { StrokesReplay } from '../../components/StrokesReplay';
import { ShortAnswerGrading } from '../../components/ShortAnswerGrading';
import { AppealReview } from '../../components/AppealReview';
import { statusMeta } from '../../lib/sessionStatus';

function formatMs(ms: number | null) {
  if (ms == null) return '-';
  return `${Math.round(ms / 1000)}초`;
}

// 점 몇 개는 실수로 스친 자국일 수 있어서, "실제로 풀어보려 한 시도"로 볼 만한 최소
// 기준을 경험적으로 잡았다 - 정교한 통계라기보다 교사가 한 번 볼 만한지 걸러내는 정도.
const MEANINGFUL_STROKE_POINTS = 30;

function strokePointCount(strokes: StrokesPayload | null) {
  if (!strokes) return 0;
  return strokes.strokes.reduce((sum, s) => sum + s.points.length, 0);
}

// "결과보기"나 "학생별 리포트"에서 학생 한 명 × 시험 한 번을 클릭하면 들어오는 상세 화면.
// 실시간 감독 중 쓰는 SessionDetailModal(좁은 팝업, 강제종료 등 액션 포함)과는 용도가
// 달라서 분리했다 - 여긴 끝난 시험을 문항별로 찬찬히 복습하는 화면이라 페이지로 만들고,
// 문제·보기·정답을 전부 그대로 보여준다.
export function SessionReview() {
  const { id, sessionId } = useParams();
  const navigate = useNavigate();
  const examId = Number(id);
  const sid = Number(sessionId);

  const [exam, setExam] = useState<Exam | null>(null);
  const [detail, setDetail] = useState<SessionMonitorDetail | null>(null);
  const [resultsData, setResultsData] = useState<ExamResultsData | null>(null);
  const [openStrokesIndex, setOpenStrokesIndex] = useState<number | null>(null);
  const [questionOutliers, setQuestionOutliers] = useState<SessionQuestionOutlier[]>([]);

  useEffect(() => {
    api.get<Exam>(`/exams/${examId}`).then(setExam);
  }, [examId]);

  useEffect(() => {
    setDetail(null);
    setOpenStrokesIndex(null);
    setQuestionOutliers([]);
    api.get<SessionMonitorDetail>(`/exams/${examId}/sessions/${sid}/monitor`).then(setDetail);
    api.get<SessionQuestionOutlier[]>(`/exams/${examId}/sessions/${sid}/question-insights`).then(setQuestionOutliers);
  }, [examId, sid]);

  // 교사가 단답형·서술형 점수를 고친 뒤 총점과 문항 표시를 새로 불러온다.
  function reloadAfterGrade() {
    api.get<SessionMonitorDetail>(`/exams/${examId}/sessions/${sid}/monitor`).then(setDetail);
    api.get<ExamResultsData>(`/exams/${examId}/results`).then(setResultsData);
  }

  // 테스트 응시처럼 남길 필요 없는 응시 기록 한 건만 지운다. 같은 학생의 다른 시험 기록은
  // 그대로 남는다(학생의 모든 기록을 지우는 것은 학생 명단 화면의 "학습 데이터 삭제").
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  async function removeSession() {
    if (!detail) return;
    const who = `${detail.student?.roll_number}번${detail.student?.name ? ` ${detail.student.name}` : ''}`;
    const inProgress = detail.session.status === 'joined' || detail.session.status === 'in_progress';
    const warning = inProgress ? '\n\n이 학생은 아직 응시 중입니다. 삭제하면 학생 화면의 시험이 중단됩니다.' : '';
    if (
      !confirm(
        `${who}의 이 시험 응시 기록을 완전 삭제할까요?\n\n답안, 점수, 필기, 화면 이탈 기록, 오답 재풀이 과제가 삭제되며 되돌릴 수 없습니다. 이 학생의 다른 시험 기록은 유지되고, 이 시험은 다시 응시할 수 있습니다.${warning}`,
      )
    )
      return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await api.delete(`/exams/${examId}/sessions/${sid}`);
      window.dispatchEvent(new Event('scorelab:data-retention-changed'));
      navigate(`/exams/${examId}/results`, { replace: true });
    } catch (e) {
      setDeleteError(e instanceof ApiError ? e.message : '응시 기록 삭제 중 오류가 발생했습니다.');
      setDeleting(false);
    }
  }

  // 이전/다음 학생 이동을 위해 이 시험의 전체 세션 목록(번호 순)을 한 번 불러온다.
  useEffect(() => {
    api.get<ExamResultsData>(`/exams/${examId}/results`).then(setResultsData);
  }, [examId]);

  const orderedSessions = (resultsData?.sessions ?? []).filter((s) => s.session_id != null);
  const currentIndex = orderedSessions.findIndex((s) => s.session_id === sid);
  const prevSession = currentIndex > 0 ? orderedSessions[currentIndex - 1] : null;
  const nextSession =
    currentIndex >= 0 && currentIndex < orderedSessions.length - 1 ? orderedSessions[currentIndex + 1] : null;

  if (!detail) return <div className="p-10 text-sm text-ink-soft">불러오는 중...</div>;

  const meta = statusMeta(detail.session.status, detail.session.disqualify_reason);
  const finished = detail.session.status === 'submitted' || detail.session.status === 'force_submitted';

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <button
        className="text-xs font-bold text-ink-soft transition-colors duration-150 hover:text-accent"
        onClick={() => navigate(-1)}
      >
        ← 뒤로
      </button>

      <div className="animate-fade-in-up mt-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-ink">
              {detail.student?.roll_number}번 {detail.student?.name || ''}
            </h1>
            <Badge tone={meta.tone}>{meta.label}</Badge>
          </div>
          {exam && <p className="mt-1 truncate text-sm text-ink-soft">{exam.title}</p>}
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          {orderedSessions.length > 1 && (
            <>
            <Button
              variant="secondary"
              size="sm"
              disabled={!prevSession}
              onClick={() => prevSession && navigate(`/exams/${examId}/sessions/${prevSession.session_id}`)}
            >
              ← 이전 학생
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={!nextSession}
              onClick={() => nextSession && navigate(`/exams/${examId}/sessions/${nextSession.session_id}`)}
            >
              다음 학생 →
            </Button>
            </>
          )}
          <Button variant="danger" size="sm" disabled={deleting} onClick={removeSession}>
            {deleting ? '삭제 중...' : '응시 기록 삭제'}
          </Button>
        </div>
      </div>
      {deleteError && <p className="mt-2 text-right text-xs text-danger">{deleteError}</p>}

      {(detail.session.status === 'submitted' || detail.session.status === 'force_submitted') && (
        <Card className="animate-fade-in-up mt-5">
          <p className="text-xs font-bold text-ink-soft">최종 점수</p>
          <p className="mt-1 text-lg font-bold text-ink">
            {detail.session.score ?? 0} / {detail.session.max_score ?? 0}
          </p>
          {detail.history.some((h) => h.appeal?.status === 'pending') && (
            <p className="mt-1 text-xs font-bold text-warn">
              처리하지 않은 이의 제기가 {detail.history.filter((h) => h.appeal?.status === 'pending').length}건
              있어요 - 아래 문항에서 확인해주세요.
            </p>
          )}
        </Card>
      )}

      <div className="mt-5 flex flex-col gap-3">
        {detail.history.length === 0 ? (
          <Card>
            <p className="text-sm text-ink-soft">아직 제출한 답이 없습니다.</p>
          </Card>
        ) : (
          detail.history.map((h) => {
            const strokesOpen = openStrokesIndex === h.order_index;
            const points = strokePointCount(h.strokes);
            // 필기 없이 맞혔다 - 찍었을 수도, 암산했을 수도 있어 판단은 못 하지만 사실
            // 자체는 교사가 참고할 만하다.
            const correctWithoutWork = h.is_correct === 1 && points === 0;
            // 나름 열심히 시도한 흔적(필기)이 있는데도 틀렸다 - 부주의가 아니라 이해가
            // 부족했을 가능성이 높은 경우라, "혼낼 게 아니라 도와줘야 할" 신호로 구분한다.
            const triedHardButWrong = h.is_correct === 0 && points >= MEANINGFUL_STROKE_POINTS;
            const timeOutlier = questionOutliers.find((o) => o.order_index === h.order_index);
            // 처음 낸 답과 최종 답의 정오가 다르면 답을 고친 것이다(교사가 점수를 고친 경우는 제외).
            const changedAnswer =
              !h.graded_by_teacher && h.first_is_correct != null && h.first_is_correct !== h.is_correct
                ? h.first_is_correct
                  ? '맞은 답을 고쳐서 틀림'
                  : '틀린 답을 고쳐서 맞힘'
                : null;
            const revisited = h.visit_count >= 2;
            const classStat = resultsData?.questionStats.find((q) => q.order_index === h.order_index);
            const timeOutlierTitle =
              timeOutlier && classStat
                ? `이 학생 ${formatMs(h.time_spent_ms)} · 학급 평균 ${formatMs(classStat.avg_time_spent_ms)} · 이 문항 정답률 ${
                    classStat.answered_count > 0
                      ? Math.round((classStat.correct_count / classStat.answered_count) * 100)
                      : 0
                  }%`
                : undefined;
            return (
              <Card key={h.order_index} className="animate-fade-in-up">
                <div className="flex items-start gap-3">
                  <span
                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                      h.is_correct
                        ? 'bg-good/15 text-good'
                        : (h.awarded_points ?? 0) > 0
                          ? 'bg-warn/15 text-warn'
                          : 'bg-danger/15 text-danger'
                    }`}
                  >
                    {h.order_index + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    {h.prompt && (!h.prompt_image_path || h.show_prompt_text) && (
                      <p className="whitespace-pre-wrap text-sm font-bold text-ink">
                        <MathText text={h.prompt} />
                      </p>
                    )}
                    {h.prompt_image_path && (
                      <img
                        src={`/uploads/${h.prompt_image_path}`}
                        alt="문항 이미지"
                        className={`max-w-full rounded-lg border border-line ${h.show_prompt_text && h.prompt ? 'mt-2' : ''}`}
                      />
                    )}

                    {(correctWithoutWork || triedHardButWrong || timeOutlier || changedAnswer || revisited) && (
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {correctWithoutWork && (
                          <Badge tone="neutral" title="필기 기록이 없습니다 - 암산했거나 찍었을 수 있습니다.">
                            필기 없이 정답
                          </Badge>
                        )}
                        {triedHardButWrong && (
                          <Badge tone="warn" title={`필기 포인트 ${points}개 - 시도한 흔적은 있지만 오답입니다.`}>
                            필기 흔적 있는데 오답
                          </Badge>
                        )}
                        {timeOutlier && (
                          <Badge tone="warn" title={timeOutlierTitle}>
                            {timeOutlier.outlierReason}
                          </Badge>
                        )}
                        {changedAnswer && (
                          <Badge tone={h.is_correct ? 'good' : 'warn'} title="처음 낸 답의 정오와 최종 답의 정오가 다릅니다.">
                            {changedAnswer}
                          </Badge>
                        )}
                        {revisited && (
                          <Badge tone="neutral" title="시험 중 이 문항을 다시 열어본 횟수입니다. 풀이 시간은 머문 시간을 모두 더한 값입니다.">
                            {h.visit_count}번 열어봄
                          </Badge>
                        )}
                      </div>
                    )}

                    {h.choices.length > 0 && (
                      <div className="mt-2 flex flex-col gap-1.5">
                        {h.choices.map((c) => {
                          const wasSelected = h.selected_choice_ids.includes(c.id);
                          return (
                            <div
                              key={c.id}
                              className={`flex items-center justify-between rounded-lg border px-2.5 py-1.5 text-xs ${
                                c.is_correct
                                  ? 'border-good/40 bg-good/10 text-good'
                                  : wasSelected
                                    ? 'border-danger/40 bg-danger/10 text-danger'
                                    : 'border-line bg-bg text-ink-soft'
                              }`}
                            >
                              <span>
                                <MathText text={c.text} />
                              </span>
                              <span className="flex shrink-0 items-center gap-1.5 text-[10px] font-bold">
                                {c.is_correct && <span>정답</span>}
                                {wasSelected && <span>선택함</span>}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {h.type === 'short' && (
                      <ShortAnswerGrading
                        key={`${h.question_id}-${h.awarded_points}`}
                        examId={examId}
                        sessionId={sid}
                        item={h}
                        editable={finished}
                        onSaved={reloadAfterGrade}
                      />
                    )}
                    {h.appeal && (
                      <AppealReview examId={examId} sessionId={sid} appeal={h.appeal} item={h} onChanged={reloadAfterGrade} />
                    )}

                    <div className="mt-2 flex items-center gap-3 text-[11px] text-ink-soft">
                      <span>{formatMs(h.time_spent_ms)}</span>
                      {h.strokes && (
                        <button
                          type="button"
                          className="font-bold text-accent hover:underline"
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
                </div>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}
