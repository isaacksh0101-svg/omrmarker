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
