// 수학 성취기준 "최근 2회" 정답률 엑셀 자동 저장(보충 학습지 루틴에 넘기는 자료).
//
// 수학 시험의 결과가 바뀔 때마다(학생 제출, 시험 종료, 교사 직접 채점, 문항 정정 등) 잠시 뒤
// 데이터 폴더의 ScoreLab결과/수학_성취기준_최근2회.xlsx 를 다시 만들어 덮어쓴다.
//
// 한 행 = 학생 1명 × 성취기준 1개. "최근 2회"는 전체 시험 중 최근 2번이 아니라 그 학생이 그
// 성취기준을 푼 시험 중 최근 2번이다(성취기준마다 해당 시험이 다르다). 기간 제한은 두지 않는다.
// 어느 시험에서 나온 값인지 확인할 수 있게 두 시험의 이름·날짜·정답률도 같은 행에 적는다.
// 판정 기준(몇 % 미만이면 부족 등)은 넣지 않는다 - 기준은 루틴 쪽에서 정한다.
import fs from 'node:fs';
import path from 'node:path';
import * as XLSX from 'xlsx';
import { config } from '../config.js';
import { db } from '../db/index.js';
import { getStandardByCode } from './curriculumStandards.js';

const MATH_SUBJECT_ID = 'MA';
const DEBOUNCE_MS = 5000;

export const ledgerDir = path.resolve(config.dataDir, 'ScoreLab결과');
export const ledgerPath = path.join(ledgerDir, '수학_성취기준_최근2회.xlsx');
const RECENT_EXAM_COUNT = 2;

let timer = null;

function isMathExam(examId) {
  const row = db.prepare('SELECT subject_id FROM exams WHERE id = ?').get(examId);
  return row?.subject_id === MATH_SUBJECT_ID;
}

// 결과가 바뀐 시험이 수학이면 저장을 예약한다. 시험 중에는 답이 들어올 때마다 불리므로
// 마지막 변경 뒤 몇 초 조용해지면 한 번만 저장한다.
export function scheduleMathLedgerExport(examId) {
  try {
    if (examId != null && !isMathExam(Number(examId))) return;
  } catch {
    return;
  }
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    exportMathLedgerNow();
  }, DEBOUNCE_MS);
  timer.unref?.();
}

function queryRows() {
  // 시험을 마친 응시의 답을 센다. 직접 제출(submitted)뿐 아니라 강제 제출(force_submitted: 시험 종료
  // 버튼, 화면 이탈)도 넣는다 - 시간이 다 돼서 끝난 학생이 보충 대상에서 빠지지 않게 하려는 것이고,
  // 답한 문항(answered_at)만 세므로 못 푼 문항 때문에 정답률이 낮아지지는 않는다.
  // "교사 직접 채점" 문항에서 아직 채점하지 않은 답(confirm_pending)은 임시 0점이라 뺀다.
  return db
    .prepare(
      `SELECT e.id AS exam_id, e.title AS exam_title,
              MIN(date(es.submitted_at, 'localtime')) AS exam_date,
              es.roll_number AS roll_number, r.name AS name,
              qs.standard_code AS code,
              COUNT(*) AS attempted_count,
              COALESCE(SUM(a.is_correct), 0) AS correct_count
       FROM answers a
       JOIN questions q ON q.id = a.question_id
       JOIN question_standards qs ON qs.question_id = q.id
       JOIN exam_sessions es ON es.id = a.session_id
       JOIN exams e ON e.id = q.exam_id
       LEFT JOIN roster r ON r.roll_number = es.roll_number
       WHERE e.subject_id = ? AND es.status IN ('submitted', 'force_submitted') AND a.answered_at IS NOT NULL
         AND COALESCE(a.confirm_pending, 0) = 0
       GROUP BY e.id, es.roll_number, qs.standard_code
       ORDER BY exam_date, e.id, es.roll_number, qs.standard_code`,
    )
    .all(MATH_SUBJECT_ID);
}

const percent = (correct, total) => (total > 0 ? Math.round((correct / total) * 100) : 0);

export function buildMathLedgerWorkbook() {
  // queryRows는 날짜(같은 날이면 시험 번호) 오래된 순이라, 학생×성취기준별로 모으면 맨 뒤가 최근 시험이다.
  const byStudentStandard = new Map();
  for (const r of queryRows()) {
    const key = `${r.roll_number}|${r.code}`;
    const list = byStudentStandard.get(key) ?? [];
    list.push(r);
    byStudentStandard.set(key, list);
  }

  const examColumns = (prefix, r) => ({
    [prefix]: r?.exam_title ?? '',
    [`${prefix}_날짜`]: r?.exam_date ?? '',
    [`${prefix}_정답수`]: r ? r.correct_count : '',
    [`${prefix}_문항수`]: r ? r.attempted_count : '',
    [`${prefix}_정답률`]: r ? percent(r.correct_count, r.attempted_count) : '',
  });

  const recentRows = [...byStudentStandard.values()]
    .map((list) => list.slice(-RECENT_EXAM_COUNT).reverse())
    .sort((a, b) => a[0].roll_number - b[0].roll_number || a[0].code.localeCompare(b[0].code))
    .map(([latest, previous]) => {
      const correct = latest.correct_count + (previous?.correct_count ?? 0);
      const attempted = latest.attempted_count + (previous?.attempted_count ?? 0);
      return {
        번호: latest.roll_number,
        이름: latest.name ?? '',
        코드: latest.code,
        내용: getStandardByCode(latest.code)?.statement ?? '',
        시험수: previous ? 2 : 1,
        정답수: correct,
        문항수: attempted,
        // 외부 도구가 기준값과 바로 비교할 수 있게 0~100 정수로 둔다.
        정답률: percent(correct, attempted),
        ...examColumns('최근시험', latest),
        ...examColumns('이전시험', previous),
      };
    });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(recentRows), '최근 2회');
  return { wb, rowCount: recentRows.length };
}

// 지금 바로 다시 만든다. 임시 파일에 쓴 뒤 바꿔치기해서, 읽는 쪽이 반쯤 쓴 파일을 보지 않게 한다.
// 교사가 엑셀로 파일을 열어 둔 상태면(Windows 파일 잠금) 실패하는데, 다음 변경 때 다시 시도한다.
export function exportMathLedgerNow() {
  try {
    const { wb, rowCount } = buildMathLedgerWorkbook();
    fs.mkdirSync(ledgerDir, { recursive: true });
    const tmp = `${ledgerPath}.tmp`;
    fs.writeFileSync(tmp, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
    fs.renameSync(tmp, ledgerPath);
    return { ok: true, path: ledgerPath, rowCount };
  } catch (error) {
    console.warn(`[수학 누적 성적] 저장하지 못했습니다(파일이 열려 있으면 닫아주세요): ${error.message}`);
    return { ok: false, path: ledgerPath, error: error.message };
  }
}
