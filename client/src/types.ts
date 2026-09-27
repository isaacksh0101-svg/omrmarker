import type { StrokesPayload } from './lib/strokes';

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
  source_image_path: string | null;
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
  memo: string | null;
  supervised_at: string | null;
  supervision_order: number | null;
  admission_code: string | null;
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
  // 학생 화면이 자기 세션을 가리킬 때 쓰는 무작위 토큰(참여 시 한 번 발급). id는 교사
  // 화면(로그인 필요)에서만 쓰고, 학생 쪽 요청에는 이걸 대신 써야 한다.
  access_token: string;
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

export interface ReviewQuestionsResponse {
  exam_title: string;
  assignment: {
    id: number;
    status: 'assigned' | 'in_progress' | 'completed';
    current_index: number;
  };
  questions: PublicQuestion[];
  answers: { question_id: number; order_index: number; is_correct: number }[];
}

export interface RosterEntry {
  id: number;
  roll_number: number;
  name: string | null;
}

export interface ChoiceDistributionEntry {
  choice_id: number;
  count: number;
  high_scorer_count: number;
}

export interface QuestionStat {
  question_id: number;
  order_index: number;
  prompt: string;
  answered_count: number;
  correct_count: number;
  avg_time_spent_ms: number | null;
  median_time_spent_ms: number | null;
  time_iqr_ms: number | null;
  insight_codes: string[];
  insight_reasons: string[];
  discrimination: number | null;
  choice_distribution: ChoiceDistributionEntry[];
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
  latest_attempted_at: string | null;
}

// 성취기준별 리포트의 "정답률 변화 추이" 차트 한 점 = 시험(응시) 하나.
export interface StandardsTrendPoint {
  exam_id: number;
  title: string;
  date: string;
  attempted_count: number;
  correct_count: number;
  accuracy: number;
  avg_time_spent_ms: number | null;
}

// 학생별 리포트 전용 - 여러 시험에 걸쳐 반복되는 성취기준별 약점('weak')이나 최근 뚜렷한
// 개선('improved')이 있을 때만 나타난다(최근 3개 시험 전부가 조건을 만족해야 함).
export interface StandardWeaknessPattern {
  code: string;
  statement: string;
  subject_id: string;
  subject_name: string;
  kind: 'weak' | 'improved';
  examCount: number;
  cumulativeAttempted: number;
  recentAccuracies: number[];
  recentGapsPct: number[] | null;
}

export interface QuestionStudentAnswer {
  session_id: number;
  roll_number: number;
  name: string | null;
  is_correct: number;
  time_spent_ms: number | null;
  selected_choice_id: number | null;
  selected_choice_text: string | null;
  short_answer_text: string | null;
  isOutlier: boolean;
  outlierReason: string | null;
}

// SessionReview에서 "빠르게 풀고 틀림"/"오래 고민하고 틀림" 배지를 붙이기 위한 것 - 이
// 세션에서 실제로 이상치로 판정된 문항만 담겨 온다(해당 없으면 배열에서 아예 빠짐).
export interface SessionQuestionOutlier {
  order_index: number;
  outlierReason: string;
}

export interface QuestionBreakdown {
  avgTimeMs: number | null;
  accuracy: number | null;
  students: QuestionStudentAnswer[];
}

export interface ExamResultSession {
  session_id: number | null;
  roll_number: number;
  name: string | null;
  status: SessionStatus;
  score: number | null;
  max_score: number | null;
  submitted_at: string | null;
  total_time_ms: number;
  review_status: 'assigned' | 'in_progress' | 'completed' | null;
  review_completed_at: string | null;
  review_total: number;
  review_answered: number;
  review_correct: number;
  review_max_attempts: number | null;
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
    admission_closed: boolean;
    admission_code: string | null;
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
  prompt_image_path: string | null;
  choices: { id: number; order_index: number; text: string; is_correct: boolean }[];
  correct_short_answers: string[] | null;
  selected_choice_id: number | null;
  selected_choice_text: string | null;
  short_answer_text: string | null;
  is_correct: number | null;
  awarded_points: number | null;
  time_spent_ms: number | null;
  answered_at: string | null;
  strokes: StrokesPayload | null;
}

export interface SessionMonitorDetail {
  session: ExamSession;
  student: { roll_number: number; name: string | null } | null;
  currentQuestion: MonitorCurrentQuestion | null;
  history: MonitorHistoryItem[];
}

// 학생별 리포트에서 "이 학생이 응시한 시험들" 목록에 쓰는 항목.
export interface StudentExamSummary {
  exam_id: number;
  title: string;
  subject_id: string;
  grade_cluster: string;
  session_id: number;
  status: SessionStatus;
  score: number | null;
  max_score: number | null;
  submitted_at: string | null;
  question_count: number;
}

export interface LanIpCandidate {
  name: string;
  address: string;
  netmask: string;
  cidr: string | null;
  profileName: string | null;
  networkCategory: 'Public' | 'Private' | 'DomainAuthenticated' | 'Unknown';
}

export interface LanInfo {
  url: string;
  studentUrl: string;
  qr: string | null;
  servingClient: boolean;
  candidates: LanIpCandidate[];
  selectedIp: string;
  selected: LanIpCandidate | null;
  accessReady: boolean;
}
