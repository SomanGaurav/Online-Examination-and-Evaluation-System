/**
 * Seeds a demo dataset: one teacher, a cohort of students, two exams and a pile
 * of submissions so the grading queue and analytics pages have something real
 * to show.
 *
 *   npm run seed                    # 120 students
 *   node scripts/seed.js --submissions 250
 */
const mongoose = require('mongoose');
const { connectDB, disconnectDB } = require('../src/config/db');
const User = require('../src/models/User');
const Exam = require('../src/models/Exam');
const Question = require('../src/models/Question');
const Submission = require('../src/models/Submission');
const { gradeSubmission, recomputeTotals } = require('../src/services/autoGrader');

const argv = process.argv.slice(2);
function flag(name, fallback) {
  const index = argv.indexOf(`--${name}`);
  return index === -1 ? fallback : argv[index + 1];
}

const STUDENT_COUNT = Number(flag('submissions', 120));
const PASSWORD = 'Password@123';

const FIRST = ['Aarav', 'Isha', 'Rohan', 'Meera', 'Kabir', 'Ananya', 'Vivaan', 'Diya', 'Arjun', 'Sara', 'Neel', 'Tara'];
const LAST = ['Sharma', 'Patil', 'Iyer', 'Desai', 'Nair', 'Joshi', 'Kulkarni', 'Reddy', 'Bose', 'Menon'];

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

const dbmsQuestions = [
  {
    type: 'mcq',
    topic: 'normalization',
    marks: 2,
    prompt: 'Which normal form removes transitive functional dependencies?',
    options: [
      { key: 'a', text: '1NF', isCorrect: false },
      { key: 'b', text: '2NF', isCorrect: false },
      { key: 'c', text: '3NF', isCorrect: true },
      { key: 'd', text: 'BCNF', isCorrect: false },
    ],
  },
  {
    type: 'mcq',
    topic: 'indexing',
    marks: 2,
    prompt: 'A clustered index on a table determines...',
    options: [
      { key: 'a', text: 'the physical ordering of rows', isCorrect: true },
      { key: 'b', text: 'the buffer pool size', isCorrect: false },
      { key: 'c', text: 'the isolation level', isCorrect: false },
      { key: 'd', text: 'the number of allowed joins', isCorrect: false },
    ],
  },
  {
    type: 'multi-select',
    topic: 'transactions',
    marks: 3,
    prompt: 'Select the ACID guarantees that a rollback directly protects.',
    options: [
      { key: 'a', text: 'Atomicity', isCorrect: true },
      { key: 'b', text: 'Consistency', isCorrect: true },
      { key: 'c', text: 'Isolation', isCorrect: false },
      { key: 'd', text: 'Durability', isCorrect: false },
    ],
  },
  {
    type: 'true-false',
    topic: 'indexing',
    marks: 1,
    prompt: 'A B+ tree index keeps all data pointers in its leaf nodes.',
    options: [
      { key: 'true', text: 'True', isCorrect: true },
      { key: 'false', text: 'False', isCorrect: false },
    ],
  },
  {
    type: 'numeric',
    topic: 'query-cost',
    marks: 2,
    prompt: 'A relation has 10,000 tuples and 20 tuples fit per block. How many blocks does a full scan read?',
    numericAnswer: 500,
    tolerance: 0,
  },
  {
    type: 'short-answer',
    topic: 'transactions',
    marks: 5,
    prompt: 'Explain the difference between optimistic and pessimistic concurrency control.',
    modelAnswer:
      'Pessimistic control locks resources before access to prevent conflicts; optimistic control lets transactions proceed and validates at commit, aborting on conflict.',
    rubric: '2 marks per approach described correctly, 1 mark for a valid use-case comparison.',
  },
  {
    type: 'long-answer',
    topic: 'normalization',
    marks: 10,
    prompt:
      'Given an unnormalised orders table, take it through 1NF, 2NF and 3NF. State the dependencies removed at each step.',
    modelAnswer:
      'Split repeating groups for 1NF, remove partial dependencies on the composite key for 2NF, then remove transitive dependencies (customer_city depending on customer_id) for 3NF.',
    rubric: '3 marks per normal form with justified dependencies, 1 mark for the final schema diagram.',
  },
];

