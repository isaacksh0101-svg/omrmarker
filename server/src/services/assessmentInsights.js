const MIN_SAMPLE_SIZE = 8;
// 교육 평가에서 흔히 쓰는 기준(Ebel) - 0.2 미만이면 변별력이 약한 문항으로 본다.
const LOW_DISCRIMINATION_THRESHOLD = 0.2;

function quantile(sorted, p) {
  if (sorted.length === 0) return null;
  const index = (sorted.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

export function distribution(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const q1 = quantile(sorted, 0.25);
  const median = quantile(sorted, 0.5);
  const q3 = quantile(sorted, 0.75);
  const iqr = q3 - q1;
  return {
    count: sorted.length,
    q1,
    median,
    q3,
    iqr,
    lowerFence: q1 - 1.5 * iqr,
    upperFence: q3 + 1.5 * iqr,
  };
}

function isUpperOutlier(value, dist) {
  if (!dist) return false;
  if (dist.iqr > 0) return value > dist.upperFence;
  return dist.median > 0 && value > dist.median * 1.5;
}

function isLowerOutlier(value, dist) {
  if (!dist) return false;
  if (dist.iqr > 0) return value < dist.lowerFence;
  return dist.median > 0 && value < dist.median * 0.5;
}

function mean(values) {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

// 문항 변별도(점이연 상관, point-biserial correlation) - "이 문항을 맞힌 학생들이 시험
// 전체적으로도 점수가 높은가"를 본다. 표본이 적으면(N<8) 값 자체가 신뢰하기 어려워 아예
// 계산하지 않고, 전원 정답/전원 오답이거나 전체 점수 분산이 0이면(=비교할 대상이 없음)
// 수학적으로 정의되지 않으므로 null을 돌려준다 - 단순하게 이 두 조건만 본다.
function computeDiscrimination(rows) {
  if (rows.length < MIN_SAMPLE_SIZE) return null;
  const usable = rows.filter((r) => Number.isFinite(r.restScorePct));
  if (usable.length < MIN_SAMPLE_SIZE) return null;
  const correct = usable.filter((r) => r.isCorrect);
  const incorrect = usable.filter((r) => !r.isCorrect);
  if (correct.length === 0 || incorrect.length === 0) return null;
  // 해당 문항 점수를 총점에서 제외한 수정 문항-총점 상관을 사용한다. 문항이 자기 자신과
  // 상관되어 변별도가 실제보다 높아지는 part-whole inflation을 피하기 위함이다.
  const allScores = usable.map((r) => r.restScorePct);
  const m = mean(allScores);
  const variance = mean(allScores.map((s) => (s - m) ** 2));
  const std = Math.sqrt(variance);
  if (std === 0) return null;
  const p = correct.length / usable.length;
  return ((mean(correct.map((r) => r.restScorePct)) - mean(incorrect.map((r) => r.restScorePct))) / std) * Math.sqrt(p * (1 - p));
}

// 객관식 오답 선택지 분포 - 특정 오답에 응답이 몰리는지, 특히 전체 점수가 높은 학생들이
// 그 오답으로 몰리는지(=문항이나 정답 키 자체를 의심해볼 신호) 확인하기 위함. "고득점"의
// 기준은 절대 점수가 아니라 이 문항에 응답한 학생들 안에서의 중앙값 - 시험마다 난이도가
// 달라 절대 기준은 의미가 없다.
function computeChoiceDistribution(rows, choiceIds) {
  if (rows.length === 0 || choiceIds.length === 0) return [];
  const scoreMedian = distribution(rows.map((r) => r.restScorePct))?.median ?? null;
  return choiceIds.map((choiceId) => {
    // "모두 고르기" 문항은 한 학생이 여러 보기에 동시에 세어진다.
    const selectedRows = rows.filter((r) => (r.selectedChoiceIds ?? []).includes(choiceId));
    const highScorerCount = scoreMedian == null
      ? 0
      : selectedRows.filter((r) => Number.isFinite(r.restScorePct) && r.restScorePct >= scoreMedian).length;
    return { choice_id: choiceId, count: selectedRows.length, high_scorer_count: highScorerCount };
  });
}

export function attachSessionInsights(sessions) {
  // 정상 제출만 학급 기준을 만든다. 강제 제출은 중단 시점 때문에 총시간·점수가 정상
  // 분포를 왜곡할 수 있어 기준에서는 제외하되, UI의 응시 상태로는 그대로 보여준다.
  const submitted = sessions.filter((s) => s.status === 'submitted');
  const timeDist = distribution(submitted.map((s) => s.total_time_ms));
  const scorePct = (s) => (s.max_score ? (s.score ?? 0) / s.max_score : 0);
  const scoreDist = distribution(submitted.map(scorePct));

  sessions.forEach((session) => {
    session.isOutlier = false;
    session.outlierReasons = [];
    if (session.status !== 'submitted' || submitted.length < MIN_SAMPLE_SIZE) return;

    const score = scorePct(session);
    const slow = isUpperOutlier(session.total_time_ms, timeDist);
    const fast = isLowerOutlier(session.total_time_ms, timeDist);
    const lowAccuracy = scoreDist.iqr > 0
      ? score < scoreDist.lowerFence
      : score < scoreDist.median - 0.15;
    const atLeastTypicalAccuracy = score >= scoreDist.median;

    if (fast && lowAccuracy) session.outlierReasons.push('빠르게 풀고 오답이 많음');
    else if (slow && lowAccuracy) session.outlierReasons.push('오래 풀었지만 오답이 많음');
    else if (slow && atLeastTypicalAccuracy) session.outlierReasons.push('정확하지만 시간이 오래 걸림');
    else {
      if (lowAccuracy) session.outlierReasons.push('정답률이 낮음');
      if (slow) session.outlierReasons.push('소요시간이 김');
      // 빠르기만 한 학생은 숙달된 학생일 수 있으므로 경고하지 않는다.
    }
    session.isOutlier = session.outlierReasons.length > 0;
  });
}

export function attachQuestionInsights(questionStats) {
  const eligible = questionStats.filter(
    (q) => q.answered_count >= MIN_SAMPLE_SIZE && Number.isFinite(q.avg_time_spent_ms),
  );
  const timeDist = distribution(eligible.map((q) => q.avg_time_spent_ms));
  const accuracyDist = distribution(
    eligible.map((q) => (q.answered_count > 0 ? q.correct_count / q.answered_count : 0)),
  );
  const spreadDist = distribution(
    eligible.map((q) => distribution(q.time_values_ms)?.iqr ?? 0),
  );

  return questionStats.map((question) => {
    const ownTimeDist = distribution(question.time_values_ms ?? []);
    const insightCodes = [];
    const insightReasons = [];
    if (eligible.length >= 4 && question.answered_count >= MIN_SAMPLE_SIZE && timeDist && accuracyDist) {
      const accuracy = question.correct_count / question.answered_count;
      const long = isUpperOutlier(question.avg_time_spent_ms, timeDist);
      // 시간과 정답률이 동시에 하위 사분위에 있을 때만 표시해 단순히 하위 25%라는
      // 이유만으로 모든 문항에 경고가 붙는 것을 피한다.
      const relativelyFast = question.avg_time_spent_ms <= timeDist.q1;
      const relativelyLowAccuracy = accuracy <= accuracyDist.q1 && accuracy < accuracyDist.median;
      const relativelyHighAccuracy = accuracy >= accuracyDist.q3 && accuracy > accuracyDist.median;
      const variable = ownTimeDist && isUpperOutlier(ownTimeDist.iqr, spreadDist);

      if (long && relativelyLowAccuracy) {
        insightCodes.push('difficult_slow');
        insightReasons.push('어렵고 오래 걸림');
      } else if (relativelyFast && relativelyLowAccuracy) {
        insightCodes.push('fast_wrong');
        insightReasons.push('빠른 오답이 많음');
      } else if (long && relativelyHighAccuracy) {
        insightCodes.push('accurate_slow');
        insightReasons.push('정답률은 높지만 오래 걸림');
      }
      if (variable) {
        insightCodes.push('time_variable');
        insightReasons.push('학생별 시간차 큼');
      }
    }

    const analyticsRows = question.analytics_rows ?? [];
    const discrimination = computeDiscrimination(analyticsRows);
    if (discrimination != null && discrimination < LOW_DISCRIMINATION_THRESHOLD) {
      insightCodes.push('low_discrimination');
      insightReasons.push('변별력 낮음');
    }
    const choiceDistribution = computeChoiceDistribution(analyticsRows, question.choice_ids ?? []);

    const { time_values_ms: _privateTimes, analytics_rows: _privateRows, choice_ids: _privateChoiceIds, ...publicQuestion } = question;
    return {
      ...publicQuestion,
      median_time_spent_ms: ownTimeDist?.median ?? null,
      time_iqr_ms: ownTimeDist?.iqr ?? null,
      insight_codes: insightCodes,
      insight_reasons: insightReasons,
      discrimination,
      choice_distribution: choiceDistribution,
    };
  });
}

const WEAKNESS_MIN_EXAMS = 3;
const WEAKNESS_MIN_ATTEMPTED = 5;
const WEAKNESS_GAP_THRESHOLD = 0.15;

// 여러 시험에 걸쳐 특정 성취기준에서 학급 평균보다 계속 낮은지("반복 약점") 혹은 최근
// 뚜렷하게 좋아졌는지("최근 개선")를 판정한다. 시험 한 번의 우연한 결과와 구분하기 위해
// 최근 3개 시험 모두가 조건을 만족해야 하고, 그 성취기준 문항을 누적 5개 미만 푼
// 경우엔 근거가 너무 적어 판정하지 않는다. mineRows/classRows는 시험별로 이미 집계된
// 행(exam_id, date, code, attempted_count, correct_count)이어야 한다 - 문항 단위가
// 아니라 시험 단위로 먼저 묶어야, 한 시험에 같은 성취기준 문항이 여러 개 몰려 있어도
// "그 시험 한 번"으로만 세어져 반복 여부를 왜곡하지 않는다.
export function computeStandardTrendPatterns(mineRows, classRows) {
  const classByExamCode = new Map(classRows.map((r) => [`${r.exam_id}:${r.code}`, r]));
  const byCode = new Map();
  for (const row of mineRows) {
    if (!byCode.has(row.code)) byCode.set(row.code, []);
    byCode.get(row.code).push(row);
  }

  const results = [];
  for (const [code, examsForCode] of byCode) {
    const sorted = [...examsForCode].sort((a, b) => a.date.localeCompare(b.date) || a.exam_id - b.exam_id);
    const cumulativeAttempted = sorted.reduce((sum, r) => sum + r.attempted_count, 0);
    if (sorted.length < WEAKNESS_MIN_EXAMS || cumulativeAttempted < WEAKNESS_MIN_ATTEMPTED) continue;

    const recent = sorted.slice(-WEAKNESS_MIN_EXAMS);
    const recentAccuracies = recent.map((r) => r.correct_count / r.attempted_count);
    const recentGaps = recent.map((r) => {
      const classRow = classByExamCode.get(`${r.exam_id}:${code}`);
      if (!classRow || classRow.attempted_count === 0) return null;
      return classRow.correct_count / classRow.attempted_count - r.correct_count / r.attempted_count;
    });
    const allGapsKnown = recentGaps.every((g) => g != null);
    const isWeak = allGapsKnown && recentGaps.every((g) => g >= WEAKNESS_GAP_THRESHOLD);

    const nonDecreasing = recentAccuracies.every((a, i) => i === 0 || a >= recentAccuracies[i - 1]);
    const isImproved =
      !isWeak &&
      nonDecreasing &&
      recentAccuracies[recentAccuracies.length - 1] - recentAccuracies[0] >= WEAKNESS_GAP_THRESHOLD;

    if (!isWeak && !isImproved) continue;
    results.push({
      code,
      kind: isWeak ? 'weak' : 'improved',
      examCount: sorted.length,
      cumulativeAttempted,
      recentAccuracies,
      recentGapsPct: allGapsKnown ? recentGaps.map((g) => Math.round(g * 100)) : null,
    });
  }
  return results;
}

export function attachQuestionStudentInsights(rows, accuracy, ownAccuracyByRoll) {
  const timeDist = distribution(rows.map((row) => row.time_spent_ms));
  return rows.map((row) => {
    let outlierReason = null;
    if (rows.length >= MIN_SAMPLE_SIZE && !row.is_correct && row.time_spent_ms != null && timeDist) {
      const ownAccuracy = ownAccuracyByRoll.get(row.roll_number);
      const relativelyEasy = accuracy != null && ownAccuracy != null && accuracy > ownAccuracy;
      const fast = row.time_spent_ms <= timeDist.q1;
      const slow = isUpperOutlier(row.time_spent_ms, timeDist);
      if (relativelyEasy && fast) outlierReason = '빠르게 풀고 틀림';
      else if (slow) outlierReason = '오래 고민하고 틀림';
    }
    return { ...row, isOutlier: Boolean(outlierReason), outlierReason };
  });
}
