const { AUTO_GRADED_TYPES } = require('../models/Question');

function normalizeKeys(value) {
  if (value === null || value === undefined) return [];
  const list = Array.isArray(value) ? value : [value];
  return list.map((v) => String(v).trim().toLowerCase()).filter(Boolean).sort();
}

function correctKeys(question) {
  return (question.options || [])
    .filter((opt) => opt.isCorrect)
    .map((opt) => String(opt.key).trim().toLowerCase())
    .sort();
}

/**
 * Scores one answer for an objective question type.
 * `multi-select` uses partial credit: correct picks earn a proportional share,
 * wrong picks subtract the same share, and the result is floored at zero.
 */
function scoreObjective(question, response, { negativeMarking = 0 } = {}) {
  const expected = correctKeys(question);
  const given = normalizeKeys(response);

  if (!given.length) return { marks: 0, attempted: false };

  if (question.type === 'numeric') {
    const value = Number(response);
    if (Number.isNaN(value)) return { marks: 0, attempted: true };
    const tolerance = question.tolerance || 0;
    const hit = Math.abs(value - question.numericAnswer) <= tolerance;
    return {
      marks: hit ? question.marks : -(question.marks * negativeMarking),
      attempted: true,
    };
  }

  if (question.type === 'multi-select') {
    const share = question.marks / expected.length;
    const hits = given.filter((k) => expected.includes(k)).length;
    const misses = given.filter((k) => !expected.includes(k)).length;
    const raw = hits * share - misses * share;
    return { marks: Math.max(0, Number(raw.toFixed(2))), attempted: true };
  }

  // mcq / true-false
  const hit = expected.length === given.length && expected.every((k, i) => k === given[i]);
  return {
    marks: hit ? question.marks : -(question.marks * negativeMarking),
    attempted: true,
  };
}

/**
 * Grades every objective answer on a submission in one pass and leaves
 * subjective answers flagged for the teacher.
 *
 * Mutates and returns the submission's answers array shape.
 */
function gradeSubmission(submission, questionsById, exam) {
  const negativeMarking = exam?.settings?.negativeMarking || 0;
  let autoScore = 0;
  let pendingReview = 0;

  const answers = submission.answers.map((answer) => {
    const question = questionsById.get(String(answer.question));
    if (!question) return answer;

    if (AUTO_GRADED_TYPES.includes(question.type)) {
      const { marks } = scoreObjective(question, answer.response, { negativeMarking });
      const awarded = Number(Math.max(-question.marks, Math.min(question.marks, marks)).toFixed(2));
      autoScore += awarded;
      answer.awardedMarks = awarded;
      answer.autoGraded = true;
      answer.needsReview = false;
      answer.gradedAt = new Date();
    } else {
      answer.autoGraded = false;
      answer.needsReview = true;
      if (answer.awardedMarks === null || answer.awardedMarks === undefined) {
        pendingReview += 1;
      }
    }
    return answer;
  });

  return { answers, autoScore: Number(autoScore.toFixed(2)), pendingReview };
}

const GRADE_BANDS = [
  { min: 90, grade: 'A+' },
  { min: 80, grade: 'A' },
  { min: 70, grade: 'B' },
  { min: 60, grade: 'C' },
  { min: 50, grade: 'D' },
  { min: 40, grade: 'E' },
  { min: 0, grade: 'F' },
];

function letterGrade(percentage) {
  return GRADE_BANDS.find((band) => percentage >= band.min).grade;
}

/** Recomputes score totals, percentage, letter grade and status for a submission. */
function recomputeTotals(submission, totalMarks) {
  let autoScore = 0;
  let manualScore = 0;
  let pending = 0;

  submission.answers.forEach((answer) => {
    if (answer.awardedMarks === null || answer.awardedMarks === undefined) {
      pending += 1;
      return;
    }
    if (answer.autoGraded) autoScore += answer.awardedMarks;
    else manualScore += answer.awardedMarks;
  });

  const total = Number((autoScore + manualScore).toFixed(2));
  const denominator = totalMarks || 1;
  const percentage = Number(Math.max(0, (total / denominator) * 100).toFixed(2));

  submission.autoScore = Number(autoScore.toFixed(2));
  submission.manualScore = Number(manualScore.toFixed(2));
  submission.totalScore = total;
  submission.percentage = percentage;
  submission.grade = letterGrade(percentage);

  if (submission.status !== 'published') {
    if (pending === 0) submission.status = 'graded';
    else if (pending < submission.answers.length) submission.status = 'partially-graded';
    else submission.status = 'submitted';
  }

  return { pending, total, percentage };
}

module.exports = { scoreObjective, gradeSubmission, recomputeTotals, letterGrade };
