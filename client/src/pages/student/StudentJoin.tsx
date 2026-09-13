import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../../api/client';
import type { Exam, ExamSession } from '../../types';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { Badge } from '../../components/Badge';

const ROLL_KEY = 'omr_student_roll';

export function StudentJoin() {
  const navigate = useNavigate();
  const [rollNumber, setRollNumber] = useState(() => localStorage.getItem(ROLL_KEY) ?? '');
  const [confirmed, setConfirmed] = useState(false);
  const [exams, setExams] = useState<Exam[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [joiningId, setJoiningId] = useState<number | null>(null);

  useEffect(() => {
    if (confirmed) {
      api.get<Exam[]>('/exams').then((list) => setExams(list.filter((e) => e.status === 'finalized')));
    }
  }, [confirmed]);

  async function join(examId: number) {
    setError(null);
    setJoiningId(examId);
    try {
      const session = await api.post<ExamSession>(`/exams/${examId}/sessions`, {
        roll_number: Number(rollNumber),
      });
      localStorage.setItem(`omr_session_${examId}`, String(session.id));
      navigate(`/student/exam/${examId}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '참여 중 오류가 발생했습니다.');
    } finally {
      setJoiningId(null);
    }
  }

  if (!confirmed) {
    return (
      <div className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6">
        <h1 className="text-xl font-bold text-ink">시험 응시</h1>
        <p className="mt-1 text-sm text-ink-soft">출석번호를 입력해주세요.</p>
        <Card className="mt-6">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-bold text-ink-soft">출석번호</span>
            <input
              type="number"
              min={1}
              autoFocus
              className="rounded-xl border border-line bg-bg px-3 py-2 text-sm text-ink outline-none focus:border-accent"
              placeholder="예: 7"
              value={rollNumber}
              onChange={(e) => setRollNumber(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && rollNumber && setConfirmed(true)}
            />
          </label>
          <Button
            className="mt-4 w-full"
            disabled={!rollNumber}
            onClick={() => {
              localStorage.setItem(ROLL_KEY, rollNumber);
              setConfirmed(true);
            }}
          >
            확인
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-sm px-6 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-ink">{rollNumber}번 학생</h1>
        <button className="text-xs font-bold text-ink-soft" onClick={() => setConfirmed(false)}>
          번호 변경
        </button>
      </div>
      <p className="mt-1 text-sm text-ink-soft">응시할 시험을 선택하세요.</p>

      <div className="mt-6 flex flex-col gap-2">
        {exams.length === 0 && <p className="text-sm text-ink-soft">현재 응시할 수 있는 시험이 없습니다.</p>}
        {exams.map((exam) => (
          <Card key={exam.id} className="flex items-center justify-between">
            <div>
              <p className="text-sm font-bold text-ink">{exam.title}</p>
              <p className="mt-0.5 text-xs text-ink-soft">{Math.round(exam.time_limit_sec / 60)}분</p>
            </div>
            <Button disabled={joiningId === exam.id} onClick={() => join(exam.id)}>
              참여하기
            </Button>
          </Card>
        ))}
      </div>
      {error && (
        <p className="mt-3">
          <Badge tone="danger">{error}</Badge>
        </p>
      )}
    </div>
  );
}
