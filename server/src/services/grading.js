// 자동 채점 규칙과, 정답을 고친 뒤 이미 낸 답안을 다시 채점하는 도구.
// 본시험·오답 재풀이·문항 정정(정답 추가, 정답 번호 변경, 전원 정답)이 모두 같은 규칙을 쓴다.
import * as repo from '../db/repo.js';
import { gradeKeywordAnswer, keywordAwardedPoints } from './keywordGrading.js';

export function isKeywordQuestion(q) {
  return q.type === 'short' && q.grading_mode === 'keyword';
}

// 객관식 채점. 한 개만 고르는 문항은 selected_choice_id를, "모두 고르기" 문항은
// selected_choice_ids 배열을 받아 정답 보기 집합과 정확히 일치할 때만 정답으로 본다.
// 한 개만 고르는 문항에 정답 보기가 여럿이면(복수 정답 인정) 그중 하나만 골라도 정답이다.
// 문제 오류로 전원 정답(full_credit) 처리한 문항은 무엇을 골랐든 정답이다.
// 저장용 값도 같이 돌려줘서 본시험/오답 재풀이 두 경로가 같은 규칙을 쓰게 한다.
export function gradeMultipleChoice(question, body) {
  if (question.multi_select) {
    const validIds = new Set(question.choices.map((c) => c.id));
    const raw = Array.isArray(body?.selected_choice_ids) ? body.selected_choice_ids : [];
    const selectedIds = [...new Set(raw.filter((id) => Number.isInteger(id) && validIds.has(id)))];
    const correctIds = question.choices.filter((c) => c.is_correct).map((c) => c.id);
    const isCorrect =
      !!question.full_credit ||
      (selectedIds.length > 0 &&
        selectedIds.length === correctIds.length &&
        correctIds.every((id) => selectedIds.includes(id)));
    return { selectedChoiceId: null, selectedChoiceIds: selectedIds, isCorrect };
  }
  const selectedChoiceId = Number.isInteger(body?.selected_choice_id) ? body.selected_choice_id : null;
  const choice = question.choices.find((c) => c.id === selectedChoiceId);
  return {
    selectedChoiceId: choice ? selectedChoiceId : null,
    selectedChoiceIds: null,
    isCorrect: !!question.full_credit || Boolean(choice?.is_correct),
  };
}

// 단답형 채점. 일반 단답형은 인정 답안 중 하나와 같으면 만점, 서술형은 맞힌 키워드 그룹
// 비율만큼 부분 점수를 주고 전부 맞혔을 때만 정답(is_correct)으로 본다 - 오답 재풀이와
// 정답률 통계가 "정답/오답" 두 가지로만 돌아가기 때문이다.
export function gradeShortAnswer(question, answerText) {
  if (question.full_credit) return { isCorrect: true, awardedPoints: question.points };
  if (isKeywordQuestion(question)) {
    const { ratio } = gradeKeywordAnswer(question.keyword_rubric, answerText);
    return { isCorrect: ratio === 1, awardedPoints: keywordAwardedPoints(question.points, ratio) };
  }
  const accepted = (question.correct_short_answers ?? []).map(normalizeShortAnswer);
  const isCorrect = accepted.includes(normalizeShortAnswer(answerText));
  return { isCorrect, awardedPoints: isCorrect ? question.points : 0 };
}

// 단답형 비교용 정규화. "건조 기후"와 "건조기후"처럼 띄어쓰기만 다른 답은 같은 답으로 보고,
// "건조 기후."처럼 끝에 붙은 문장부호도 무시한다. 소수점("3.5")·분수("1/2")·음수("-3")는
// 답의 일부라 건드리지 않도록 문장부호는 맨 끝에 있는 것만 뗀다. 소문항 답을 쉼표로 묶은
// "8, 1.7"도 띄어쓰기를 지우면 "8,1.7"과 같아지고, 전각 쉼표·가운뎃점식 쉼표(，、)는 일반
// 쉼표로 맞춘다.
export function normalizeShortAnswer(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[，、]/g, ',')
    .replace(/[.。!?~]+$/, '');
}

