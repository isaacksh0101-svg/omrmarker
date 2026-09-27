import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../../api/client';
import type { ExamSession } from '../../types';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';

const ROLL_KEY = 'omr_student_roll';

interface LocalReview {
  exam_id: number;
  exam_title: string;
  status: 'assigned' | 'in_progress' | 'completed';
  total: number;
  answered: number;
  correct: number;
}

export function StudentJoin() {
  const navigate = useNavigate();
  const [rollNumber, setRollNumber] = useState(() => localStorage.getItem(ROLL_KEY) ?? '');
  const [admissionCode, setAdmissionCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const [reviews, setReviews] = useState<LocalReview[]>([]);
  const [showRecovery, setShowRecovery] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState('');
  const [recovering, setRecovering] = useState(false);

  function loadLocalReviews() {
    const sessions = Object.keys(localStorage)
      .filter((key) => key.startsWith('omr_session_'))
      .map((key) => ({ examId: Number(key.slice('omr_session_'.length)), token: localStorage.getItem(key) ?? '' }))
      .filter(({ examId, token }) => Number.isInteger(examId) && !!token);
    return Promise.all(sessions.map(({ examId, token }) =>
      api.get<LocalReview | null>(`/exams/${examId}/review/status?access_token=${encodeURIComponent(token)}`).catch(() => null),
    )).then((items) => setReviews(items.filter((item): item is LocalReview => item != null && item.status !== 'completed')));
  }

  useEffect(() => {
    loadLocalReviews();
  }, []);

  async function join() {
    if (!rollNumber || admissionCode.length !== 6) return;
    setError(null);
    setJoining(true);
    try {
      const session = await api.post<ExamSession>('/exams/join', {
        roll_number: Number(rollNumber),
        admission_code: admissionCode,
      });
      localStorage.setItem(ROLL_KEY, rollNumber);
      localStorage.setItem(`omr_session_${session.exam_id}`, session.access_token);
      navigate(`/student/exam/${session.exam_id}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '참여 중 오류가 발생했습니다.');
    } finally {
      setJoining(false);
    }
  }

  async function recoverReview() {
    if (!rollNumber || recoveryCode.length !== 6) return;
    setRecovering(true);
    setError(null);
    try {
      // 코드 하나로 재풀이 하나만 연결됐을 수도, 선생님이 "전체 한 번에 연결"로 발급한
      // 코드라 여러 개가 한꺼번에 연결됐을 수도 있다 - 항상 배열로 온다.
      const result = await api.post<{ sessions: { exam_id: number; access_token: string }[] }>('/exams/review/recover', {
        roll_number: Number(rollNumber), recovery_code: recoveryCode,
      });
      localStorage.setItem(ROLL_KEY, rollNumber);
      for (const session of result.sessions) {
        localStorage.setItem(`omr_session_${session.exam_id}`, session.access_token);
      }
      // 복구 직후 바로 재풀이 화면으로 넘기면 이 클릭이 아니라 그 뒤 navigate가 화면
      // 전환을 일으키는 셈이라, 전체화면 진입에 필요한 사용자 제스처 체인이 끊긴다.
      // 그래서 몇 개가 연결됐든 항상 "미완료 오답 재풀이" 목록에만 추가해두고, 학생이
      // 목록 항목을 직접 눌러 들어가게 한다 - 그 클릭 자체가 새 제스처가 된다.
      setShowRecovery(false);
      setRecoveryCode('');
      await loadLocalReviews();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : '오답 재풀이를 복구하지 못했습니다.');
    } finally {
      setRecovering(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-8 py-10">
      <div className="flex h-16 w-52 items-center overflow-hidden">
        <img src="/scorelab-logo.png" alt="ScoreLab" className="h-auto w-full" />
      </div>
      <h1 className="mt-3 text-2xl font-bold tracking-tight text-ink">시험 응시</h1>
      <p className="mt-1 text-sm text-ink-soft">번호와 선생님이 안내한 6자리 코드를 입력해주세요.</p>
      <Card className="mt-6 border-white/80 shadow-[0_20px_55px_rgba(20,75,160,0.12)]">
        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-bold text-ink-soft">번호</span>
            <input
              type="number"
              min={1}
              autoFocus
              className="rounded-xl border border-line bg-bg px-3 py-2 text-sm text-ink outline-none focus:border-accent"
              placeholder="예: 7"
              value={rollNumber}
              onChange={(e) => setRollNumber(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-bold text-ink-soft">시험 입장 코드</span>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              className="rounded-xl border border-line bg-bg px-3 py-2 text-center text-2xl font-black tracking-[0.35em] text-ink outline-none focus:border-accent"
              placeholder="000000"
              value={admissionCode}
              onChange={(e) => setAdmissionCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              onKeyDown={(e) => e.key === 'Enter' && join()}
            />
          </label>
        </div>
        <Button className="mt-5 w-full" disabled={!rollNumber || admissionCode.length !== 6 || joining} onClick={join}>
          {joining ? '입장 확인 중...' : '시험 참여하기'}
        </Button>
        {error && <p className="mt-3 text-sm font-bold text-danger">{error}</p>}
      </Card>
      <button type="button" className="mt-4 self-start text-xs font-bold text-accent-ink hover:underline" onClick={() => { setShowRecovery((value) => !value); setError(null); }}>
        {showRecovery ? '오답 재풀이 복구 닫기' : '오답 재풀이 복구'}
      </button>
      {showRecovery && <Card className="mt-2">
        <h2 className="text-sm font-bold text-ink">오답 재풀이 복구</h2>
        <p className="mt-1 text-xs text-ink-soft">브라우저를 초기화했다면 선생님이 학생 관리에서 발급한 일회성 코드를 입력하세요.</p>
        <div className="mt-4 flex gap-2">
          <input type="number" min={1} value={rollNumber} onChange={(event) => setRollNumber(event.target.value)} placeholder="번호" className="w-24 rounded-xl border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-accent" />
          <input inputMode="numeric" maxLength={6} value={recoveryCode} onChange={(event) => setRecoveryCode(event.target.value.replace(/\D/g, '').slice(0, 6))} onKeyDown={(event) => event.key === 'Enter' && recoverReview()} placeholder="6자리 복구 코드" className="min-w-0 flex-1 rounded-xl border border-line bg-bg px-3 py-2 text-center text-lg font-black tracking-[0.2em] outline-none focus:border-accent" />
        </div>
        <Button className="mt-3 w-full" disabled={!rollNumber || recoveryCode.length !== 6 || recovering} onClick={recoverReview}>{recovering ? '복구 중...' : '재풀이 연결하기'}</Button>
      </Card>}
      {reviews.length > 0 && <div className="mt-5">
        <h2 className="text-sm font-bold text-ink">미완료 오답 재풀이</h2>
        <div className="mt-2 flex flex-col gap-2">{reviews.map((review) => <button
          key={review.exam_id}
          type="button"
          onClick={() => navigate(`/student/exam/${review.exam_id}/review`)}
          className="flex items-center justify-between rounded-2xl border border-line bg-panel px-4 py-3 text-left shadow-sm hover:border-accent"
        >
          <span><span className="block text-sm font-bold text-ink">{review.exam_title}</span><span className="mt-0.5 block text-xs text-ink-soft">{review.answered}/{review.total}문항 진행</span></span>
          <span className="text-xs font-bold text-accent-ink">이어 풀기 →</span>
        </button>)}</div>
        <p className="mt-2 text-xs text-ink-soft">보안을 위해 실제로 시험에 응시했던 이 기기에서만 표시됩니다.</p>
      </div>}
    </div>
  );
}