const osQuestions = [
  {
    type: 'mcq',
    topic: 'scheduling',
    marks: 2,
    prompt: 'Which scheduling policy gives the lowest average waiting time for a known set of burst times?',
    options: [
      { key: 'a', text: 'First Come First Serve', isCorrect: false },
      { key: 'b', text: 'Shortest Job First', isCorrect: true },
      { key: 'c', text: 'Round Robin', isCorrect: false },
      { key: 'd', text: 'Priority with ageing', isCorrect: false },
    ],
  },
  {
    type: 'multi-select',
    topic: 'deadlock',
    marks: 3,
    prompt: 'Which conditions must hold simultaneously for a deadlock?',
    options: [
      { key: 'a', text: 'Mutual exclusion', isCorrect: true },
      { key: 'b', text: 'Hold and wait', isCorrect: true },
      { key: 'c', text: 'Pre-emption allowed', isCorrect: false },
      { key: 'd', text: 'Circular wait', isCorrect: true },
    ],
  },
  {
    type: 'numeric',
    topic: 'memory',
    marks: 2,
    prompt: 'With a 4 KB page size, how many pages does a 1 MB process need?',
    numericAnswer: 256,
    tolerance: 0,
  },
  {
    type: 'short-answer',
    topic: 'memory',
    marks: 5,
    prompt: 'Describe thrashing and one practical way an OS can reduce it.',
    modelAnswer:
      'Thrashing is excessive paging where the CPU spends more time swapping pages than executing. Working-set based load control or reducing the degree of multiprogramming mitigates it.',
    rubric: '3 marks for the definition, 2 for a valid mitigation.',
  },
];

const ESSAY_SAMPLES = [
  'Pessimistic control locks rows up front, optimistic control validates at commit time and retries on conflict.',
  'Locks are taken before reading. Optimistic assumes no conflict and checks versions later.',
  'It is about locking. One locks early, the other one checks at the end.',
  'Thrashing happens when page faults dominate execution; limiting multiprogramming helps.',
  'The process keeps swapping pages so the CPU utilisation drops sharply.',
];

async function buildExam({ title, subject, teacher, questions, durationMinutes, status }) {
  const exam = await Exam.create({
    title,
    subject,
    description: `Auto-seeded ${subject} assessment for demo purposes.`,
    createdBy: teacher._id,
    status,
    durationMinutes,
    startsAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
    endsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
    settings: { shuffleQuestions: true, showResultImmediately: false, negativeMarking: 0, maxAttempts: 1 },
  });

  const created = await Question.create(
    questions.map((q, index) => ({ ...q, exam: exam._id, order: index }))
  );

  exam.totalMarks = created.reduce((sum, q) => sum + q.marks, 0);
  exam.passingMarks = Math.round(exam.totalMarks * 0.4);
  await exam.save();

  return { exam, questions: created };
}

/** Picks a plausible response for a question, with skill varying per student. */
function fakeResponse(question, skill) {
  const smart = Math.random() < skill;

  switch (question.type) {
    case 'mcq':
    case 'true-false': {
      const correct = question.options.find((o) => o.isCorrect);
      if (smart) return correct.key;
      return pick(question.options.filter((o) => !o.isCorrect)).key;
    }
    case 'multi-select': {
      const correct = question.options.filter((o) => o.isCorrect).map((o) => o.key);
      if (smart) return correct;
      return [pick(question.options).key];
    }
    case 'numeric':
      return smart ? question.numericAnswer : question.numericAnswer + pick([-50, -8, 12, 100]);
    default:
      return Math.random() < 0.08 ? null : pick(ESSAY_SAMPLES);
  }
}

