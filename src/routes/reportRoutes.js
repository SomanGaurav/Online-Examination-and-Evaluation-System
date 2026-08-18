const express = require('express');
const reports = require('../controllers/reportController');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();
const staff = authorize('teacher', 'admin');

router.use(authenticate);

// Analytics (staff only)
router.get('/exams/:examId/dashboard', staff, reports.examDashboard);
router.get('/exams/:examId/overview', staff, reports.examOverview);
router.get('/exams/:examId/questions', staff, reports.examQuestions);
router.get('/exams/:examId/topics', staff, reports.examTopics);
router.get('/exams/:examId/leaderboard', staff, reports.examLeaderboard);
router.get('/exams/:examId/progress', staff, reports.gradingProgress);

// Real-time analytics stream
router.get('/exams/:examId/live', staff, reports.liveStream);

// Exports
router.get('/exams/:examId/export.pdf', staff, reports.examReportPdf);
router.get('/exams/:examId/export.csv', staff, reports.marksSheetCsv);
router.get('/exams/:examId/students/:studentId/report.pdf', reports.studentReportPdf);

module.exports = router;
