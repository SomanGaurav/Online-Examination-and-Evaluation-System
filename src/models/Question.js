const mongoose = require('mongoose');

const QUESTION_TYPES = ['mcq', 'multi-select', 'true-false', 'numeric', 'short-answer', 'long-answer'];
const AUTO_GRADED_TYPES = ['mcq', 'multi-select', 'true-false', 'numeric'];

const optionSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, trim: true },
    text: { type: String, required: true, trim: true },
    isCorrect: { type: Boolean, default: false },
  },
  { _id: false }
);

const questionSchema = new mongoose.Schema(
  {
    exam: { type: mongoose.Schema.Types.ObjectId, ref: 'Exam', required: true, index: true },
    order: { type: Number, default: 0 },
    type: { type: String, enum: QUESTION_TYPES, required: true },
    topic: { type: String, trim: true, default: 'general', index: true },
    prompt: { type: String, required: true, trim: true },
    marks: { type: Number, required: true, min: 0.5 },

    options: { type: [optionSchema], default: undefined },
    numericAnswer: { type: Number },
    tolerance: { type: Number, default: 0 },
    modelAnswer: { type: String, trim: true },
    rubric: { type: String, trim: true },
  },
  { timestamps: true }
);

questionSchema.index({ exam: 1, order: 1 });

questionSchema.virtual('isAutoGraded').get(function isAutoGraded() {
  return AUTO_GRADED_TYPES.includes(this.type);
});

questionSchema.set('toJSON', { virtuals: true });

/** Strips answer keys before a question is handed to a student. */
questionSchema.methods.toStudentView = function toStudentView() {
  return {
    id: this._id,
    order: this.order,
    type: this.type,
    topic: this.topic,
    prompt: this.prompt,
    marks: this.marks,
    options: (this.options || []).map((opt) => ({ key: opt.key, text: opt.text })),
  };
};

questionSchema.pre('validate', function validateShape(next) {
  if (['mcq', 'multi-select', 'true-false'].includes(this.type)) {
    if (!this.options || this.options.length < 2) {
      return next(new Error(`${this.type} questions need at least 2 options`));
    }
    if (!this.options.some((opt) => opt.isCorrect)) {
      return next(new Error(`${this.type} questions need at least one correct option`));
    }
    if (this.type === 'mcq' && this.options.filter((opt) => opt.isCorrect).length > 1) {
      return next(new Error('mcq questions allow exactly one correct option'));
    }
  }
  if (this.type === 'numeric' && typeof this.numericAnswer !== 'number') {
    return next(new Error('numeric questions need a numericAnswer'));
  }
  return next();
});

module.exports = mongoose.model('Question', questionSchema);
module.exports.QUESTION_TYPES = QUESTION_TYPES;
module.exports.AUTO_GRADED_TYPES = AUTO_GRADED_TYPES;
