const mongoose = require('mongoose');
const env = require('../config/env');
const Exam = require('../models/Exam');
const Question = require('../models/Question');
const Submission = require('../models/Submission');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { parsePagination } = require('../utils/validators');
const { gradeSubmission, recomputeTotals } = require('../services/autoGrader');
const bus = require('../services/eventBus');

/** Recomputes cached exam counters after a grading batch. */
async function refreshExamStats(examId) {
  const [row] = await Submission.aggregate([
    { $match: { exam: new mongoose.Types.ObjectId(String(examId)) } },
    {
      $group: {
        _id: null,
        submissionCount: { $sum: 1 },
        gradedCount: { $sum: { $cond: [{ $in: ['$status', ['graded', 'published']] }, 1, 0] } },
        averageScore: { $avg: '$totalScore' },
      },
    },
  ]);

  const stats = {
    'stats.submissionCount': row?.submissionCount || 0,
    'stats.gradedCount': row?.gradedCount || 0,
    'stats.averageScore': Number((row?.averageScore || 0).toFixed(2)),
    'stats.lastGradedAt': new Date(),
  };
  await Exam.findByIdAndUpdate(examId, { $set: stats });
  return stats;
}

/**
 * Question-wise review queue.
 *
 * Grading one question across the whole class at a time is far faster than
 * opening scripts one by one, so this returns every response to a single
 * question along with the rubric and model answer.
 */
