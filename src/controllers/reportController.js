const Submission = require('../models/Submission');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const analytics = require('../services/analytics');
const { streamStudentReport, streamExamReport } = require('../services/pdfReport');
const bus = require('../services/eventBus');

function slug(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

const examOverview = asyncHandler(async (req, res) => {
  res.json({ ok: true, data: await analytics.examOverview(req.params.examId) });
});

const examQuestions = asyncHandler(async (req, res) => {
  res.json({ ok: true, data: await analytics.questionBreakdown(req.params.examId) });
});

const examTopics = asyncHandler(async (req, res) => {
  res.json({ ok: true, data: await analytics.topicBreakdown(req.params.examId) });
});

const examLeaderboard = asyncHandler(async (req, res) => {
  const limit = Math.min(200, Number(req.query.limit) || 50);
  res.json({ ok: true, data: await analytics.leaderboard(req.params.examId, limit) });
});

const gradingProgress = asyncHandler(async (req, res) => {
  res.json({ ok: true, data: await analytics.gradingProgress(req.params.examId) });
});

/** Full dashboard payload in one round trip. */
const examDashboard = asyncHandler(async (req, res) => {
  const { examId } = req.params;
  const [overview, questions, topics, ranking, progress] = await Promise.all([
    analytics.examOverview(examId),
    analytics.questionBreakdown(examId),
    analytics.topicBreakdown(examId),
    analytics.leaderboard(examId, 20),
    analytics.gradingProgress(examId),
  ]);
  res.json({ ok: true, data: { overview, questions, topics, ranking, progress } });
});

/**
 * Server-Sent Events stream.
 *
 * Pushes a fresh analytics snapshot whenever a grading batch lands, so the
 * teacher dashboard updates live while evaluation is still in progress.
 */
const liveStream = asyncHandler(async (req, res) => {
  const { examId } = req.params;

  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();

  const send = (event, payload) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  const pushSnapshot = async (reason) => {
    try {
      const [overview, questions] = await Promise.all([
        analytics.examOverview(examId),
        analytics.questionBreakdown(examId),
      ]);
      send('snapshot', { reason, overview, questions });
    } catch (err) {
      send('error', { message: err.message });
    }
  };

  await pushSnapshot('connected');

  const unsubscribe = bus.subscribe(examId, (event) => {
    pushSnapshot(event.type);
  });

  // Comment frames keep proxies from closing an idle stream.
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 25000);

  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
    res.end();
  });
});

/* ------------------------------------ PDF ------------------------------------ */

const studentReportPdf = asyncHandler(async (req, res) => {
  const { examId, studentId } = req.params;

  if (req.user.role === 'student' && String(req.user._id) !== String(studentId)) {
    throw ApiError.forbidden();
  }

  const report = await analytics.studentReport(examId, studentId);

  if (req.user.role === 'student' && !['graded', 'published'].includes(report.submission.status)) {
    throw ApiError.forbidden('Results have not been released yet');
  }

  const filename = `report-${slug(report.exam.title)}-${slug(report.student.name)}.pdf`;
  res.set({
    'Content-Type': 'application/pdf',
    'Content-Disposition': `attachment; filename="${filename}"`,
  });
  streamStudentReport(report, res);
});

const examReportPdf = asyncHandler(async (req, res) => {
  const { examId } = req.params;
  const [overview, questions, topics, ranking] = await Promise.all([
    analytics.examOverview(examId),
    analytics.questionBreakdown(examId),
    analytics.topicBreakdown(examId),
    analytics.leaderboard(examId, 200),
  ]);

  const filename = `analytics-${slug(overview.exam.title)}.pdf`;
  res.set({
    'Content-Type': 'application/pdf',
    'Content-Disposition': `attachment; filename="${filename}"`,
  });
  streamExamReport({ overview, questions, topics, ranking }, res);
});

/**
 * CSV export of the marks sheet — handy for pasting into an institutional LMS.
 * Rows are streamed so a large class does not build a big string in memory.
 */
const marksSheetCsv = asyncHandler(async (req, res) => {
  const { examId } = req.params;
  const overview = await analytics.examOverview(examId);

  res.set({
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="marks-${slug(overview.exam.title)}.csv"`,
  });
  res.write('roll_number,name,email,status,auto_score,manual_score,total_score,percentage,grade,submitted_at\n');

  const cursor = Submission.find({ exam: examId })
    .populate('student', 'name email rollNumber')
    .sort({ totalScore: -1 })
    .cursor();

  for await (const sub of cursor) {
    const cells = [
      sub.student?.rollNumber || '',
      sub.student?.name || '',
      sub.student?.email || '',
      sub.status,
      sub.autoScore,
      sub.manualScore,
      sub.totalScore,
      sub.percentage,
      sub.grade || '',
      sub.submittedAt ? sub.submittedAt.toISOString() : '',
    ];
    res.write(`${cells.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')}\n`);
  }

  res.end();
});

module.exports = {
  examOverview,
  examQuestions,
  examTopics,
  examLeaderboard,
  gradingProgress,
  examDashboard,
  liveStream,
  studentReportPdf,
  examReportPdf,
  marksSheetCsv,
};