// "교사 직접 채점"(open_answer) 문항에서 교사가 확인할 때까지 점수를 확정하지 않고 확인 대기로
// 두는 답인지. 빈 답과 전원 정답 문항은 대기가 아니다.
// - 단답형: 인정 답안과 다른 답만 대기. 교사가 이미 오답으로 확정한 답은 대기가 아니다.
// - 서술형: 키워드 자동 채점 점수는 제안일 뿐이라 답을 쓴 학생은 모두 대기 - 교사가 점수를 준다.
export function isConfirmPending(question, answerText, isCorrect) {
  if (!question.open_answer || question.type !== 'short' || question.full_credit) return false;
  const text = String(answerText ?? '').trim();
  if (!text) return false;
  if (isKeywordQuestion(question)) return true;
  if (isCorrect) return false;
  return !(question.rejected_short_answers ?? []).includes(normalizeShortAnswer(text));
}

// 단답형·서술형 채점 + 확인 대기 여부. 확인 대기인 답은 교사가 정할 때까지 0점·오답으로 둔다.
// 본시험 답 제출과 정답 수정 후 재채점이 같은 규칙을 쓰도록 한곳에 모았다.
export function gradeShortAnswerWithPending(question, answerText) {
  const graded = gradeShortAnswer(question, answerText);
  const pending = isConfirmPending(question, answerText, graded.isCorrect);
  return pending ? { isCorrect: false, awardedPoints: 0, pending } : { ...graded, pending };
}

// 저장된 답안 한 행을 (고친) 문항 기준으로 다시 채점한다. 답하지 않은 행은 전원 정답이면
// 만점, 아니면 0점이다.
function gradeStoredAnswer(question, row) {
  if (!row.answered_at) {
    return question.full_credit
      ? { isCorrect: true, awardedPoints: question.points, pending: false }
      : { isCorrect: false, awardedPoints: 0, pending: false };
  }
  if (question.type === 'mc') {
    const ids = row.selected_choice_ids ? JSON.parse(row.selected_choice_ids) : [];
    const { isCorrect } = gradeMultipleChoice(question, {
      selected_choice_id: row.selected_choice_id,
      selected_choice_ids: ids,
    });
    return { isCorrect, awardedPoints: isCorrect ? question.points : 0, pending: false };
  }
  return gradeShortAnswerWithPending(question, row.short_answer_text ?? '');
}

// 문항(정답을 고친 상태)으로 이미 낸 답안을 다시 채점하면 점수가 바뀌는 학생 목록. 시험을 마친
// 학생과 응시 중인 학생 모두 포함한다. 교사가 직접 고친 점수는 기본으로 건드리지 않지만,
// 전원 정답을 켤 때는 교사 채점도 만점으로 올린다(includeTeacherGraded).
export async function computeRegrade(question, { includeTeacherGraded = false } = {}) {
  const rows = await repo.listQuestionAnswersForRegrade(question.exam_id, question.id);
  const changes = [];
  for (const row of rows) {
    if (row.graded_by_teacher && !includeTeacherGraded) continue;
    // 시험을 마친 학생 중 이 문항 답안 행이 아예 없는 경우(문항을 열어보지도 않음)는 전원 정답일
    // 때만 의미가 있다.
    if (!row.answer_id && !question.full_credit) continue;
    const graded = gradeStoredAnswer(question, row);
    const pending = graded.pending;
    const before = row.awarded_points ?? 0;
    if (
      row.answer_id &&
      graded.awardedPoints === before &&
      Number(graded.isCorrect) === (row.is_correct ?? 0) &&
      Number(pending) === (row.confirm_pending ?? 0)
    ) {
      continue;
    }
    changes.push({
      session_id: row.session_id,
      roll_number: row.roll_number,
      name: row.name,
      status: row.status,
      answered: !!row.answered_at,
      before,
      after: graded.awardedPoints,
      is_correct: graded.isCorrect,
      pending,
    });
  }
  return changes;
}

export async function applyRegrade(question, changes) {
  for (const change of changes) {
    await repo.applyAutoRegrade(change.session_id, question.id, change.after, change.is_correct, {
      answered: change.answered,
      pending: change.pending,
    });
  }
  // 정정으로 만점이 된 학생의 처리 전 이의 제기는 받아들임으로 마무리한다.
  await repo.acceptAppealsNowCorrect(question.id);
}
