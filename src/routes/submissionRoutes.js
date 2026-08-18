const express = require('express');
const submissions = require('../controllers/submissionController');
const grading = require('../controllers/gradingController');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();

router.use(authenticate);

router.get('/mine', authorize('student'), submissions.myResults);

router.patch('/:submissionId/answers', authorize('student'), submissions.saveAnswer);
router.post('/:submissionId/submit', authorize('student'), submissions.submitAttempt);

router.get('/:submissionId', submissions.getSubmission);
router.post('/:submissionId/comments', authorize('teacher', 'admin'), grading.addComment);

module.exports = router;
