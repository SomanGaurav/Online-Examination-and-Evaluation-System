const PDFDocument = require('pdfkit');

const COLORS = {
  ink: '#1f2937',
  muted: '#6b7280',
  accent: '#2563eb',
  line: '#e5e7eb',
  good: '#15803d',
  bad: '#b91c1c',
};

function newDocument(title, subject) {
  const doc = new PDFDocument({
    size: 'A4',
    margin: 48,
    info: { Title: title, Author: 'Online Examination & Evaluation System', Subject: subject },
  });
  doc.registerFont('body', 'Helvetica');
  doc.registerFont('bold', 'Helvetica-Bold');
  return doc;
}

function header(doc, title, subtitle) {
  doc.font('bold').fontSize(18).fillColor(COLORS.ink).text(title);
  doc.font('body').fontSize(10).fillColor(COLORS.muted).text(subtitle);
  doc.moveDown(0.4);
  const y = doc.y;
  doc.moveTo(doc.page.margins.left, y)
    .lineTo(doc.page.width - doc.page.margins.right, y)
    .strokeColor(COLORS.accent)
    .lineWidth(1.5)
    .stroke();
  doc.moveDown(0.8);
}

function sectionTitle(doc, text) {
  doc.moveDown(0.6);
  doc.font('bold').fontSize(12).fillColor(COLORS.ink).text(text);
  doc.moveDown(0.3);
}

const GRID_ROW_HEIGHT = 32;

function keyValueGrid(doc, pairs, columns = 2) {
  const startX = doc.page.margins.left;
  const usable = doc.page.width - startX - doc.page.margins.right;
  const colWidth = usable / columns;
  const baseY = doc.y;
  const rows = Math.ceil(pairs.length / columns);

  pairs.forEach((pair, index) => {
    const col = index % columns;
    const row = Math.floor(index / columns);
    const x = startX + col * colWidth;
    const y = baseY + row * GRID_ROW_HEIGHT;

    doc.font('body').fontSize(8).fillColor(COLORS.muted)
      .text(String(pair[0]).toUpperCase(), x, y, { width: colWidth - 10 });
    doc.font('bold').fontSize(12).fillColor(pair[2] || COLORS.ink)
      .text(String(pair[1]), x, y + 11, { width: colWidth - 10, lineBreak: false });
  });

  doc.x = startX;
  doc.y = baseY + rows * GRID_ROW_HEIGHT;
}

function table(doc, headings, rows, widths) {
  const startX = doc.page.margins.left;
  const usable = doc.page.width - startX - doc.page.margins.right;
  const cols = widths.map((w) => (w / 100) * usable);

  const drawRow = (cells, opts = {}) => {
    const font = opts.bold ? 'bold' : 'body';
    const top = doc.y;
    let height = 0;

    cells.forEach((cell, i) => {
      const x = startX + cols.slice(0, i).reduce((a, b) => a + b, 0);
      doc.font(font).fontSize(9).fillColor(opts.color || COLORS.ink);
      const cellHeight = doc.heightOfString(String(cell), { width: cols[i] - 8 });
      height = Math.max(height, cellHeight);
      doc.text(String(cell), x + 2, top + 4, { width: cols[i] - 8 });
    });

    doc.y = top + height + 8;
    doc.moveTo(startX, doc.y - 2)
      .lineTo(startX + usable, doc.y - 2)
      .strokeColor(COLORS.line)
      .lineWidth(0.5)
      .stroke();

    if (doc.y > doc.page.height - doc.page.margins.bottom - 60) {
      doc.addPage();
    }
  };

  drawRow(headings, { bold: true, color: COLORS.accent });
  rows.forEach((row) => drawRow(row));
}

function barChart(doc, buckets, { width, height = 110, label } = {}) {
  const startX = doc.page.margins.left;
  const chartWidth = width || doc.page.width - startX - doc.page.margins.right;
  const top = doc.y + 6;
  const max = Math.max(1, ...buckets.map((b) => b.count));
  const gap = 6;
  const barWidth = (chartWidth - gap * (buckets.length - 1)) / buckets.length;

  buckets.forEach((bucket, i) => {
    const barHeight = (bucket.count / max) * height;
    const x = startX + i * (barWidth + gap);
    const y = top + (height - barHeight);
    doc.rect(x, y, barWidth, barHeight).fillColor(COLORS.accent).fillOpacity(0.85).fill();
    doc.fillOpacity(1);
    doc.font('body').fontSize(7).fillColor(COLORS.muted)
      .text(bucket.label, x, top + height + 4, { width: barWidth, align: 'center' });
    if (bucket.count) {
      doc.font('bold').fontSize(7).fillColor(COLORS.ink)
        .text(String(bucket.count), x, y - 9, { width: barWidth, align: 'center' });
    }
  });

  doc.y = top + height + 18;
  if (label) {
    doc.font('body').fontSize(8).fillColor(COLORS.muted).text(label, { align: 'center' });
  }
}

function footer(doc) {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i += 1) {
    doc.switchToPage(i);
    doc.font('body').fontSize(8).fillColor(COLORS.muted).text(
      `Generated ${new Date().toLocaleString()}  ·  Page ${i + 1} of ${range.count}`,
      doc.page.margins.left,
      doc.page.height - 32,
      { width: doc.page.width - doc.page.margins.left - doc.page.margins.right, align: 'center' }
    );
  }
}

/**
 * Streams a single student's report card straight to the HTTP response so a
 * large class export never buffers whole PDFs in memory.
 */