async function seedSubmissions({ exam, questions }, students, teacher) {
  const questionsById = new Map(questions.map((q) => [String(q._id), q]));
  const docs = [];

  students.forEach((student, index) => {
    const skill = 0.35 + Math.random() * 0.6;
    const startedAt = new Date(Date.now() - (index + 1) * 60 * 1000);
    const timeSpent = Math.round(exam.durationMinutes * 60 * (0.45 + Math.random() * 0.5));

    const submission = new Submission({
      exam: exam._id,
      student: student._id,
      attempt: 1,
      status: 'submitted',
      startedAt,
      submittedAt: new Date(startedAt.getTime() + timeSpent * 1000),
      timeSpentSeconds: timeSpent,
      answers: questions.map((q) => ({
        question: q._id,
        type: q.type,
        topic: q.topic,
        maxMarks: q.marks,
        response: fakeResponse(q, skill),
      })),
    });

    gradeSubmission(submission, questionsById, exam);

    // Leave roughly a third of the class waiting on manual evaluation so the
    // grading console has a realistic backlog.
    const evaluateNow = index % 3 !== 0;
    if (evaluateNow) {
      submission.answers.forEach((answer) => {
        if (answer.autoGraded) return;
        const quality = Math.random() < skill ? 0.6 + Math.random() * 0.4 : Math.random() * 0.6;
        answer.awardedMarks = Number((answer.maxMarks * quality).toFixed(1));
        answer.needsReview = false;
        answer.gradedBy = teacher._id;
        answer.gradedAt = new Date();
        answer.comments = [
          {
            author: teacher._id,
            authorName: teacher.name,
            body: quality > 0.7 ? 'Clear reasoning, well presented.' : 'Partially correct — expand the justification.',
            createdAt: new Date(),
          },
        ];
      });
      submission.evaluatedBy = teacher._id;
      submission.evaluatedAt = new Date();
      submission.overallComment = 'Evaluated in the seeded batch run.';
    }

    recomputeTotals(submission, exam.totalMarks);
    docs.push(submission);
  });

  await Submission.insertMany(docs);

  const graded = docs.filter((d) => d.status === 'graded').length;
  const average = docs.reduce((sum, d) => sum + d.totalScore, 0) / docs.length;
  await Exam.findByIdAndUpdate(exam._id, {
    $set: {
      'stats.submissionCount': docs.length,
      'stats.gradedCount': graded,
      'stats.averageScore': Number(average.toFixed(2)),
      'stats.lastGradedAt': new Date(),
    },
  });

  return { total: docs.length, graded, pending: docs.length - graded };
}

async function main() {
  await connectDB();
  console.log('[seed] clearing existing collections');
  await Promise.all([
    User.deleteMany({}),
    Exam.deleteMany({}),
    Question.deleteMany({}),
    Submission.deleteMany({}),
  ]);

  const passwordHash = await User.hashPassword(PASSWORD);

  const admin = await User.create({
    name: 'System Admin',
    email: 'admin@campus.edu',
    passwordHash,
    role: 'admin',
    department: 'Administration',
  });

  const teacher = await User.create({
    name: 'Dr. Priya Rao',
    email: 'teacher@campus.edu',
    passwordHash,
    role: 'teacher',
    department: 'Computer Engineering',
  });

  const studentDocs = Array.from({ length: STUDENT_COUNT }, (_, i) => ({
    name: `${pick(FIRST)} ${pick(LAST)}`,
    email: `student${String(i + 1).padStart(3, '0')}@campus.edu`,
    passwordHash,
    role: 'student',
    rollNumber: `CE22${String(i + 1).padStart(3, '0')}`,
    department: 'Computer Engineering',
  }));
  const students = await User.insertMany(studentDocs);
  console.log(`[seed] created ${students.length} students (login student001@campus.edu / ${PASSWORD})`);

  const dbms = await buildExam({
    title: 'DBMS Mid-Semester Examination',
    subject: 'Database Management Systems',
    teacher,
    questions: dbmsQuestions,
    durationMinutes: 90,
    status: 'published',
  });

  const os = await buildExam({
    title: 'Operating Systems Unit Test 1',
    subject: 'Operating Systems',
    teacher,
    questions: osQuestions,
    durationMinutes: 45,
    status: 'published',
  });

  const dbmsStats = await seedSubmissions(dbms, students, teacher);
  const osStats = await seedSubmissions(os, students.slice(0, Math.ceil(students.length * 0.7)), teacher);

  console.log('[seed] done');
  console.table({
    [dbms.exam.title]: { totalMarks: dbms.exam.totalMarks, ...dbmsStats },
    [os.exam.title]: { totalMarks: os.exam.totalMarks, ...osStats },
  });
  console.log('\nAccounts');
  console.log(`  admin    ${admin.email}   / ${PASSWORD}`);
  console.log(`  teacher  ${teacher.email} / ${PASSWORD}`);
  console.log(`  student  ${students[0].email} / ${PASSWORD}`);

  await disconnectDB();
}

main().catch(async (err) => {
  console.error('[seed] failed', err);
  await mongoose.connection.close().catch(() => {});
  process.exit(1);
});
