import { db } from '../src/db/index.js';

const DEMO_TITLE = '[예시] 결과 분석 기능 체험';
const DEMO_MEMO = 'ScoreLab 분석 UI 확인용 자동 생성 데이터';
const replace = process.argv.includes('--replace');

const existing = db.prepare('SELECT id FROM exams WHERE title = ? AND memo = ?').get(DEMO_TITLE, DEMO_MEMO);
if (existing && !replace) {
  console.log(`이미 예시 시험이 있습니다. 시험 ID: ${existing.id}`);
  console.log(`결과 화면: http://localhost:4000/exams/${existing.id}/results`);
  process.exit(0);
}

const questions = [
  { prompt: '글의 중심 생각을 가장 잘 나타낸 것을 고르세요.', correctStudents: [0,1,2,3,4,5,6,7,8,9] },
  { prompt: '인물의 마음을 알 수 있는 근거로 알맞은 것을 고르세요.', correctStudents: [0,1,2,3,4,5,6,7,8,9] },
  { prompt: '두 자료의 공통점과 차이점을 바르게 설명한 것을 고르세요.', correctStudents: [0,10] },
  { prompt: '글쓴이의 주장에 가장 알맞은 근거를 고르세요.', correctStudents: [0,2,11] },
  { prompt: '문단의 순서를 글의 흐름에 맞게 배열한 것을 고르세요.', correctStudents: [0,1,2,3,4,5,6,7,8,9,10,11] },
  { prompt: '자료를 활용한 발표 방법으로 가장 적절한 것을 고르세요.', correctStudents: [0,1,2,3,4,5,6,7,8,9] },
  { prompt: '밑줄 친 표현의 효과에 대한 설명으로 알맞은 것을 고르세요.', correctStudents: [0,2,4,6,8,10] },
  { prompt: '이 글을 읽고 새롭게 알게 된 내용으로 알맞은 것을 고르세요.', correctStudents: [0,1,2,3,4,5,6,7,8,9] },
];

const choiceTexts = [
  ['세부 내용만 나열한다.', '글 전체를 아우르는 생각이다.', '등장인물의 이름이다.', '글에 없는 새로운 사실이다.'],
  ['행동과 말을 근거로 판단한다.', '제목의 글자 수로 판단한다.', '문단 수만 세어 판단한다.', '삽화의 색만 보고 판단한다.'],
  ['두 자료는 목적과 형식이 모두 같다.', '공통점은 있지만 제시 방식은 다르다.', '첫 번째 자료에만 정보가 있다.', '두 자료 모두 근거가 전혀 없다.'],
  ['개인의 느낌만 제시한다.', '주장과 관련된 조사 결과를 제시한다.', '주제와 관계없는 일화를 제시한다.', '같은 주장을 반복해서 쓴다.'],
  ['결론-본론-서론', '서론-본론-결론', '본론-결론-서론', '문단 순서는 중요하지 않다.'],
  ['출처를 밝히고 핵심 자료를 선별한다.', '자료를 가능한 한 많이 넣는다.', '작은 글씨로 내용을 모두 적는다.', '발표 내용과 무관한 영상을 사용한다.'],
  ['내용을 구체적이고 생생하게 전달한다.', '문장의 뜻을 항상 반대로 만든다.', '글의 주제를 없애는 역할을 한다.', '맞춤법을 대신 검사한다.'],
  ['자료를 비교하면 관점의 차이를 알 수 있다.', '모든 자료는 같은 형식으로 제시된다.', '제목만 읽으면 세부 내용을 모두 알 수 있다.', '근거 없이도 주장은 타당하다.'],
];

const correctChoiceIndexes = [1, 0, 1, 1, 1, 0, 0, 0];
const normalOffsets = [-4000, -3000, -2000, -1000, 0, 1000, 2000, 3000, 4000];
const variableTimes = [5000, 10000, 15000, 20000, 25000, 100000, 110000, 115000, 120000];

function timeFor(studentIndex, questionIndex) {
  if (studentIndex === 0) return 180000; // 정확하지만 전체적으로 오래 풂
  if (studentIndex === 10) return 240000; // 오래 풀었지만 오답이 많음
  if (studentIndex === 11) return 2000; // 빠르게 풀고 오답이 많음
  const typicalIndex = studentIndex - 1;
  if (questionIndex === 5) return variableTimes[typicalIndex];
  const bases = [20000, 30000, 300000, 8000, 250000, 30000, 30000, 30000];
  return Math.max(1000, bases[questionIndex] + normalOffsets[typicalIndex]);
}

function sampleStrokes(seed) {
  const points = Array.from({ length: 36 }, (_, i) => ({
    x: 80 + i * 12,
    y: 180 + Math.sin((i + seed) / 3) * 35,
    pressure: 0.55,
  }));
  return JSON.stringify({
    width: 1000,
    height: 600,
    strokes: [{ tool: 'pen', color: '#1d4ed8', baseWidth: 3, startedAt: Date.now(), points }],
  });
}