function streamStudentReport(report, stream) {
  const doc = newDocument(`Report card – ${report.student.name}`, report.exam.title);
  doc.pipe(stream);

  header(
    doc,
    'Student Performance Report',
    `${report.exam.title} · ${report.exam.subject} · generated ${new Date(report.generatedAt).toLocaleString()}`
  );

  keyValueGrid(doc, [
    ['Student', report.student.name],
    ['Roll number', report.student.rollNumber || '—'],
    ['Email', report.student.email],
    ['Department', report.student.department || '—'],
  ]);

  sectionTitle(doc, 'Result summary');
  keyValueGrid(
    doc,
    [
      ['Score', `${report.submission.totalScore} / ${report.exam.totalMarks}`],
      ['Percentage', `${report.submission.percentage}%`],
      ['Grade', report.submission.grade, report.submission.percentage >= 40 ? COLORS.good : COLORS.bad],
      ['Class average', report.cohort.classAverage],
      ['Percentile', `${report.cohort.percentile}`],
      ['Rank', report.cohort.rank ? `${report.cohort.rank} of ${report.cohort.size}` : '—'],
      ['Time taken', `${report.submission.timeSpentMinutes} min`],
      ['Auto / manual', `${report.submission.autoScore} / ${report.submission.manualScore}`],
    ],
    4
  );

  if (report.topics.length) {
    sectionTitle(doc, 'Topic-wise performance');
    table(
      doc,
      ['Topic', 'Questions', 'Earned', 'Available', 'Accuracy'],
      report.topics.map((t) => [t.topic, t.questions, t.earned, t.available, `${t.accuracy}%`]),
      [40, 15, 15, 15, 15]
    );
  }

  sectionTitle(doc, 'Question-wise evaluation');
  table(
    doc,
    ['#', 'Question', 'Type', 'Marks', 'Awarded'],
    report.answers.map((a) => [
      a.order + 1,
      a.prompt.length > 120 ? `${a.prompt.slice(0, 117)}…` : a.prompt,
      a.type,
      a.maxMarks,
      a.awardedMarks === null ? 'pending' : a.awardedMarks,
    ]),
    [6, 58, 14, 10, 12]
  );

  const remarks = report.answers.filter((a) => a.comments.length);
  if (remarks.length) {
    sectionTitle(doc, "Evaluator's remarks");
    remarks.forEach((answer) => {
      doc.font('bold').fontSize(9).fillColor(COLORS.ink).text(`Q${answer.order + 1}`);
      answer.comments.forEach((comment) => {
        doc.font('body').fontSize(9).fillColor(COLORS.muted)
          .text(`• ${comment.body} — ${comment.author || 'evaluator'}`, { indent: 10 });
      });
      doc.moveDown(0.3);
    });
  }

  if (report.submission.overallComment) {
    sectionTitle(doc, 'Overall feedback');
    doc.font('body').fontSize(10).fillColor(COLORS.ink).text(report.submission.overallComment);
  }

  footer(doc);
  doc.end();
  return doc;
}

/** Class-level analytics report: distribution chart, question difficulty, ranking. */
function streamExamReport({ overview, questions, topics, ranking }, stream) {
  const doc = newDocument(`Exam analytics – ${overview.exam.title}`, overview.exam.subject);
  doc.pipe(stream);

  header(
    doc,
    'Exam Analytics Report',
    `${overview.exam.title} · ${overview.exam.subject} · generated ${new Date(overview.generatedAt).toLocaleString()}`
  );

  keyValueGrid(
    doc,
    [
      ['Submissions', overview.counts.submissions],
      ['Graded', overview.counts.graded],
      ['Pending evaluation', overview.counts.pendingEvaluation],
      ['In progress', overview.counts.inProgress],
      ['Average score', `${overview.scores.average} / ${overview.exam.totalMarks}`],
      ['Median (%)', overview.scores.median],
      ['Pass rate', `${overview.passRate}%`],
      ['Avg. time', `${overview.averageTimeMinutes} min`],
    ],
    4
  );

  sectionTitle(doc, 'Score distribution (%)');
  barChart(doc, overview.distribution, { label: 'Students per percentage band' });

  if (topics.length) {
    sectionTitle(doc, 'Topic-wise class accuracy');
    table(
      doc,
      ['Topic', 'Questions', 'Earned', 'Available', 'Accuracy'],
      topics.map((t) => [t.topic, t.questions, t.earned, t.available, `${t.accuracy}%`]),
      [40, 15, 15, 15, 15]
    );
  }

  sectionTitle(doc, 'Question difficulty');
  table(
    doc,
    ['#', 'Question', 'Avg', 'Max', 'Full', 'Zero', 'Difficulty'],
    questions.map((q) => [
      q.order + 1,
      q.prompt.length > 80 ? `${q.prompt.slice(0, 77)}…` : q.prompt,
      q.averageMarks,
      q.maxMarks,
      q.fullMarks,
      q.zeroMarks,
      q.difficulty,
    ]),
    [5, 45, 9, 9, 8, 8, 16]
  );

  if (ranking.length) {
    doc.addPage();
    sectionTitle(doc, 'Class ranking');
    table(
      doc,
      ['Rank', 'Student', 'Roll no.', 'Score', '%', 'Grade'],
      ranking.map((r) => [r.rank, r.name, r.rollNumber || '—', r.totalScore, r.percentage, r.grade]),
      [10, 38, 18, 12, 12, 10]
    );
  }

  footer(doc);
  doc.end();
  return doc;
}

module.exports = { streamStudentReport, streamExamReport };
