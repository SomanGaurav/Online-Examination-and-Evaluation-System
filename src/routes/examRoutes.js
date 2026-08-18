const express = require('express');
const exams = require('../controllers/examController');
const submissions = require('../controllers/submissionController');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();
const staff = authorize('teacher', 'admin');

router.use(authenticate);

router.route('/')
  .get(exams.listExams)
  .post(staff, exams.createExam);

router.route('/:examId')
  .get(exams.getExam)
  .patch(staff, exams.updateExam)
  .delete(staff, exams.deleteExam);

router.patch('/:examId/status', staff, exams.changeStatus);

// Question bank
router.post('/:examId/questions', staff, exams.addQuestions);
router.patch('/:examId/questions/:questionId', staff, exams.updateQuestion);
router.delete('/:examId/questions/:questionId', staff, exams.deleteQuestion);

// Attempts
router.post('/:examId/attempts', authorize('student'), submissions.startAttempt);
router.get('/:examId/submissions', staff, submissions.listSubmissions);

module.exports = router;
