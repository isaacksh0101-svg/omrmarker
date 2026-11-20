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

export type GradingMode = 'exact' | 'keyword';

// 서술형 채점 기준 한 줄 - keywords 중 하나라도 답안에 있으면 이 그룹을 맞힌 것(동의어 목록).
export interface KeywordGroup {
  keywords: string[];
  weight: number;
}

// 교사 화면용 채점 결과 - 그룹마다 답안에서 찾은 표현(없으면 null).
export interface KeywordGroupResult extends KeywordGroup {
  matched: string | null;
}

export interface Question {
  id: number;
  exam_id: number;
  order_index: number;
  type: QuestionType;
  prompt: string;
  prompt_image_path: string | null;
  // true면 이미지는 그림 자료이고 문제 설명은 prompt 텍스트로 함께 보여준다.
  show_prompt_text: boolean;
  source_image_path: string | null;
  points: number;
  correct_short_answers: string[] | null;
  // "옳은 것을 모두 고르시오" 문항 - 정답 보기 전체와 정확히 일치해야 정답.
  multi_select: boolean;
  // 단답형 채점 방식 - 'keyword'면 서술형으로 keyword_rubric의 키워드 그룹 포함 비율만큼 부분 점수.
  grading_mode: GradingMode;
  keyword_rubric: KeywordGroup[];
  // 문제 오류로 전원 정답 처리한 문항 - 무엇을 답했든 만점.
  full_credit: boolean;
  // 선생님이 직접 채점하는 단답형·서술형 - 단답형은 인정 답안과 다른 답, 서술형은 쓴 답 전부가 교사가 확인할 때까지 "확인 대기".
  open_answer: boolean;
  // 위 문항에서 교사가 오답으로 확정한 답(정규화된 문자열).
  rejected_short_answers: string[];
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
  answers?: SessionAnswerSummary[];
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
  show_prompt_text: boolean;
  points: number;
  multi_select: boolean;
  essay: boolean;
  choices: PublicChoice[];
}

// 학생이 지금 보고 있는 곳 - 문항(question) 또는 마지막 문항 다음의 답안 확인 화면(summary).
export interface CurrentQuestionResponse {
  done: boolean;
  timedOut?: boolean;
  summary?: boolean;
  // 답안 확인 화면: 문항 순서대로 답했는지 여부
  answered?: boolean[];
  index?: number;
  total?: number;
  answered_count?: number;
  question?: PublicQuestion;
  // 이미 답했거나 필기해 둔 문항으로 돌아왔을 때 되살릴 값
  my_answer?: {
    answered: boolean;
    selected_choice_ids: number[];
    short_answer_text: string;
    strokes: StrokesPayload | null;
  };
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
  // 재풀이 문항 중 이의 제기를 낼 수 있는 단답형·서술형(시험 때 쓴 답과 받은 점수, 정답 없음)
  appeal_targets: SessionAnswerSummary[];
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

export type AppealStatus = 'pending' | 'accepted' | 'rejected';

// 학생 결과 화면의 문항별 요약. 정답은 담기지 않는다 - 단답형·서술형만 학생 자신이 쓴 답과
// 이의 제기 상태가 함께 온다.
export interface SessionAnswerSummary {
  question_id: number;
  order_index: number;
  type: QuestionType;
  grading_mode: GradingMode;
  points: number;
  is_correct: number;
  awarded_points: number | null;
  answered: number;
  short_answer_text: string | null;
  appeal_status: AppealStatus | null;
  // 1이면 "교사 직접 채점" 단답형에서 선생님이 정답/오답을 아직 확인하지 않은 답(지금은 0점).
  confirm_pending: number;
}

export interface AnswerAppeal {
  id: number;
  session_id: number;
  question_id: number;
  reason: string;
  status: AppealStatus;
  created_at: string;
  resolved_at: string | null;
}

export interface QuestionStudentAnswer {
  session_id: number;
  roll_number: number;
  name: string | null;
  is_correct: number;
  awarded_points: number | null;
  graded_by_teacher: boolean;
  // 1이면 "교사 직접 채점" 문항에서 교사 확인을 기다리는 답.
  confirm_pending: number;
  // 서술형에서 부분 점수이거나 부정 표현이 섞여 교사가 한 번 봐야 하는 답안.
  needs_review: boolean;
  time_spent_ms: number | null;
  selected_choice_id: number | null;
  // 고른 보기 id 전부("모두 고르기"가 아니면 0~1개).
  selected_choice_ids: number[];
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
  points: number;
  students: QuestionStudentAnswer[];
  // 단답형(서술형 제외)에서 학생들이 쓴 오답을 같은 답끼리 묶은 것(많은 순). 그 외 문항은 null.
  wrong_answer_groups: { text: string; count: number }[] | null;
}

// 문항 정정 미리보기·적용 결과에서 점수가 바뀌는 학생 한 명.
export interface RegradeChange {
  session_id: number;
  roll_number: number;
  name: string | null;
  status?: SessionStatus;
  before: number;
  after: number;
  is_correct: boolean;
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
  // 아직 처리하지 않은 이의 제기 수.
  pending_appeals: number;
  // "교사 직접 채점" 문항에서 교사 확인을 기다리는 답 수.
  pending_confirms: number;
  // 출력한 결과지에 학생 확인 서명을 받았다고 체크한 시각.
  result_signed_at: string | null;
  isOutlier: boolean;
  outlierReasons: string[];
}

export interface ExamResultsData {
  sessions: ExamResultSession[];
  questionStats: QuestionStat[];
  slowestQuestions: QuestionStat[];
  lowestAccuracyQuestions: QuestionStat[];
  standardsAccuracy: StandardAccuracy[];
  studentStandardsAccuracy: StudentStandardAccuracy[];
}

// 한 시험에서 학생 1명 × 성취기준 1개의 정답률(결과 엑셀 "학생별 성취기준" 시트).
export interface StudentStandardAccuracy {
  roll_number: number;
  code: string;
  statement: string;
  subject_name: string;
  attempted_count: number;
  correct_count: number;
  accuracy: number;
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
  // 답을 낸 문항 수 - 학생이 문항을 앞뒤로 오가므로 진행률은 현재 위치가 아니라 이것으로 본다.
  answered_count: number | null;
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
  show_prompt_text: boolean;
  choices: { id: number; order_index: number; text: string; is_correct: boolean }[];
}

export interface MonitorHistoryItem {
  question_id: number;
  order_index: number;
  type: QuestionType;
  prompt: string;
  points: number;
  essay: boolean;
  show_prompt_text: boolean;
  // 이 문항 화면에 들어온 횟수와, 처음 낸 답의 정오(답을 고쳤는지 보기 위함)
  visit_count: number;
  first_is_correct: number | null;
  keyword_groups: KeywordGroupResult[] | null;
  needs_review: boolean;
  graded_by_teacher: boolean;
  prompt_image_path: string | null;
  choices: { id: number; order_index: number; text: string; is_correct: boolean }[];
  correct_short_answers: string[] | null;
  appeal: AnswerAppeal | null;
  multi_select: boolean;
  selected_choice_id: number | null;
  selected_choice_ids: number[];
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
