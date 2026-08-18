const mongoose = require('mongoose');

const SUBMISSION_STATUS = ['in-progress', 'submitted', 'partially-graded', 'graded', 'published'];

const commentSchema = new mongoose.Schema(
  {
    author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    authorName: { type: String, trim: true },
    body: { type: String, required: true, trim: true, maxlength: 2000 },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

const answerSchema = new mongoose.Schema(
  {
    question: { type: mongoose.Schema.Types.ObjectId, ref: 'Question', required: true },
    type: { type: String, required: true },
    topic: { type: String, default: 'general' },
    maxMarks: { type: Number, required: true },

    // Free-form so a single field can hold an option key, an array of keys,
    // a number, or an essay body depending on question type.
    response: { type: mongoose.Schema.Types.Mixed, default: null },

    awardedMarks: { type: Number, default: null },
    autoGraded: { type: Boolean, default: false },
    needsReview: { type: Boolean, default: false },
    comments: { type: [commentSchema], default: [] },
    gradedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    gradedAt: { type: Date },
  },
  { _id: false }
);

const submissionSchema = new mongoose.Schema(
  {
    exam: { type: mongoose.Schema.Types.ObjectId, ref: 'Exam', required: true, index: true },
    student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    attempt: { type: Number, default: 1 },
    status: { type: String, enum: SUBMISSION_STATUS, default: 'in-progress', index: true },

    answers: { type: [answerSchema], default: [] },

    startedAt: { type: Date, default: Date.now },
    submittedAt: { type: Date },
    timeSpentSeconds: { type: Number, default: 0 },

    autoScore: { type: Number, default: 0 },
    manualScore: { type: Number, default: 0 },
    totalScore: { type: Number, default: 0 },
    percentage: { type: Number, default: 0 },
    grade: { type: String, default: null },
    overallComment: { type: String, trim: true, default: '' },

    evaluatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    evaluatedAt: { type: Date },
    publishedAt: { type: Date },
  },
  { timestamps: true }
);

submissionSchema.index({ exam: 1, student: 1, attempt: 1 }, { unique: true });
submissionSchema.index({ exam: 1, status: 1 });

submissionSchema.virtual('pendingReviewCount').get(function pendingReviewCount() {
  return this.answers.filter((a) => a.awardedMarks === null).length;
});

submissionSchema.set('toJSON', { virtuals: true });

module.exports = mongoose.model('Submission', submissionSchema);
module.exports.SUBMISSION_STATUS = SUBMISSION_STATUS;
