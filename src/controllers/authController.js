const User = require('../models/User');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { requireFields } = require('../utils/validators');
const { signToken } = require('../middleware/auth');

const register = asyncHandler(async (req, res) => {
  requireFields(req.body, ['name', 'email', 'password']);
  const { name, email, password, role, rollNumber, department } = req.body;

  if (password.length < 8) {
    throw ApiError.badRequest('Password must be at least 8 characters');
  }

  const exists = await User.findOne({ email: String(email).toLowerCase() });
  if (exists) throw ApiError.conflict('An account with this email already exists');

  // Teacher/admin accounts are provisioned by an admin, never by self-signup.
  const requestedRole = role === 'teacher' || role === 'admin' ? role : 'student';
  const allowedRole = req.user?.role === 'admin' ? requestedRole : 'student';

  const user = await User.create({
    name,
    email,
    passwordHash: await User.hashPassword(password),
    role: allowedRole,
    rollNumber,
    department,
  });

  res.status(201).json({ ok: true, data: { user: user.toPublic() } });
});

const login = asyncHandler(async (req, res) => {
  requireFields(req.body, ['email', 'password']);
  const user = await User.findOne({ email: String(req.body.email).toLowerCase() }).select('+passwordHash');

  if (!user || !(await user.verifyPassword(req.body.password))) {
    throw ApiError.unauthorized('Invalid email or password');
  }
  if (!user.isActive) throw ApiError.forbidden('Account has been deactivated');

  user.lastLoginAt = new Date();
  await user.save();

  const token = signToken(user);
  res.cookie('token', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: req.secure,
    maxAge: 8 * 60 * 60 * 1000,
  });

  res.json({ ok: true, data: { token, user: user.toPublic() } });
});

const logout = asyncHandler(async (req, res) => {
  res.clearCookie('token');
  res.json({ ok: true, data: { message: 'Signed out' } });
});

const me = asyncHandler(async (req, res) => {
  res.json({ ok: true, data: { user: req.user.toPublic() } });
});

const listStudents = asyncHandler(async (req, res) => {
  const filter = { role: 'student', isActive: true };
  if (req.query.q) {
    filter.$or = [
      { name: new RegExp(String(req.query.q), 'i') },
      { rollNumber: new RegExp(String(req.query.q), 'i') },
    ];
  }
  const students = await User.find(filter).sort({ rollNumber: 1, name: 1 }).limit(500);
  res.json({ ok: true, data: students.map((s) => s.toPublic()) });
});

module.exports = { register, login, logout, me, listStudents };
