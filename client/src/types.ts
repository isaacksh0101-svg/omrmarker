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

export interface StandardCandidate {
  code: string;
  confidence: 'high' | 'medium' | 'low';
  rationale: string;
}

export interface Question {
  id: number;
  exam_id: number;
  order_index: number;
  type: QuestionType;
  prompt: string;
  prompt_image_path: string | null;
  points: number;
  correct_short_answers: string[] | null;
  ai_suggested: boolean;
  // AI가 제안한 성취기준 후보 전체(관련도 순, 1순위는 이미 standards에 자동 태그됨) - 교사가
  // AI 판단을 검토할 때 참고용. AI로 만들어지지 않은 문항은 null.
  ai_standard_candidates: StandardCandidate[] | null;
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
  extra_time_sec: number;
  score: number | null;
  max_score: number | null;
  current_question_index: number;
  disqualify_reason: string | null;
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
  prompt_image_path: string | null;
  points: number;
  choices: PublicChoice[];
}

export interface CurrentQuestionResponse {
  done: boolean;
  timedOut?: boolean;
  reviewMode?: boolean;
  pendingCount?: number;
  index?: number;
  total?: number;
  question?: PublicQuestion;
}

export interface PendingQuestionsResponse {
  questions: PublicQuestion[];
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

export interface QuestionStudentAnswer {
  roll_number: number;
  name: string | null;
  is_correct: number;
  time_spent_ms: number | null;
  selected_choice_id: number | null;
  selected_choice_text: string | null;
  short_answer_text: string | null;
}

export interface QuestionBreakdown {
  avgTimeMs: number | null;
  students: QuestionStudentAnswer[];
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

export interface MonitorStudent {
  roll_number: number;
  name: string | null;
  session_id: number | null;
  status: SessionStatus | null;
  current_question_index: number | null;
  warning_count: number | null;
  extra_time_sec: number | null;
  started_at: string | null;
  submitted_at: string | null;
  score: number | null;
  max_score: number | null;
  disqualify_reason: string | null;
}

export interface ExamMonitorData {
  exam: {
    id: number;
    title: string;
    status: ExamStatus;
    question_count: number;
    time_limit_sec: number;
    started_at: string | null;
    ends_at: string | null;
  };
  students: MonitorStudent[];
}

export interface MonitorCurrentQuestion {
  index: number;
  total: number;
  type: QuestionType;
  prompt: string;
  prompt_image_path: string | null;
  choices: { id: number; order_index: number; text: string; is_correct: boolean }[];
}

export interface MonitorHistoryItem {
  order_index: number;
  type: QuestionType;
  prompt: string;
  selected_choice_id: number | null;
  selected_choice_text: string | null;
  short_answer_text: string | null;
  is_correct: number | null;
  awarded_points: number | null;
  time_spent_ms: number | null;
  answered_at: string | null;
}

export interface SessionMonitorDetail {
  session: ExamSession;
  student: { roll_number: number; name: string | null } | null;
  currentQuestion: MonitorCurrentQuestion | null;
  history: MonitorHistoryItem[];
}

export interface LanIpCandidate {
  name: string;
  address: string;
}

export interface LanInfo {
  url: string;
  studentUrl: string;
  qr: string | null;
  servingClient: boolean;
  candidates: LanIpCandidate[];
  selectedIp: string;
}
