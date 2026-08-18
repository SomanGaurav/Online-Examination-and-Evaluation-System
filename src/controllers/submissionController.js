const Exam = require('../models/Exam');
const Question = require('../models/Question');
const Submission = require('../models/Submission');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { parsePagination } = require('../utils/validators');
const { gradeSubmission, recomputeTotals } = require('../services/autoGrader');
const bus = require('../services/eventBus');

function shuffle(list) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/**
 * Starts (or resumes) an attempt. Resuming returns the same submission so a
 * dropped connection never costs a student their answers.
 */
const startAttempt = asyncHandler(async (req, res) => {
  const exam = await Exam.findById(req.params.examId);
  if (!exam) throw ApiError.notFound('Exam not found');
  if (!exam.isLive) throw ApiError.forbidden('This exam is not accepting attempts right now');

  const questions = await Question.find({ exam: exam._id }).sort({ order: 1 });
  if (!questions.length) throw ApiError.badRequest('This exam has no questions');

  let submission = await Submission.findOne({ exam: exam._id, student: req.user._id }).sort({ attempt: -1 });

  if (submission && submission.status !== 'in-progress') {
    if (submission.attempt >= (exam.settings?.maxAttempts || 1)) {
      throw ApiError.conflict('You have used all attempts for this exam');
    }
    submission = null;
  }

  if (!submission) {
    const previous = await Submission.countDocuments({ exam: exam._id, student: req.user._id });
    submission = await Submission.create({
      exam: exam._id,
      student: req.user._id,
      attempt: previous + 1,
      status: 'in-progress',
      startedAt: new Date(),
      answers: questions.map((q) => ({
        question: q._id,
        type: q.type,
        topic: q.topic,
        maxMarks: q.marks,
        response: null,
      })),
    });
  }

  const ordered = exam.settings?.shuffleQuestions ? shuffle(questions) : questions;
  const elapsed = Math.floor((Date.now() - submission.startedAt.getTime()) / 1000);

  res.status(201).json({
    ok: true,
    data: {
      submissionId: submission._id,
      attempt: submission.attempt,
      exam: {
        id: exam._id,
        title: exam.title,
        subject: exam.subject,
        durationMinutes: exam.durationMinutes,
        totalMarks: exam.totalMarks,
      },
      questions: ordered.map((q) => q.toStudentView()),
      savedAnswers: submission.answers.map((a) => ({ question: a.question, response: a.response })),
      remainingSeconds: Math.max(0, exam.durationMinutes * 60 - elapsed),
    },
  });
});

/** Autosave endpoint — the client calls this on every answer change. */
const saveAnswer = asyncHandler(async (req, res) => {
  const { questionId, response } = req.body;
  const submission = await Submission.findOne({ _id: req.params.submissionId, student: req.user._id });
  if (!submission) throw ApiError.notFound('Attempt not found');
  if (submission.status !== 'in-progress') throw ApiError.conflict('This attempt is already submitted');

  const answer = submission.answers.find((a) => String(a.question) === String(questionId));
  if (!answer) throw ApiError.badRequest('Question does not belong to this attempt');

  answer.response = response ?? null;
  submission.timeSpentSeconds = Math.floor((Date.now() - submission.startedAt.getTime()) / 1000);
  await submission.save();

  res.json({ ok: true, data: { saved: true, questionId, at: new Date().toISOString() } });
});

/**
 * Finalises an attempt: objective questions are scored on the spot, subjective
 * ones are queued for the teacher, and dashboards are notified over SSE.
 */
const submitAttempt = asyncHandler(async (req, res) => {
  const submission = await Submission.findOne({ _id: req.params.submissionId, student: req.user._id });
  if (!submission) throw ApiError.notFound('Attempt not found');
  if (submission.status !== 'in-progress') throw ApiError.conflict('This attempt is already submitted');

  // Accept a final answer sheet in the same call so a last-second save is never lost.
  if (Array.isArray(req.body.answers)) {
    req.body.answers.forEach((incoming) => {
      const answer = submission.answers.find((a) => String(a.question) === String(incoming.questionId));
      if (answer) answer.response = incoming.response ?? null;
    });
  }

  const exam = await Exam.findById(submission.exam);
  const questions = await Question.find({ exam: submission.exam });
  const questionsById = new Map(questions.map((q) => [String(q._id), q]));

  gradeSubmission(submission, questionsById, exam);
  submission.submittedAt = new Date();
  submission.timeSpentSeconds = Math.floor((submission.submittedAt - submission.startedAt) / 1000);
  recomputeTotals(submission, exam.totalMarks);
  await submission.save();

  await Exam.findByIdAndUpdate(exam._id, { $inc: { 'stats.submissionCount': 1 } });
  bus.submitted(String(exam._id), { submissionId: String(submission._id) });

  const showResult = exam.settings?.showResultImmediately;
  res.json({
    ok: true,
    data: {
      submissionId: submission._id,
      status: submission.status,
      pendingReview: submission.answers.filter((a) => a.awardedMarks === null).length,
      ...(showResult
        ? {
            autoScore: submission.autoScore,
            totalScore: submission.totalScore,
            percentage: submission.percentage,
            grade: submission.grade,
          }
        : {}),
    },
  });
});

