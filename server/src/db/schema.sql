PRAGMA foreign_keys = ON;
-- journal_mode=DELETE (WAL 대신): DB 파일이 OneDrive 동기화 폴더 안에 있어
-- 보조 파일(-wal, -shm) 수를 최소화해 동기화 충돌 위험을 줄인다.

CREATE TABLE IF NOT EXISTS exams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  grade_cluster TEXT NOT NULL,
  time_limit_sec INTEGER NOT NULL,
  -- online: 학생이 화면에서 문제를 읽고 풂 / paper_marking: 학생은 종이 시험지를 보고 이 앱에는 답만 마킹
  mode TEXT NOT NULL DEFAULT 'online' CHECK(mode IN ('online','paper_marking')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','finalized','archived')),
  -- 숨기기(archived) 직전의 상태를 기억해둔다 - "다시 보이기"를 눌렀을 때 draft였던
  -- 시험이 finalized로 잘못 복원되는(또는 반대) 일이 없도록 원래 상태로 되돌리기 위함.
  archived_from_status TEXT,
  -- 제목은 자유롭게 두되, 쌓인 시험지 중에서 알아보기 위한 짧은 메모(교사만 봄,
  -- 학생에게는 노출 안 됨). 관리 화면에서만 채워 넣는다.
  memo TEXT,
  started_at TEXT,
  -- 교사가 감독 화면에서 "시험 전체 종료"를 눌러 실제로 끝낸 시각. "시험 재시작"을
  -- 누르면 다시 NULL로 돌아간다 - 감독 화면이 대기중/감독중/종료됨을 구분하는 기준.
  ends_at TEXT,
  -- 학생 신규 입장 허용 여부. 시험 시작 시 자동으로 닫히며 교사가 감독 화면에서
  -- 시작 전에 먼저 닫거나, 필요한 경우 다시 열 수 있다.
  admission_closed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  exam_id INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  order_index INTEGER NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('mc','short')),
  prompt TEXT NOT NULL,
  -- AI 추출 시 원본 이미지에서 이 문항 발문 영역만 잘라낸 이미지 (uploads 기준 상대 경로).
  -- 수식/도형/선긋기처럼 텍스트로 옮기면 깨지기 쉬운 내용을 원본 그대로 보여주기 위함.
  prompt_image_path TEXT,
  points REAL NOT NULL DEFAULT 1,
  correct_short_answers TEXT,
  ai_suggested INTEGER NOT NULL DEFAULT 0,
  -- AI가 이 문항에 제안한 성취기준 후보 전체(2~3개, confidence/rationale 포함)를 JSON
  -- 배열로 담아둔다. 실제로 태그된 성취기준(question_standards)은 그중 1순위만 자동
  -- 적용되고, 나머지 후보는 교사가 판단을 검토할 수 있도록 보여주기 위한 참고용이다.
  ai_standard_candidates TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_questions_exam ON questions(exam_id);

CREATE TABLE IF NOT EXISTS choices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  order_index INTEGER NOT NULL,
  text TEXT NOT NULL,
  is_correct INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_choices_question ON choices(question_id);

CREATE TABLE IF NOT EXISTS question_standards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  standard_code TEXT NOT NULL,
  statement_snapshot TEXT,
  is_ai_suggested INTEGER NOT NULL DEFAULT 0,
  confidence TEXT,
  UNIQUE(question_id, standard_code)
);
CREATE INDEX IF NOT EXISTS idx_qstd_code ON question_standards(standard_code);

CREATE TABLE IF NOT EXISTS roster (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  roll_number INTEGER NOT NULL UNIQUE,
  name TEXT
);

CREATE TABLE IF NOT EXISTS exam_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  exam_id INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  roll_number INTEGER NOT NULL,
  -- 학생용 화면(로그인 없음)이 자기 세션을 가리킬 때는 이 id(순차 정수라 추측하기 쉬움)
  -- 대신 이 무작위 토큰을 쓴다 - 참여할 때 한 번만 발급해서 그 학생 응답에만 실어 보낸다.
  -- 교사용 화면(로그인 필요)은 그대로 id를 쓴다.
  access_token TEXT,
  status TEXT NOT NULL DEFAULT 'joined'
         CHECK(status IN ('joined','in_progress','submitted','force_submitted','disqualified')),
  socket_id TEXT,
  started_at TEXT,
  submitted_at TEXT,
  warning_count INTEGER NOT NULL DEFAULT 0,
  extra_time_sec INTEGER NOT NULL DEFAULT 0,
  score REAL,
  max_score REAL,
  current_question_index INTEGER NOT NULL DEFAULT 0,
  -- 같은 출석번호로 이미 참여/응시 중인 세션에 다른 기기가 또 참여하려 하면 기본적으로
  -- 막는다(둘이 동시에 같은 세션을 건드리면 답 제출/이탈 경고가 뒤섞인다). 원래 쓰던
  -- 기기가 고장나서 다른 기기로 이어가야 하는 등 정당한 상황엔, 교사가 "실시간 감독"에서
  -- 재참여를 허용해줘야 하고, 그러면 다음 참여 시도 한 번만 통과시키고 다시 0으로 돌아간다.
  allow_rejoin INTEGER NOT NULL DEFAULT 0,
  -- force_submitted 상태가 왜 됐는지: 'teacher_manual'(교사가 직접/전체 종료),
  -- 'screen_leave'(화면 이탈 감지로 즉시 종료), NULL(시간 초과로 인한 일반 submitted).
  -- 학생 화면과 감독 화면에서 사유를 구분해서 보여주는 데 쓴다.
  disqualify_reason TEXT,
  UNIQUE(exam_id, roll_number)
);
CREATE INDEX IF NOT EXISTS idx_sessions_exam ON exam_sessions(exam_id);
-- access_token 유니크 인덱스는 여기 두지 않는다: 이미 만들어진(access_token 컬럼이 없는)
-- 기존 DB에서는 이 CREATE TABLE이 IF NOT EXISTS라 그냥 통과되고, 컬럼이 없는 채로 바로 이
-- 인덱스 생성문이 실행되면 "no such column" 에러로 서버가 아예 못 뜬다. db/index.js가
-- ALTER TABLE로 컬럼을 채워 넣은 "다음"에 인덱스를 만들도록 순서를 맞춰 거기서만 만든다.

CREATE TABLE IF NOT EXISTS answers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES exam_sessions(id) ON DELETE CASCADE,
  question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  selected_choice_id INTEGER REFERENCES choices(id),
  short_answer_text TEXT,
  shown_at TEXT NOT NULL,
  answered_at TEXT,
  time_spent_ms INTEGER,
  is_correct INTEGER,
  awarded_points REAL,
  -- 이 문항을 풀 때 남긴 필기(S-Pen/손가락) 원본 - 획 좌표 배열을 JSON으로 그대로 저장한다.
  -- 답만으론 안 보이는 풀이 과정(시도했는지, 어디서 막혔는지)을 나중에 리포트에서 다시
  -- 그려볼 수 있게 하기 위함. 필기가 없으면 NULL.
  strokes_json TEXT,
  UNIQUE(session_id, question_id)
);
CREATE INDEX IF NOT EXISTS idx_answers_session ON answers(session_id);
CREATE INDEX IF NOT EXISTS idx_answers_question ON answers(question_id);

CREATE TABLE IF NOT EXISTS warning_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES exam_sessions(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK(type IN ('visibility_hidden','window_blur')),
  occurred_at TEXT NOT NULL,
  counted INTEGER NOT NULL,
  resulting_warning_count INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_warnings_session ON warning_events(session_id);
