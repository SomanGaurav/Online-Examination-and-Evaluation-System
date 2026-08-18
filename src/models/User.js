const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const ROLES = ['student', 'teacher', 'admin'];

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, 'Invalid email address'],
    },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ROLES, default: 'student', index: true },
    rollNumber: { type: String, trim: true, sparse: true },
    department: { type: String, trim: true },
    isActive: { type: Boolean, default: true },
    lastLoginAt: { type: Date },
  },
  { timestamps: true }
);

userSchema.virtual('isStaff').get(function isStaff() {
  return this.role === 'teacher' || this.role === 'admin';
});

userSchema.statics.hashPassword = function hashPassword(plain) {
  return bcrypt.hash(plain, 10);
};

userSchema.methods.verifyPassword = function verifyPassword(plain) {
  return bcrypt.compare(plain, this.passwordHash);
};

userSchema.methods.toPublic = function toPublic() {
  return {
    id: this._id,
    name: this.name,
    email: this.email,
    role: this.role,
    rollNumber: this.rollNumber,
    department: this.department,
  };
};

module.exports = mongoose.model('User', userSchema);
module.exports.ROLES = ROLES;
