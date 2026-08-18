const mongoose = require('mongoose');
const Exam = require('../models/Exam');
const Question = require('../models/Question');
const Submission = require('../models/Submission');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { requireFields, parsePagination } = require('../utils/validators');

/** Keeps Exam.totalMarks in step with the question bank after any edit. */
async function refreshTotalMarks(examId) {
  const [row] = await Question.aggregate([
    { $match: { exam: new mongoose.Types.ObjectId(String(examId)) } },
    { $group: { _id: null, total: { $sum: '$marks' }, count: { $sum: 1 } } },
  ]);
  const total = row?.total || 0;
  await Exam.findByIdAndUpdate(examId, { totalMarks: total });
  return { totalMarks: total, questionCount: row?.count || 0 };
}

async function assertOwnership(examId, user) {
  const exam = await Exam.findById(examId);
  if (!exam) throw ApiError.notFound('Exam not found');
  if (user.role !== 'admin' && String(exam.createdBy) !== String(user._id)) {
    throw ApiError.forbidden('Only the exam owner can modify this exam');
  }
  return exam;
}

const createExam = asyncHandler(async (req, res) => {
  requireFields(req.body, ['title', 'subject', 'durationMinutes']);
  const exam = await Exam.create({
    title: req.body.title,
    subject: req.body.subject,
    description: req.body.description,
    durationMinutes: req.body.durationMinutes,
    passingMarks: req.body.passingMarks || 0,
    startsAt: req.body.startsAt,
    endsAt: req.body.endsAt,
    settings: req.body.settings,
    createdBy: req.user._id,
  });
  res.status(201).json({ ok: true, data: exam });
});

const listExams = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const filter = {};

  if (req.user.role === 'student') {
    filter.status = 'published';
  } else {
    if (req.query.status) filter.status = req.query.status;
    if (req.query.mine === 'true') filter.createdBy = req.user._id;
  }
  if (req.query.subject) filter.subject = new RegExp(String(req.query.subject), 'i');

  const [exams, total] = await Promise.all([
    Exam.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean({ virtuals: true }),
    Exam.countDocuments(filter),
  ]);

  // Students see their own attempt state alongside each exam.
  let attemptByExam = new Map();
  if (req.user.role === 'student' && exams.length) {
    const subs = await Submission.find(
      { student: req.user._id, exam: { $in: exams.map((e) => e._id) } },
      { exam: 1, status: 1, totalScore: 1, percentage: 1, grade: 1 }
    ).lean();
    attemptByExam = new Map(subs.map((s) => [String(s.exam), s]));
  }

  res.json({
    ok: true,
    data: exams.map((exam) => ({
      ...exam,
      myAttempt: attemptByExam.get(String(exam._id)) || null,
    })),
    meta: { page, limit, total, pages: Math.ceil(total / limit) },
  });
});

const getExam = asyncHandler(async (req, res) => {
  const exam = await Exam.findById(req.params.examId).populate('createdBy', 'name email').lean({ virtuals: true });
  if (!exam) throw ApiError.notFound('Exam not found');
  if (req.user.role === 'student' && exam.status !== 'published') {
    throw ApiError.forbidden('This exam is not open yet');
  }

  const questions = await Question.find({ exam: exam._id }).sort({ order: 1 });
  const payload =
    req.user.role === 'student'
      ? questions.map((q) => q.toStudentView())
      : questions.map((q) => q.toJSON());

  res.json({ ok: true, data: { ...exam, questions: payload, questionCount: questions.length } });
});

const updateExam = asyncHandler(async (req, res) => {
  const exam = await assertOwnership(req.params.examId, req.user);
  const editable = ['title', 'subject', 'description', 'durationMinutes', 'passingMarks', 'startsAt', 'endsAt', 'settings'];
  editable.forEach((field) => {
    if (req.body[field] !== undefined) exam[field] = req.body[field];
  });
  await exam.save();
  res.json({ ok: true, data: exam });
});

const changeStatus = asyncHandler(async (req, res) => {
  const exam = await assertOwnership(req.params.examId, req.user);
  const { status } = req.body;
  if (!['draft', 'published', 'closed'].includes(status)) {
    throw ApiError.badRequest('status must be draft, published or closed');
  }
  if (status === 'published') {
    const count = await Question.countDocuments({ exam: exam._id });
    if (!count) throw ApiError.badRequest('Add at least one question before publishing');
    await refreshTotalMarks(exam._id);
  }
  exam.status = status;
  await exam.save();
  res.json({ ok: true, data: await Exam.findById(exam._id).lean({ virtuals: true }) });
});

const deleteExam = asyncHandler(async (req, res) => {
  const exam = await assertOwnership(req.params.examId, req.user);
  const submissions = await Submission.countDocuments({ exam: exam._id });
  if (submissions) throw ApiError.conflict('Cannot delete an exam that already has submissions');
  await Question.deleteMany({ exam: exam._id });
  await exam.deleteOne();
  res.json({ ok: true, data: { message: 'Exam deleted' } });
});

/* ---------------------------------- questions --------------------------------- */

const addQuestions = asyncHandler(async (req, res) => {
  const exam = await assertOwnership(req.params.examId, req.user);
  const incoming = Array.isArray(req.body.questions) ? req.body.questions : [req.body];
  if (!incoming.length) throw ApiError.badRequest('No questions supplied');

  const existing = await Question.countDocuments({ exam: exam._id });
  const docs = incoming.map((q, index) => ({
    ...q,
    exam: exam._id,
    order: q.order ?? existing + index,
  }));

  const created = await Question.create(docs);
  const totals = await refreshTotalMarks(exam._id);

  res.status(201).json({
    ok: true,
    data: { questions: created.map((q) => q.toJSON()), ...totals },
  });
});

const updateQuestion = asyncHandler(async (req, res) => {
  await assertOwnership(req.params.examId, req.user);
  const question = await Question.findOne({ _id: req.params.questionId, exam: req.params.examId });
  if (!question) throw ApiError.notFound('Question not found');

  const editable = ['type', 'topic', 'prompt', 'marks', 'options', 'numericAnswer', 'tolerance', 'modelAnswer', 'rubric', 'order'];
  editable.forEach((field) => {
    if (req.body[field] !== undefined) question[field] = req.body[field];
  });
  await question.save();
  await refreshTotalMarks(req.params.examId);

  res.json({ ok: true, data: question.toJSON() });
});

const deleteQuestion = asyncHandler(async (req, res) => {
  await assertOwnership(req.params.examId, req.user);
  const result = await Question.deleteOne({ _id: req.params.questionId, exam: req.params.examId });
  if (!result.deletedCount) throw ApiError.notFound('Question not found');
  const totals = await refreshTotalMarks(req.params.examId);
  res.json({ ok: true, data: { message: 'Question deleted', ...totals } });
});

module.exports = {
  createExam,
  listExams,
  getExam,
  updateExam,
  changeStatus,
  deleteExam,
  addQuestions,
  updateQuestion,
  deleteQuestion,
};
