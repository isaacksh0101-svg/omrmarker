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
  started_at TEXT,
  ends_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  exam_id INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  order_index INTEGER NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('mc','short')),
  prompt TEXT NOT NULL,
  points REAL NOT NULL DEFAULT 1,
  correct_short_answers TEXT,
  ai_suggested INTEGER NOT NULL DEFAULT 0,
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
  status TEXT NOT NULL DEFAULT 'joined'
         CHECK(status IN ('joined','in_progress','submitted','force_submitted','disqualified')),
  socket_id TEXT,
  started_at TEXT,
  submitted_at TEXT,
  warning_count INTEGER NOT NULL DEFAULT 0,
  score REAL,
  max_score REAL,
  current_question_index INTEGER NOT NULL DEFAULT 0,
  UNIQUE(exam_id, roll_number)
);
CREATE INDEX IF NOT EXISTS idx_sessions_exam ON exam_sessions(exam_id);

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
