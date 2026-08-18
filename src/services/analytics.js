const mongoose = require('mongoose');
const Exam = require('../models/Exam');
const Question = require('../models/Question');
const Submission = require('../models/Submission');
const ApiError = require('../utils/ApiError');

const GRADED_STATES = ['graded', 'published', 'partially-graded'];

function percentile(sortedValues, p) {
  if (!sortedValues.length) return 0;
  const index = (p / 100) * (sortedValues.length - 1);
  const low = Math.floor(index);
  const high = Math.ceil(index);
  if (low === high) return Number(sortedValues[low].toFixed(2));
  const weight = index - low;
  return Number((sortedValues[low] * (1 - weight) + sortedValues[high] * weight).toFixed(2));
}

function buildHistogram(percentages, bucketSize = 10) {
  const buckets = [];
  for (let start = 0; start < 100; start += bucketSize) {
    buckets.push({ label: `${start}-${start + bucketSize}`, from: start, to: start + bucketSize, count: 0 });
  }
  percentages.forEach((value) => {
    const idx = Math.min(buckets.length - 1, Math.floor(value / bucketSize));
    buckets[idx].count += 1;
  });
  return buckets;
}

/** Headline numbers + score distribution for one exam. */
async function examOverview(examId) {
  const exam = await Exam.findById(examId).lean();
  if (!exam) throw ApiError.notFound('Exam not found');

  const [summary] = await Submission.aggregate([
    { $match: { exam: new mongoose.Types.ObjectId(String(examId)) } },
    {
      $group: {
        _id: null,
        submissions: { $sum: 1 },
        graded: { $sum: { $cond: [{ $in: ['$status', ['graded', 'published']] }, 1, 0] } },
        pending: { $sum: { $cond: [{ $in: ['$status', ['submitted', 'partially-graded']] }, 1, 0] } },
        inProgress: { $sum: { $cond: [{ $eq: ['$status', 'in-progress'] }, 1, 0] } },
        averageScore: { $avg: '$totalScore' },
        highestScore: { $max: '$totalScore' },
        lowestScore: { $min: '$totalScore' },
        averageTime: { $avg: '$timeSpentSeconds' },
      },
    },
  ]);

  const scored = await Submission.find(
    { exam: examId, status: { $in: GRADED_STATES } },
    { percentage: 1, totalScore: 1 }
  ).lean();

  const percentages = scored.map((s) => s.percentage).sort((a, b) => a - b);
  const passingPercent = exam.totalMarks ? (exam.passingMarks / exam.totalMarks) * 100 : 0;
  const passed = percentages.filter((p) => p >= passingPercent).length;

  return {
    exam: {
      id: exam._id,
      title: exam.title,
      subject: exam.subject,
      totalMarks: exam.totalMarks,
      passingMarks: exam.passingMarks,
      status: exam.status,
    },
    counts: {
      submissions: summary?.submissions || 0,
      graded: summary?.graded || 0,
      pendingEvaluation: summary?.pending || 0,
      inProgress: summary?.inProgress || 0,
    },
    scores: {
      average: Number((summary?.averageScore || 0).toFixed(2)),
      highest: Number((summary?.highestScore || 0).toFixed(2)),
      lowest: Number((summary?.lowestScore || 0).toFixed(2)),
      median: percentile(percentages, 50),
      p90: percentile(percentages, 90),
      p25: percentile(percentages, 25),
    },
    passRate: percentages.length ? Number(((passed / percentages.length) * 100).toFixed(2)) : 0,
    averageTimeMinutes: Number(((summary?.averageTime || 0) / 60).toFixed(1)),
    distribution: buildHistogram(percentages),
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Per-question difficulty view: average marks earned vs marks available,
 * plus how many scripts still need a human decision on that question.
 */
async function questionBreakdown(examId) {
  const rows = await Submission.aggregate([
    { $match: { exam: new mongoose.Types.ObjectId(String(examId)) } },
    { $unwind: '$answers' },
    {
      $group: {
        _id: '$answers.question',
        type: { $first: '$answers.type' },
        topic: { $first: '$answers.topic' },
        maxMarks: { $first: '$answers.maxMarks' },
        attempts: { $sum: 1 },
        answered: { $sum: { $cond: [{ $ne: ['$answers.response', null] }, 1, 0] } },
        averageMarks: { $avg: '$answers.awardedMarks' },
        fullMarks: {
          $sum: { $cond: [{ $gte: ['$answers.awardedMarks', '$answers.maxMarks'] }, 1, 0] },
        },
        zeroMarks: { $sum: { $cond: [{ $eq: ['$answers.awardedMarks', 0] }, 1, 0] } },
        pending: { $sum: { $cond: [{ $eq: ['$answers.awardedMarks', null] }, 1, 0] } },
      },
    },
  ]);

  const questions = await Question.find({ exam: examId }, { prompt: 1, order: 1 }).lean();
  const promptById = new Map(questions.map((q) => [String(q._id), q]));

  return rows
    .map((row) => {
      const meta = promptById.get(String(row._id)) || {};
      const avg = Number((row.averageMarks || 0).toFixed(2));
      const difficultyIndex = row.maxMarks ? Number((avg / row.maxMarks).toFixed(2)) : 0;
      return {
        questionId: row._id,
        order: meta.order ?? 0,
        prompt: meta.prompt || '(question removed)',
        type: row.type,
        topic: row.topic,
        maxMarks: row.maxMarks,
        attempts: row.attempts,
        answered: row.answered,
        averageMarks: avg,
        fullMarks: row.fullMarks,
        zeroMarks: row.zeroMarks,
        pendingReview: row.pending,
        difficultyIndex,
        difficulty: difficultyIndex >= 0.75 ? 'easy' : difficultyIndex >= 0.4 ? 'moderate' : 'hard',
      };
    })
    .sort((a, b) => a.order - b.order);
}

/** Topic-wise strength/weakness rollup, optionally narrowed to one student. */
async function topicBreakdown(examId, studentId = null) {
  const match = { exam: new mongoose.Types.ObjectId(String(examId)) };
  if (studentId) match.student = new mongoose.Types.ObjectId(String(studentId));

  const rows = await Submission.aggregate([
    { $match: match },
    { $unwind: '$answers' },
    { $match: { 'answers.awardedMarks': { $ne: null } } },
    {
      $group: {
        _id: '$answers.topic',
        earned: { $sum: '$answers.awardedMarks' },
        available: { $sum: '$answers.maxMarks' },
        questions: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  return rows.map((row) => ({
    topic: row._id || 'general',
    earned: Number(row.earned.toFixed(2)),
    available: Number(row.available.toFixed(2)),
    questions: row.questions,
    accuracy: row.available ? Number(((row.earned / row.available) * 100).toFixed(2)) : 0,
  }));
}

/** Class ranking with dense ranks so ties share a position. */
async function leaderboard(examId, limit = 50) {
  const rows = await Submission.find(
    { exam: examId, status: { $in: GRADED_STATES } },
    { student: 1, totalScore: 1, percentage: 1, grade: 1, timeSpentSeconds: 1 }
  )
    .populate('student', 'name rollNumber email')
    .sort({ totalScore: -1, timeSpentSeconds: 1 })
    .limit(limit)
    .lean();

  let lastScore = null;
  let rank = 0;
  return rows.map((row, index) => {
    if (row.totalScore !== lastScore) {
      rank = index + 1;
      lastScore = row.totalScore;
    }
    return {
      rank,
      studentId: row.student?._id,
      name: row.student?.name || 'Unknown',
      rollNumber: row.student?.rollNumber,
      totalScore: row.totalScore,
      percentage: row.percentage,
      grade: row.grade,
      timeSpentMinutes: Number((row.timeSpentSeconds / 60).toFixed(1)),
    };
  });
}

/** Everything a single student's report card needs, in one round of queries. */
async function studentReport(examId, studentId) {
  const submission = await Submission.findOne({ exam: examId, student: studentId })
    .populate('student', 'name email rollNumber department')
    .populate('exam', 'title subject totalMarks passingMarks durationMinutes')
    .lean();

  if (!submission) throw ApiError.notFound('No submission found for this student');

  const questions = await Question.find({ exam: examId }, { prompt: 1, order: 1, type: 1, topic: 1, marks: 1 })
    .sort({ order: 1 })
    .lean();
  const questionById = new Map(questions.map((q) => [String(q._id), q]));

  const cohort = await Submission.find(
    { exam: examId, status: { $in: GRADED_STATES } },
    { totalScore: 1 }
  ).lean();
  const scores = cohort.map((s) => s.totalScore).sort((a, b) => a - b);
  const below = scores.filter((s) => s < submission.totalScore).length;
  const classAverage = scores.length
    ? Number((scores.reduce((sum, s) => sum + s, 0) / scores.length).toFixed(2))
    : 0;

  return {
    student: submission.student,
    exam: submission.exam,
    submission: {
      id: submission._id,
      status: submission.status,
      submittedAt: submission.submittedAt,
      timeSpentMinutes: Number((submission.timeSpentSeconds / 60).toFixed(1)),
      autoScore: submission.autoScore,
      manualScore: submission.manualScore,
      totalScore: submission.totalScore,
      percentage: submission.percentage,
      grade: submission.grade,
      overallComment: submission.overallComment,
    },
    cohort: {
      size: scores.length,
      classAverage,
      percentile: scores.length ? Number(((below / scores.length) * 100).toFixed(1)) : 0,
      rank: scores.length ? scores.length - below : null,
    },
    topics: await topicBreakdown(examId, studentId),
    answers: submission.answers.map((answer) => {
      const meta = questionById.get(String(answer.question)) || {};
      return {
        order: meta.order ?? 0,
        prompt: meta.prompt || '(question removed)',
        type: answer.type,
        topic: answer.topic,
        maxMarks: answer.maxMarks,
        awardedMarks: answer.awardedMarks,
        response: answer.response,
        autoGraded: answer.autoGraded,
        comments: (answer.comments || []).map((c) => ({
          author: c.authorName,
          body: c.body,
          createdAt: c.createdAt,
        })),
      };
    }).sort((a, b) => a.order - b.order),
    generatedAt: new Date().toISOString(),
  };
}

/** Marks-vs-time trend used by the dashboard sparkline. */
async function gradingProgress(examId) {
  const rows = await Submission.aggregate([
    {
      $match: {
        exam: new mongoose.Types.ObjectId(String(examId)),
        evaluatedAt: { $ne: null },
      },
    },
    {
      $group: {
        _id: {
          $dateToString: { format: '%Y-%m-%d %H:00', date: '$evaluatedAt' },
        },
        graded: { $sum: 1 },
        averageScore: { $avg: '$totalScore' },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  return rows.map((row) => ({
    bucket: row._id,
    graded: row.graded,
    averageScore: Number(row.averageScore.toFixed(2)),
  }));
}

module.exports = {
  examOverview,
  questionBreakdown,
  topicBreakdown,
  leaderboard,
  studentReport,
  gradingProgress,
};
