export type QuestionType = 'mc' | 'short';
export type ExamStatus = 'draft' | 'finalized' | 'archived';
export type ExamMode = 'online' | 'paper_marking';

export interface Choice {
  id: number;
  question_id: number;
  order_index: number;
  text: string;
  is_correct: boolean;
}

export interface StandardTag {
  standard_code: string;
  statement_snapshot: string | null;
  is_ai_suggested: boolean;
  confidence: string | null;
}

export interface Question {
  id: number;
  exam_id: number;
  order_index: number;
  type: QuestionType;
  prompt: string;
  points: number;
  correct_short_answers: string[] | null;
  ai_suggested: boolean;
  choices: Choice[];
  standards: StandardTag[];
}

export interface Exam {
  id: number;
  title: string;
  subject_id: string;
  grade_cluster: string;
  time_limit_sec: number;
  mode: ExamMode;
  status: ExamStatus;
  started_at: string | null;
  ends_at: string | null;
  created_at: string;
  updated_at?: string;
  questions?: Question[];
}

export interface Subject {
  subject_id: string;
  subject_name: string;
}

export interface StandardOption {
  code: string;
  statement: string;
  subject_id: string;
  subject_name: string;
  domain_code: string;
  grade_cluster: string;
  grade_label: string;
}

export interface FinalizeMissing {
  question_id: number;
  order_index: number;
  reasons: string[];
}

export type SessionStatus = 'joined' | 'in_progress' | 'submitted' | 'force_submitted' | 'disqualified';

export interface ExamSession {
  id: number;
  exam_id: number;
  roll_number: number;
  status: SessionStatus;
  started_at: string | null;
  submitted_at: string | null;
  warning_count: number;
  score: number | null;
  max_score: number | null;
  current_question_index: number;
  answers?: { order_index: number; is_correct: number; awarded_points: number }[];
}

export interface PublicExam {
  id: number;
  title: string;
  subject_id: string;
  grade_cluster: string;
  time_limit_sec: number;
  mode: ExamMode;
  question_count: number;
}

export interface PublicChoice {
  id: number;
  order_index: number;
  text: string;
}

export interface PublicQuestion {
  id: number;
  order_index: number;
  type: QuestionType;
  prompt: string;
  points: number;
  choices: PublicChoice[];
}

export interface WarningResponse {
  warning_count: number;
  counted: boolean;
  disqualified: boolean;
  max_warnings: number;
}

export interface CurrentQuestionResponse {
  done: boolean;
  timedOut?: boolean;
  index?: number;
  total?: number;
  question?: PublicQuestion;
}

export interface RosterEntry {
  id: number;
  roll_number: number;
  name: string | null;
}

export interface QuestionStat {
  question_id: number;
  order_index: number;
  prompt: string;
  answered_count: number;
  correct_count: number;
  avg_time_spent_ms: number | null;
}

export interface StandardAccuracy {
  code: string;
  statement: string;
  subject_id: string;
  subject_name: string;
  grade_cluster: string;
  attempted_count: number;
  correct_count: number;
  accuracy: number;
  avg_time_spent_ms: number | null;
}

export interface ExamResultSession {
  roll_number: number;
  name: string | null;
  status: SessionStatus;
  score: number | null;
  max_score: number | null;
  submitted_at: string | null;
  total_time_ms: number;
  warning_count: number;
  isOutlier: boolean;
  outlierReasons: string[];
}

export interface ExamResultsData {
  sessions: ExamResultSession[];
  questionStats: QuestionStat[];
  slowestQuestions: QuestionStat[];
  lowestAccuracyQuestions: QuestionStat[];
  standardsAccuracy: StandardAccuracy[];
}

export interface LanInfo {
  url: string;
  studentUrl: string;
  qr: string | null;
  servingClient: boolean;
}