/** A student's own result history. */
const myResults = asyncHandler(async (req, res) => {
  const submissions = await Submission.find({ student: req.user._id })
    .populate('exam', 'title subject totalMarks passingMarks')
    .sort({ submittedAt: -1 })
    .lean();

  res.json({
    ok: true,
    data: submissions.map((s) => ({
      id: s._id,
      exam: s.exam,
      status: s.status,
      submittedAt: s.submittedAt,
      totalScore: s.status === 'published' || s.status === 'graded' ? s.totalScore : null,
      percentage: s.status === 'published' || s.status === 'graded' ? s.percentage : null,
      grade: s.status === 'published' || s.status === 'graded' ? s.grade : null,
      resultAvailable: ['graded', 'published'].includes(s.status),
    })),
  });
});

/** Paginated submission queue for evaluators. */
const listSubmissions = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query, { defaultLimit: 50, maxLimit: 500 });
  const filter = { exam: req.params.examId };

  if (req.query.status) filter.status = req.query.status;
  if (req.query.pendingOnly === 'true') filter.status = { $in: ['submitted', 'partially-graded'] };

  const [submissions, total] = await Promise.all([
    Submission.find(filter)
      .populate('student', 'name email rollNumber')
      .sort({ submittedAt: 1 })
      .skip(skip)
      .limit(limit)
      .lean({ virtuals: true }),
    Submission.countDocuments(filter),
  ]);

  res.json({
    ok: true,
    data: submissions.map((s) => ({
      id: s._id,
      student: s.student,
      status: s.status,
      submittedAt: s.submittedAt,
      timeSpentMinutes: Number((s.timeSpentSeconds / 60).toFixed(1)),
      autoScore: s.autoScore,
      manualScore: s.manualScore,
      totalScore: s.totalScore,
      percentage: s.percentage,
      grade: s.grade,
      pendingReviewCount: s.answers.filter((a) => a.awardedMarks === null).length,
    })),
    meta: { page, limit, total, pages: Math.ceil(total / limit) },
  });
});

/** Full answer sheet — students may only open their own. */
const getSubmission = asyncHandler(async (req, res) => {
  const submission = await Submission.findById(req.params.submissionId)
    .populate('student', 'name email rollNumber')
    .populate('exam', 'title subject totalMarks passingMarks');
  if (!submission) throw ApiError.notFound('Submission not found');

  const isOwner = String(submission.student._id) === String(req.user._id);
  if (req.user.role === 'student') {
    if (!isOwner) throw ApiError.forbidden();
    if (!['graded', 'published'].includes(submission.status)) {
      throw ApiError.forbidden('Results have not been released yet');
    }
  }

  const questions = await Question.find({ exam: submission.exam._id }).sort({ order: 1 }).lean();
  const questionById = new Map(questions.map((q) => [String(q._id), q]));

  res.json({
    ok: true,
    data: {
      id: submission._id,
      exam: submission.exam,
      student: submission.student,
      status: submission.status,
      submittedAt: submission.submittedAt,
      autoScore: submission.autoScore,
      manualScore: submission.manualScore,
      totalScore: submission.totalScore,
      percentage: submission.percentage,
      grade: submission.grade,
      overallComment: submission.overallComment,
      answers: submission.answers
        .map((answer) => {
          const q = questionById.get(String(answer.question)) || {};
          return {
            questionId: answer.question,
            order: q.order ?? 0,
            prompt: q.prompt || '(question removed)',
            type: answer.type,
            topic: answer.topic,
            maxMarks: answer.maxMarks,
            options: (q.options || []).map((o) => ({
              key: o.key,
              text: o.text,
              // The answer key is only revealed once the script is graded.
              ...(req.user.role !== 'student' || submission.status !== 'in-progress'
                ? { isCorrect: o.isCorrect }
                : {}),
            })),
            modelAnswer: req.user.role === 'student' ? undefined : q.modelAnswer,
            rubric: req.user.role === 'student' ? undefined : q.rubric,
            response: answer.response,
            awardedMarks: answer.awardedMarks,
            autoGraded: answer.autoGraded,
            needsReview: answer.needsReview,
            comments: answer.comments,
          };
        })
        .sort((a, b) => a.order - b.order),
    },
  });
});

module.exports = {
  startAttempt,
  saveAnswer,
  submitAttempt,
  myResults,
  listSubmissions,
  getSubmission,
};
