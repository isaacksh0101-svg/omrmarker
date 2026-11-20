import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api/client';
import { formatPoints } from '../../lib/keywordGrading';

interface SheetQuestion {
  question_id: number;
  order_index: number;
  type: 'mc' | 'short';
  essay: boolean;
  points: number;
  full_credit: boolean;
  correct_label: string;
}

interface SheetAnswer {
  answer_label: string;
  answered: boolean;
  is_correct: boolean;
  awarded_points: number;
  pending: boolean;
}

interface SheetStudent {
  session_id: number;
  roll_number: number;
  name: string | null;
  score: number | null;
  max_score: number | null;
  pending_confirms: number;
  result_signed_at: string | null;
  answers: Record<number, SheetAnswer>;
}

interface SheetsData {
  exam: { id: number; title: string; date: string | null };
  questions: SheetQuestion[];
  students: SheetStudent[];
}

function resultLabel(q: SheetQuestion, a: SheetAnswer | undefined) {
  if (q.full_credit) return 'O (전원 정답)';
  if (!a || !a.answered) return '무응답';
  if (a.pending) return '확인 중';
  if (a.is_correct) return 'O';
  if (a.awarded_points > 0) return '부분';
  return 'X';
}

function formatDate(iso: string | null) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}.`;
}

// 수행평가 결과 확인용 개인 결과지. 학생 한 명당 한 장(또는 자르는 선으로 이어서) 출력해 나눠 주고
// 확인 서명을 받는다. 다른 학생 점수가 보이지 않도록 한 사람씩 따로 만든다. 브라우저 인쇄로
// 출력하거나 PDF로 저장한다.
export function ResultSheets() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<SheetsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCorrect, setShowCorrect] = useState(false);
  const [showName, setShowName] = useState(false);
  const [onePerPage, setOnePerPage] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  useEffect(() => {
    api
      .get<SheetsData>(`/exams/${id}/result-sheets`)
      .then((result) => {
        setData(result);
        setSelected(new Set(result.students.map((s) => s.session_id)));
      })
      .catch((e) => setError(e instanceof Error ? e.message : '결과를 불러오지 못했습니다.'));
  }, [id]);

  const students = useMemo(
    () => (data?.students ?? []).filter((s) => selected.has(s.session_id)),
    [data, selected],
  );
  const pendingStudents = students.filter((s) => s.pending_confirms > 0);

  if (error) return <div className="p-10 text-sm font-bold text-danger">{error}</div>;
  if (!data) return <div className="p-10 text-sm text-ink-soft">불러오는 중...</div>;

  function toggle(sessionId: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(sessionId)) next.delete(sessionId);
      else next.add(sessionId);
      return next;
    });
  }

  return (
    <div className="result-sheets min-h-screen bg-bg">
      <style>{`
        @media print {
          @page { size: A4; margin: 12mm; }
          html, body { background: #fff !important; }
          .result-sheets { background: #fff !important; }
          .no-print { display: none !important; }
          .sheet-list { padding: 0 !important; max-width: none !important; }
        }
        .sheet { break-inside: avoid; page-break-inside: avoid; }
        .sheet.page-end { break-after: page; page-break-after: always; }
      `}</style>

      <div className="no-print mx-auto max-w-3xl px-6 pt-10">
        <button className="text-xs font-bold text-ink-soft hover:text-accent" onClick={() => navigate(-1)}>
          ← 뒤로
        </button>
        <h1 className="mt-3 text-2xl font-bold text-ink">{data.exam.title} · 결과지 출력</h1>
        <p className="mt-1 text-sm text-ink-soft">
          학생 한 명씩 따로 된 결과지예요. 나눠 주고 확인 서명을 받은 뒤 회수해 학교 규정대로 보관·파기해주세요.
        </p>

        <div className="mt-5 flex flex-wrap gap-4 text-sm text-ink">
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={showCorrect} onChange={(e) => setShowCorrect(e.target.checked)} />
            정답 표시
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={showName} onChange={(e) => setShowName(e.target.checked)} />
            이름 표시
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={onePerPage} onChange={(e) => setOnePerPage(e.target.checked)} />
            한 명당 한 장
          </label>
        </div>
        {!onePerPage && (
          <p className="mt-1 text-xs text-ink-soft">한 장에 여러 명이 자르는 선으로 이어서 출력돼요. 문항이 많으면 한 장에 한 명이 될 수 있어요.</p>
        )}

        <div className="mt-5">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="font-bold text-ink">출력할 학생 {students.length}명</span>
            <button className="font-bold text-accent hover:underline" onClick={() => setSelected(new Set(data.students.map((s) => s.session_id)))}>
              전체
            </button>
            <button className="font-bold text-accent hover:underline" onClick={() => setSelected(new Set())}>
              모두 해제
            </button>
            <button
              className="font-bold text-accent hover:underline"
              onClick={() => setSelected(new Set(data.students.filter((s) => !s.result_signed_at).map((s) => s.session_id)))}
            >
              서명 안 받은 학생만
            </button>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {data.students.map((s) => (
              <button
                key={s.session_id}
                type="button"
                onClick={() => toggle(s.session_id)}
                title={s.result_signed_at ? '서명 받음' : undefined}
                className={`rounded-full px-2.5 py-1 text-xs font-bold ${
                  selected.has(s.session_id) ? 'bg-accent text-white' : 'bg-surface-container text-ink-soft'
                }`}
              >
                {s.roll_number}번{s.result_signed_at ? ' ✓' : ''}
              </button>
            ))}
          </div>
        </div>

        {pendingStudents.length > 0 && (
          <p className="mt-4 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm font-bold text-ink">
            아직 채점을 확인하지 않은 답이 있는 학생이 {pendingStudents.length}명 있어요(
            {pendingStudents.map((s) => `${s.roll_number}번`).join(', ')}). 결과 화면의 "답안 확인"에서 먼저 정해주세요.
            그대로 출력하면 "확인 중"으로 나와요.
          </p>
        )}

        <button
          className="mt-5 rounded-xl bg-accent px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50"
          disabled={students.length === 0}
          onClick={() => window.print()}
        >
          인쇄 / PDF로 저장
        </button>
        <p className="mt-6 text-xs font-bold text-ink-soft">미리보기</p>
      </div>

      <div className="sheet-list mx-auto max-w-3xl px-6 pb-16">
        {students.map((s, i) => (
          <div
            key={s.session_id}
            className={`sheet bg-white text-black ${onePerPage && i < students.length - 1 ? 'page-end' : ''} ${
              !onePerPage && i < students.length - 1 ? 'border-b-2 border-dashed border-neutral-400 pb-5 mb-5' : ''
            } pt-3`}
          >
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-base font-bold">{data.exam.title}</p>
              <p className="text-xs">{formatDate(data.exam.date)}</p>
            </div>
            <p className="mt-1 text-lg font-bold">
              {s.roll_number}번{showName && s.name ? ` ${s.name}` : ''}
            </p>
            <table className="mt-2 w-full border-collapse text-xs">
              <thead>
                <tr>
                  <th className="w-12 border border-neutral-500 px-1.5 py-1">문항</th>
                  <th className="border border-neutral-500 px-1.5 py-1">내 답</th>
                  {showCorrect && <th className="border border-neutral-500 px-1.5 py-1">정답</th>}
                  <th className="w-20 border border-neutral-500 px-1.5 py-1">결과</th>
                  <th className="w-20 border border-neutral-500 px-1.5 py-1">점수</th>
                </tr>
              </thead>
              <tbody>
                {data.questions.map((q) => {
                  const a = s.answers[q.question_id];
                  return (
                    <tr key={q.question_id}>
                      <td className="border border-neutral-500 px-1.5 py-1 text-center">{q.order_index + 1}</td>
                      <td className="whitespace-pre-wrap break-words border border-neutral-500 px-1.5 py-1">
                        {a?.answered ? a.answer_label || '(빈 답)' : ''}
                      </td>
                      {showCorrect && (
                        <td className="whitespace-pre-wrap break-words border border-neutral-500 px-1.5 py-1">
                          {q.essay ? '(서술형)' : q.correct_label}
                        </td>
                      )}
                      <td className="border border-neutral-500 px-1.5 py-1 text-center">{resultLabel(q, a)}</td>
                      <td className="border border-neutral-500 px-1.5 py-1 text-center">
                        {formatPoints(q.full_credit ? q.points : (a?.awarded_points ?? 0))} / {formatPoints(q.points)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
              <p className="text-sm font-bold">
                총점 {formatPoints(s.score ?? 0)} / {formatPoints(s.max_score ?? 0)}
              </p>
              <p className="text-sm">
                위 결과를 확인했습니다. &nbsp; 학생 서명: <span className="inline-block w-32 border-b border-black" />
              </p>
            </div>
          </div>
        ))}
        {students.length === 0 && <p className="no-print text-sm text-ink-soft">출력할 학생을 골라주세요.</p>}
      </div>
    </div>
  );
}