const questionQueue = asyncHandler(async (req, res) => {
  const { examId, questionId } = req.params;
  const { page, limit, skip } = parsePagination(req.query, { defaultLimit: 100, maxLimit: 500 });

  const question = await Question.findOne({ _id: questionId, exam: examId }).lean();
  if (!question) throw ApiError.notFound('Question not found on this exam');

  const filter = { exam: examId, status: { $ne: 'in-progress' } };
  if (req.query.pendingOnly !== 'false') {
    filter.answers = { $elemMatch: { question: new mongoose.Types.ObjectId(String(questionId)), awardedMarks: null } };
  }

  const [submissions, total] = await Promise.all([
    Submission.find(filter, { student: 1, status: 1, answers: { $elemMatch: { question: questionId } } })
      .populate('student', 'name rollNumber')
      .sort({ submittedAt: 1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Submission.countDocuments(filter),
  ]);

  res.json({
    ok: true,
    data: {
      question: {
        id: question._id,
        order: question.order,
        prompt: question.prompt,
        type: question.type,
        topic: question.topic,
        marks: question.marks,
        modelAnswer: question.modelAnswer,
        rubric: question.rubric,
        options: question.options,
      },
      responses: submissions.map((sub) => {
        const answer = sub.answers?.[0] || {};
        return {
          submissionId: sub._id,
          student: sub.student,
          status: sub.status,
          response: answer.response ?? null,
          awardedMarks: answer.awardedMarks ?? null,
          comments: answer.comments || [],
        };
      }),
    },
    meta: { page, limit, total, pages: Math.ceil(total / limit) },
  });
});

/**
 * Bulk grading API.
 *
 * Accepts marks and comments for many submissions in one request, validates
 * every item, recomputes totals, then writes the whole batch with a single
 * `bulkWrite`. Partial failures are reported per item rather than rolling back
 * the successful ones, so one bad payload cannot block a class of 100+.
 *
 * Body:
 * {
 *   "items": [
 *     { "submissionId": "...",
 *       "answers": [{ "questionId": "...", "marks": 4, "comment": "Good derivation" }],
 *       "overallComment": "Well structured",
 *       "publish": false }
 *   ]
 * }
 */
const bulkGrade = asyncHandler(async (req, res) => {
  const { examId } = req.params;
  const items = Array.isArray(req.body.items) ? req.body.items : [];

  if (!items.length) throw ApiError.badRequest('items[] must contain at least one submission');
  if (items.length > env.bulkGradeLimit) {
    throw ApiError.badRequest(`A batch may hold at most ${env.bulkGradeLimit} submissions`, {
      received: items.length,
    });
  }

  const exam = await Exam.findById(examId).lean();
  if (!exam) throw ApiError.notFound('Exam not found');

  const ids = items
    .map((item) => item.submissionId)
    .filter((id) => mongoose.isValidObjectId(id));

  const submissions = await Submission.find({ _id: { $in: ids }, exam: examId });
  const submissionById = new Map(submissions.map((s) => [String(s._id), s]));

  const operations = [];
  const results = [];
  const failures = [];
  const evaluator = req.user;

  for (const item of items) {
    const submission = submissionById.get(String(item.submissionId));
    if (!submission) {
      failures.push({ submissionId: item.submissionId, error: 'Submission not found on this exam' });
      continue;
    }
    if (submission.status === 'in-progress') {
      failures.push({ submissionId: item.submissionId, error: 'Attempt is still in progress' });
      continue;
    }

    const itemErrors = [];

    (item.answers || []).forEach((patch) => {
      const answer = submission.answers.find((a) => String(a.question) === String(patch.questionId));
      if (!answer) {
        itemErrors.push({ questionId: patch.questionId, error: 'Question not part of this submission' });
        return;
      }

      if (patch.marks !== undefined && patch.marks !== null) {
        const marks = Number(patch.marks);
        if (Number.isNaN(marks) || marks < 0 || marks > answer.maxMarks) {
          itemErrors.push({
            questionId: patch.questionId,
            error: `marks must be between 0 and ${answer.maxMarks}`,
          });
          return;
        }
        answer.awardedMarks = Number(marks.toFixed(2));
        answer.autoGraded = false;
        answer.needsReview = false;
        answer.gradedBy = evaluator._id;
        answer.gradedAt = new Date();
      }

      if (patch.comment) {
        answer.comments.push({
          author: evaluator._id,
          authorName: evaluator.name,
          body: String(patch.comment).slice(0, 2000),
          createdAt: new Date(),
        });
      }
    });

    if (itemErrors.length) {
      failures.push({ submissionId: item.submissionId, errors: itemErrors });
      continue;
    }

    if (item.overallComment !== undefined) {
      submission.overallComment = String(item.overallComment).slice(0, 4000);
    }

    const { pending } = recomputeTotals(submission, exam.totalMarks);
    submission.evaluatedBy = evaluator._id;
    submission.evaluatedAt = new Date();

    if (item.publish && pending === 0) {
      submission.status = 'published';
      submission.publishedAt = new Date();
    }

    operations.push({
      updateOne: {
        filter: { _id: submission._id },
        update: {
          $set: {
            answers: submission.answers,
            overallComment: submission.overallComment,
            autoScore: submission.autoScore,
            manualScore: submission.manualScore,
            totalScore: submission.totalScore,
            percentage: submission.percentage,
            grade: submission.grade,
            status: submission.status,
            evaluatedBy: submission.evaluatedBy,
            evaluatedAt: submission.evaluatedAt,
            ...(submission.publishedAt ? { publishedAt: submission.publishedAt } : {}),
          },
        },
      },
    });

    results.push({
      submissionId: submission._id,
      totalScore: submission.totalScore,
      percentage: submission.percentage,
      grade: submission.grade,
      status: submission.status,
      pendingReview: pending,
    });
  }

  let written = 0;
  if (operations.length) {
    const writeResult = await Submission.bulkWrite(operations, { ordered: false });
    written = writeResult.modifiedCount ?? operations.length;
    const stats = await refreshExamStats(examId);
    bus.gradedBatch(String(examId), {
      graded: results.length,
      evaluator: evaluator.name,
      averageScore: stats['stats.averageScore'],
    });
  }

  res.status(failures.length && !results.length ? 400 : 200).json({
    ok: failures.length === 0,
    data: {
      requested: items.length,
      graded: results.length,
      written,
      results,
      failures,
    },
  });
});

/**
 * Awards the same marks (and optionally the same comment) to many students for
 * one question — used by the question-wise grading console.
 */
const bulkGradeQuestion = asyncHandler(async (req, res, next) => {
  const { questionId } = req.params;
  const entries = Array.isArray(req.body.entries) ? req.body.entries : [];
  if (!entries.length) throw ApiError.badRequest('entries[] must contain at least one row');

  const items = entries.map((entry) => ({
    submissionId: entry.submissionId,
    answers: [{ questionId, marks: entry.marks, comment: entry.comment }],
  }));

  req.body = { items };
  return bulkGrade(req, res, next);
});

/** Re-runs objective auto-grading across an exam, e.g. after fixing an answer key. */
const rerunAutoGrade = asyncHandler(async (req, res) => {
  const { examId } = req.params;
  const exam = await Exam.findById(examId);
  if (!exam) throw ApiError.notFound('Exam not found');

  const questions = await Question.find({ exam: examId });
  const questionsById = new Map(questions.map((q) => [String(q._id), q]));

  const submissions = await Submission.find({ exam: examId, status: { $ne: 'in-progress' } });
  const operations = submissions.map((submission) => {
    gradeSubmission(submission, questionsById, exam);
    recomputeTotals(submission, exam.totalMarks);
    return {
      updateOne: {
        filter: { _id: submission._id },
        update: {
          $set: {
            answers: submission.answers,
            autoScore: submission.autoScore,
            manualScore: submission.manualScore,
            totalScore: submission.totalScore,
            percentage: submission.percentage,
            grade: submission.grade,
            status: submission.status,
          },
        },
      },
    };
  });

  if (operations.length) {
    await Submission.bulkWrite(operations, { ordered: false });
    await refreshExamStats(examId);
    bus.gradedBatch(String(examId), { graded: operations.length, evaluator: req.user.name });
  }

  res.json({ ok: true, data: { rescored: operations.length } });
});

/** Releases results to students, either for named submissions or the whole exam. */
const publishResults = asyncHandler(async (req, res) => {
  const { examId } = req.params;
  const filter = { exam: examId, status: 'graded' };
  if (Array.isArray(req.body.submissionIds) && req.body.submissionIds.length) {
    filter._id = { $in: req.body.submissionIds.filter((id) => mongoose.isValidObjectId(id)) };
  }

  const result = await Submission.updateMany(filter, {
    $set: { status: 'published', publishedAt: new Date() },
  });

  await refreshExamStats(examId);
  bus.published(String(examId), { published: result.modifiedCount });

  res.json({ ok: true, data: { published: result.modifiedCount } });
});

/** Adds a comment without touching marks (review pass, moderation notes). */
const addComment = asyncHandler(async (req, res) => {
  const { submissionId } = req.params;
  const { questionId, body } = req.body;
  if (!body) throw ApiError.badRequest('body is required');

  const submission = await Submission.findById(submissionId);
  if (!submission) throw ApiError.notFound('Submission not found');

  const comment = {
    author: req.user._id,
    authorName: req.user.name,
    body: String(body).slice(0, 2000),
    createdAt: new Date(),
  };

  if (questionId) {
    const answer = submission.answers.find((a) => String(a.question) === String(questionId));
    if (!answer) throw ApiError.badRequest('Question not part of this submission');
    answer.comments.push(comment);
  } else {
    submission.overallComment = comment.body;
  }

  await submission.save();
  res.status(201).json({ ok: true, data: { comment, scope: questionId ? 'answer' : 'overall' } });
});

module.exports = {
  questionQueue,
  bulkGrade,
  bulkGradeQuestion,
  rerunAutoGrade,
  publishResults,
  addComment,
};
