const express = require('express');
const grading = require('../controllers/gradingController');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();

router.use(authenticate, authorize('teacher', 'admin'));

// Question-wise review console
router.get('/exams/:examId/questions/:questionId/queue', grading.questionQueue);
router.patch('/exams/:examId/questions/:questionId/bulk', grading.bulkGradeQuestion);

// Batch grading across many submissions at once
router.patch('/exams/:examId/bulk', grading.bulkGrade);
router.post('/exams/:examId/auto-grade', grading.rerunAutoGrade);
router.post('/exams/:examId/publish', grading.publishResults);

module.exports = router;