db.exec('BEGIN IMMEDIATE');
try {
  if (existing && replace) db.prepare('DELETE FROM exams WHERE id = ?').run(existing.id);

  const now = new Date();
  const startedAt = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
  const endedAt = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  const examResult = db.prepare(
    `INSERT INTO exams
       (title, subject_id, grade_cluster, time_limit_sec, mode, status, memo, started_at, ends_at,
        admission_closed, created_at, updated_at)
     VALUES (?, 'KR', 'elem_5_6', 2400, 'online', 'finalized', ?, ?, ?, 1, ?, ?)`,
  ).run(DEMO_TITLE, DEMO_MEMO, startedAt, endedAt, startedAt, endedAt);
  const examId = Number(examResult.lastInsertRowid);

  const insertQuestion = db.prepare(
    `INSERT INTO questions
       (exam_id, order_index, type, prompt, points, created_at, updated_at)
     VALUES (?, ?, 'mc', ?, 1, ?, ?)`,
  );
  const insertChoice = db.prepare(
    'INSERT INTO choices (question_id, order_index, text, is_correct) VALUES (?, ?, ?, ?)',
  );
  const insertStandard = db.prepare(
    `INSERT INTO question_standards
       (question_id, standard_code, statement_snapshot, is_ai_suggested, confidence)
     VALUES (?, '6국02-01', '글의 구조를 고려하며 주제나 주장을 파악하고 글 내용을 요약한다.', 0, NULL)`,
  );

  const questionRows = questions.map((question, questionIndex) => {
    const questionId = Number(insertQuestion.run(examId, questionIndex, question.prompt, startedAt, startedAt).lastInsertRowid);
    const choiceIds = choiceTexts[questionIndex].map((text, choiceIndex) => Number(
      insertChoice.run(questionId, choiceIndex, text, choiceIndex === correctChoiceIndexes[questionIndex] ? 1 : 0).lastInsertRowid,
    ));
    insertStandard.run(questionId);
    return { questionId, choiceIds };
  });

  const insertRoster = db.prepare('INSERT OR IGNORE INTO roster (roll_number, name) VALUES (?, ?)');
  const insertSession = db.prepare(
    `INSERT INTO exam_sessions
       (exam_id, roll_number, status, started_at, submitted_at, score, max_score, current_question_index)
     VALUES (?, ?, 'submitted', ?, ?, ?, 8, 7)`,
  );
  const insertAnswer = db.prepare(
    `INSERT INTO answers
       (session_id, question_id, selected_choice_id, shown_at, answered_at, time_spent_ms,
        is_correct, awarded_points, strokes_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  for (let studentIndex = 0; studentIndex < 12; studentIndex += 1) {
    const rollNumber = 9001 + studentIndex;
    insertRoster.run(rollNumber, `예시학생 ${studentIndex + 1}`);
    const correctness = questions.map((question) => question.correctStudents.includes(studentIndex));
    const score = correctness.filter(Boolean).length;
    const totalTime = questions.reduce((sum, _question, questionIndex) => sum + timeFor(studentIndex, questionIndex), 0);
    const submittedAt = new Date(new Date(startedAt).getTime() + totalTime).toISOString();
    const sessionId = Number(insertSession.run(examId, rollNumber, startedAt, submittedAt, score).lastInsertRowid);

    questionRows.forEach(({ questionId, choiceIds }, questionIndex) => {
      const isCorrect = correctness[questionIndex];
      const correctChoiceIndex = correctChoiceIndexes[questionIndex];
      const wrongChoiceIndex = questionIndex === 3
        ? 0
        : [0, 1, 2, 3].find((index) => index !== correctChoiceIndex && index === studentIndex % 4)
          ?? [0, 1, 2, 3].find((index) => index !== correctChoiceIndex);
      const selectedChoiceId = choiceIds[isCorrect ? correctChoiceIndex : wrongChoiceIndex];
      const timeSpentMs = timeFor(studentIndex, questionIndex);
      const shownAt = new Date(new Date(startedAt).getTime() + questionIndex * 60000).toISOString();
      const answeredAt = new Date(new Date(shownAt).getTime() + timeSpentMs).toISOString();
      const strokes = !isCorrect && (studentIndex === 10 || questionIndex === 2)
        ? sampleStrokes(studentIndex + questionIndex)
        : null;
      insertAnswer.run(
        sessionId,
        questionId,
        selectedChoiceId,
        shownAt,
        answeredAt,
        timeSpentMs,
        isCorrect ? 1 : 0,
        isCorrect ? 1 : 0,
        strokes,
      );
    });
  }

  db.exec('COMMIT');
  console.log(`예시 시험을 만들었습니다. 시험 ID: ${examId}`);
  console.log(`결과 화면: http://localhost:4000/exams/${examId}/results`);
} catch (error) {
  db.exec('ROLLBACK');
  throw error;
}
