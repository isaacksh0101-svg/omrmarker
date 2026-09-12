import fs from 'node:fs';
import { config } from '../config.js';

const raw = JSON.parse(fs.readFileSync(config.curriculumStandardsPath, 'utf-8'));

// standards는 { "6수01-01": {code:"[6수01-01]", statement, subject_id, grade_cluster, ...}, ... } 형태.
// 앱 내부에서는 대괄호 없는 이 키 자체를 표준 코드로 사용한다(question_standards.standard_code와 동일 형식).
const standardEntries = Object.entries(raw.standards).map(([code, s]) => ({
  code,
  statement: s.statement,
  subject_id: s.subject_id,
  subject_name: s.subject_name,
  domain_code: s.domain_code,
  grade_cluster: s.grade_cluster,
  grade_label: s.grade_label,
}));

const standardsByCode = new Map(standardEntries.map((s) => [s.code, s]));

export function getSubjects() {
  return Object.values(raw.subjects).map((s) => ({
    subject_id: s.subject_id,
    subject_name: s.subject_name,
  }));
}

export function getGradeClusters() {
  return raw.meta.grade_clusters;
}

export function filterStandards({ subject_id, grade_cluster }) {
  return standardEntries.filter(
    (s) =>
      (!subject_id || s.subject_id === subject_id) &&
      (!grade_cluster || s.grade_cluster === grade_cluster),
  );
}

export function getStandardByCode(code) {
  return standardsByCode.get(code) || null;
}
