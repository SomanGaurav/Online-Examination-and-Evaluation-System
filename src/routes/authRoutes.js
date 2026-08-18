const express = require('express');
const rateLimit = require('express-rate-limit');
const controller = require('../controllers/authController');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: { message: 'Too many login attempts, try again later' } },
});

router.post('/register', controller.register);
router.post('/login', loginLimiter, controller.login);
router.post('/logout', controller.logout);
router.get('/me', authenticate, controller.me);
router.get('/students', authenticate, authorize('teacher', 'admin'), controller.listStudents);

module.exports = router;
