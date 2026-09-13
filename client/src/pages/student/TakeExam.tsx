import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api/client';
import type { CurrentQuestionResponse, ExamSession, PublicExam, WarningResponse } from '../../types';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { Badge } from '../../components/Badge';

function formatTime(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function TakeExam() {
  const { examId } = useParams();
  const navigate = useNavigate();
  const id = Number(examId);
  const sessionId = Number(localStorage.getItem(`omr_session_${id}`));

  const [exam, setExam] = useState<PublicExam | null>(null);
  const [session, setSession] = useState<ExamSession | null>(null);
  const [current, setCurrent] = useState<CurrentQuestionResponse | null>(null);
  const [selectedChoice, setSelectedChoice] = useState<number | null>(null);
  const [shortAnswer, setShortAnswer] = useState('');
  const [remainingSec, setRemainingSec] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const reloadSession = useCallback(async () => {
    const s = await api.get<ExamSession>(`/exams/${id}/sessions/${sessionId}`);
    setSession(s);
    return s;
  }, [id, sessionId]);

  const loadCurrentQuestion = useCallback(async () => {
    const c = await api.get<CurrentQuestionResponse>(`/exams/${id}/sessions/${sessionId}/current-question`);
    if (c.done) {
      await reloadSession();
      setCurrent(null);
      return;
    }
    setCurrent(c);
    setSelectedChoice(null);
    setShortAnswer('');
  }, [id, sessionId, reloadSession]);

  useEffect(() => {
    if (!Number.isInteger(sessionId)) {
      navigate('/student');
      return;
    }
    api.get<PublicExam>(`/exams/${id}/for-student`).then(setExam);
    reloadSession();
  }, [id, sessionId, navigate, reloadSession]);

  useEffect(() => {
    if (session?.status === 'in_progress' && !current) {
      loadCurrentQuestion();
    }
  }, [session, current, loadCurrentQuestion]);

  // 카운트다운
  useEffect(() => {
    if (session?.status !== 'in_progress' || !session.started_at || !exam) return;
    const deadline = new Date(session.started_at).getTime() + exam.time_limit_sec * 1000;

    const tick = () => {
      const left = Math.max(0, Math.round((deadline - Date.now()) / 1000));
      setRemainingSec(left);
      if (left <= 0) {
        api.post(`/exams/${id}/sessions/${sessionId}/submit`).then(reloadSession);
      }
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [session, exam, id, sessionId, reloadSession]);

  // 응시 중 다른 화면으로 이탈하면(탭 전환, 창 최소화 등) 서버에 기록하고 학생에게도
  // 즉시 경고 팝업을 띄운다. 정해진 횟수(기본 3회)를 넘기면 서버가 시험을 강제 제출
  // 처리하므로, 그 결과를 받아 화면도 바로 종료 상태로 전환한다.
  useEffect(() => {
    if (session?.status !== 'in_progress') return;

    async function report(type: 'visibility_hidden' | 'window_blur') {
      try {
        const res = await api.post<WarningResponse>(`/exams/${id}/sessions/${sessionId}/warning`, { type });
        if (!res.counted) return;
        if (res.disqualified) {
          alert(`화면 이탈이 ${res.warning_count}회 감지되어 시험이 강제 종료되었습니다.`);
          await reloadSession();
          setCurrent(null);
        } else {
          const remaining = res.max_warnings - res.warning_count;
          alert(
            `다른 화면으로 이동한 것이 감지되었습니다. (${res.warning_count}/${res.max_warnings}회)\n${remaining}회 더 감지되면 시험이 강제 종료됩니다.`,
          );
        }
      } catch {
        // 네트워크 오류 등은 무시 - 경고 기록은 부가 기능이라 시험 진행을 막지 않는다.
      }
    }
    function onVisibilityChange() {
      if (document.hidden) report('visibility_hidden');
    }
    function onBlur() {
      report('window_blur');
    }

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('blur', onBlur);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('blur', onBlur);
    };
  }, [session?.status, id, sessionId, reloadSession]);

  async function start() {
    const s = await api.post<ExamSession>(`/exams/${id}/sessions/${sessionId}/start`);
    setSession(s);
  }

  async function submitAnswer() {
    if (!current?.question) return;
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = { question_id: current.question.id };
      if (current.question.type === 'mc') body.selected_choice_id = selectedChoice;
      else body.short_answer_text = shortAnswer;

      const result = await api.post<{ done: boolean; timedOut?: boolean }>(
        `/exams/${id}/sessions/${sessionId}/answers`,
        body,
      );
      if (result.done) {
        await reloadSession();
        setCurrent(null);
      } else {
        await loadCurrentQuestion();
      }
    } catch {
      // 응답 전송 도중 화면 이탈 경고 누적으로 강제 종료됐을 수 있다 - 최신 세션
      // 상태를 다시 불러와 종료 화면으로 전환한다.
      await reloadSession();
      setCurrent(null);
    } finally {
      setSubmitting(false);
    }
  }

  if (!session || !exam) {
    return <div className="p-10 text-sm text-ink-soft">불러오는 중...</div>;
  }

  if (session.status === 'joined') {
    return (
      <div className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6">
        <h1 className="text-xl font-bold text-ink">{exam.title}</h1>
        <p className="mt-2 text-sm text-ink-soft">
          제한시간 {Math.round(exam.time_limit_sec / 60)}분 · 총 {exam.question_count}문항
        </p>
        <p className="mt-1 text-sm text-ink-soft">시작하면 바로 첫 문항이 표시됩니다.</p>
        <Button className="mt-6 w-full" onClick={start}>
          시작하기
        </Button>
      </div>
    );
  }

  if (session.status === 'submitted' || session.status === 'force_submitted') {
    const pct =
      session.max_score && session.max_score > 0
        ? Math.round(((session.score ?? 0) / session.max_score) * 100)
        : 0;
    return (
      <div className="mx-auto max-w-sm px-6 py-10">
        <h1 className="text-xl font-bold text-ink">
          {session.status === 'force_submitted' ? '시험이 강제 종료되었습니다' : '제출 완료'}
        </h1>
        {session.status === 'force_submitted' && (
          <p className="mt-1 text-sm text-ink-soft">화면 이탈이 반복되어 자동으로 제출되었습니다.</p>
        )}
        <Card className="mt-4">
          <p className="text-xs font-bold text-ink-soft">점수</p>
          <p className="mt-1 text-2xl font-bold text-ink">
            {session.score} / {session.max_score}
          </p>
          <p className="mt-1 text-sm text-ink-soft">정답률 {pct}%</p>
        </Card>
        <div className="mt-4 flex flex-wrap gap-2">
          {(session.answers ?? []).map((a) => (
            <span
              key={a.order_index}
              className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold ${
                a.is_correct ? 'bg-good/15 text-good' : 'bg-danger/15 text-danger'
              }`}
            >
              {a.order_index + 1}
            </span>
          ))}
        </div>
      </div>
    );
  }

  // in_progress
  if (!current?.question) {
    return <div className="p-10 text-sm text-ink-soft">다음 문항을 불러오는 중...</div>;
  }
  const q = current.question;

  return (
    <div className="mx-auto max-w-sm px-6 py-8">
      <div className="flex items-center justify-between">
        <Badge tone="neutral">
          {(current.index ?? 0) + 1} / {current.total}
        </Badge>
        {remainingSec !== null && (
          <Badge tone={remainingSec <= 30 ? 'danger' : 'neutral'}>{formatTime(remainingSec)}</Badge>
        )}
      </div>

      {q.prompt && <p className="mt-4 whitespace-pre-wrap text-base font-bold text-ink">{q.prompt}</p>}
      {!q.prompt && (
        <p className="mt-4 text-sm text-ink-soft">종이 시험지의 {(current.index ?? 0) + 1}번 문항을 마킹하세요.</p>
      )}

      {q.type === 'mc' ? (
        <div className="mt-4 flex flex-col gap-2">
          {q.choices.map((c) => (
            <button
              key={c.id}
              className={`rounded-xl border px-3 py-2.5 text-left text-sm ${
                selectedChoice === c.id
                  ? 'border-accent bg-accent-soft text-accent-ink'
                  : 'border-line bg-panel text-ink'
              }`}
              onClick={() => setSelectedChoice(c.id)}
            >
              {c.text}
            </button>
          ))}
        </div>
      ) : (
        <input
          className="mt-4 w-full rounded-xl border border-line bg-panel px-3 py-2.5 text-sm text-ink outline-none focus:border-accent"
          placeholder="정답 입력"
          value={shortAnswer}
          onChange={(e) => setShortAnswer(e.target.value)}
          autoFocus
        />
      )}

      <Button
        className="mt-6 w-full"
        disabled={submitting || (q.type === 'mc' ? selectedChoice === null : !shortAnswer.trim())}
        onClick={submitAnswer}
      >
        {(current.index ?? 0) + 1 >= (current.total ?? 0) ? '제출하기' : '다음'}
      </Button>
    </div>
  );
}
