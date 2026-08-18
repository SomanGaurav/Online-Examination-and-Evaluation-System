const mongoose = require('mongoose');

const EXAM_STATUS = ['draft', 'published', 'closed'];

const examSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    subject: { type: String, required: true, trim: true, index: true },
    description: { type: String, trim: true, default: '' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    status: { type: String, enum: EXAM_STATUS, default: 'draft', index: true },

    durationMinutes: { type: Number, required: true, min: 1, max: 600 },
    totalMarks: { type: Number, default: 0 },
    passingMarks: { type: Number, default: 0 },
    startsAt: { type: Date },
    endsAt: { type: Date },

    settings: {
      shuffleQuestions: { type: Boolean, default: true },
      showResultImmediately: { type: Boolean, default: false },
      negativeMarking: { type: Number, default: 0, min: 0, max: 1 },
      maxAttempts: { type: Number, default: 1, min: 1 },
    },

    // Cached counters kept in sync by the grading service so dashboards avoid
    // re-aggregating the whole submission collection on every page load.
    stats: {
      submissionCount: { type: Number, default: 0 },
      gradedCount: { type: Number, default: 0 },
      averageScore: { type: Number, default: 0 },
      lastGradedAt: { type: Date },
    },
  },
  { timestamps: true }
);

examSchema.index({ status: 1, startsAt: -1 });

examSchema.virtual('isLive').get(function isLive() {
  if (this.status !== 'published') return false;
  const now = Date.now();
  const afterStart = !this.startsAt || this.startsAt.getTime() <= now;
  const beforeEnd = !this.endsAt || this.endsAt.getTime() >= now;
  return afterStart && beforeEnd;
});

examSchema.set('toJSON', { virtuals: true });

module.exports = mongoose.model('Exam', examSchema);
module.exports.EXAM_STATUS = EXAM_STATUS;
