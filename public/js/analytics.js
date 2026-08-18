import { api, download, session, requireRole, mountNav, el, escapeHtml, toast } from './api.js';

const user = requireRole('teacher', 'admin');
const examId = new URLSearchParams(location.search).get('examId');
if (!examId) location.replace('/teacher.html');

let examMeta = null;

if (user) {
  mountNav(el('#topbar'), user, [{ href: '/teacher.html', label: 'Exams', active: true }]);
  init();
}

function statCard(label, value, note = '') {
  return `<div class="stat">
    <div class="stat-label">${label}</div>
    <div class="stat-value">${value}</div>
    <div class="stat-note">${note}</div>
  </div>`;
}

async function init() {
  try {
    const dashboard = await api(`/reports/exams/${examId}/dashboard`);
    examMeta = dashboard.overview.exam;
    el('#examTitle').textContent = examMeta.title;
    renderOverview(dashboard.overview);
    renderQuestions(dashboard.questions);
    renderTopics(dashboard.topics);
    renderLeaderboard(dashboard.ranking);
  } catch (err) {
    toast(err.message, 'error');
  }

  connectLiveStream();

  el('#csvBtn').addEventListener('click', async () => {
    try {
      await download(`/reports/exams/${examId}/export.csv`, 'marks.csv');
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  el('#pdfBtn').addEventListener('click', async () => {
    el('#pdfBtn').disabled = true;
    try {
      await download(`/reports/exams/${examId}/export.pdf`, 'analytics.pdf');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      el('#pdfBtn').disabled = false;
    }
  });
}

function connectLiveStream() {
  const url = `/api/reports/exams/${examId}/live?access_token=${encodeURIComponent(session.token)}`;
  const source = new EventSource(url);

  source.addEventListener('open', () => {
    el('#liveState').textContent = 'Live — updates as grading happens';
  });

  source.addEventListener('snapshot', (event) => {
    const { overview, questions } = JSON.parse(event.data);
    renderOverview(overview);
    renderQuestions(questions);
    el('#liveState').textContent = `Live · last update ${new Date().toLocaleTimeString()}`;
  });

  source.onerror = () => {
    el('#liveState').textContent = 'Reconnecting…';
  };

  window.addEventListener('beforeunload', () => source.close());
}

function renderOverview(overview) {
  el('#stats').innerHTML = [
    statCard('Submissions', overview.counts.submissions, `${overview.counts.inProgress} in progress`),
    statCard('Graded', overview.counts.graded, `${overview.counts.pendingEvaluation} pending`),
    statCard('Average score', `${overview.scores.average} / ${overview.exam.totalMarks}`, `median ${overview.scores.median}%`),
    statCard('Pass rate', `${overview.passRate}%`, `avg time ${overview.averageTimeMinutes} min`),
  ].join('');

  const max = Math.max(1, ...overview.distribution.map((b) => b.count));
  el('#distChart').innerHTML = overview.distribution
    .map(
      (b) => `<div class="bar-col">
        <span class="bar-count">${b.count || ''}</span>
        <div class="bar" style="height:${(b.count / max) * 100}%"></div>
        <span class="bar-label">${b.label}</span>
      </div>`
    )
    .join('');
}

function renderTopics(topics) {
  const host = el('#topicList');
  if (!topics.length) {
    host.innerHTML = '<p class="muted small">No graded topics yet.</p>';
    return;
  }
  host.innerHTML = topics
    .map(
      (t) => `<div style="margin-bottom:.65rem">
        <div class="row" style="justify-content:space-between">
          <span>${escapeHtml(t.topic)}</span>
          <span class="small muted">${t.accuracy}%</span>
        </div>
        <div class="meter"><span style="width:${t.accuracy}%"></span></div>
      </div>`
    )
    .join('');
}

function renderQuestions(questions) {
  const host = el('#questionTable');
  if (!questions.length) {
    host.innerHTML = '<p class="muted small">No responses yet.</p>';
    return;
  }
  host.innerHTML = `<table>
    <thead><tr><th>#</th><th>Question</th><th>Topic</th><th class="right">Avg</th><th class="right">Max</th><th class="right">Full</th><th class="right">Zero</th><th class="right">Pending</th><th>Difficulty</th></tr></thead>
    <tbody>
      ${questions
        .map(
          (q) => `<tr>
            <td>${q.order + 1}</td>
            <td>${escapeHtml(q.prompt)}</td>
            <td class="small muted">${escapeHtml(q.topic)}</td>
            <td class="right">${q.averageMarks}</td>
            <td class="right">${q.maxMarks}</td>
            <td class="right">${q.fullMarks}</td>
            <td class="right">${q.zeroMarks}</td>
            <td class="right">${q.pendingReview}</td>
            <td><span class="badge badge-${q.difficulty}">${q.difficulty}</span></td>
          </tr>`
        )
        .join('')}
    </tbody>
  </table>`;
}

function renderLeaderboard(rows) {
  const host = el('#leaderboard');
  if (!rows.length) {
    host.innerHTML = '<p class="muted small">No graded submissions yet.</p>';
    return;
  }
  host.innerHTML = `<table>
    <thead><tr><th>Rank</th><th>Student</th><th>Roll no.</th><th class="right">Score</th><th class="right">%</th><th>Grade</th><th class="right">Time</th></tr></thead>
    <tbody>
      ${rows
        .map(
          (r) => `<tr>
            <td>${r.rank}</td>
            <td>${escapeHtml(r.name)}</td>
            <td class="small muted">${escapeHtml(r.rollNumber || '—')}</td>
            <td class="right">${r.totalScore}</td>
            <td class="right">${r.percentage}%</td>
            <td>${r.grade}</td>
            <td class="right small muted">${r.timeSpentMinutes} min</td>
          </tr>`
        )
        .join('')}
    </tbody>
  </table>`;
}
