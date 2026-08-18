import { api, download, requireRole, mountNav, el, escapeHtml, toast, formatDateTime } from './api.js';

const user = requireRole('student');
if (user) {
  mountNav(el('#topbar'), user, [
    { href: '/student.html', label: 'Dashboard', active: true },
  ]);
  load();
}

function statCard(label, value, note = '') {
  return `<div class="stat">
    <div class="stat-label">${label}</div>
    <div class="stat-value">${value}</div>
    <div class="stat-note">${note}</div>
  </div>`;
}

async function load() {
  const [exams, results] = await Promise.all([
    api('/exams?limit=50'),
    api('/submissions/mine'),
  ]);

  renderStats(exams, results);
  renderExams(exams);
  renderResults(results);
}

function renderStats(exams, results) {
  const released = results.filter((r) => r.resultAvailable);
  const average = released.length
    ? (released.reduce((sum, r) => sum + r.percentage, 0) / released.length).toFixed(1)
    : '—';
  const pending = results.filter((r) => !r.resultAvailable && r.status !== 'in-progress').length;
  const open = exams.filter((e) => e.isLive && !e.myAttempt).length;

  el('#stats').innerHTML = [
    statCard('Open exams', open, 'available to attempt now'),
    statCard('Attempted', results.length, 'total attempts'),
    statCard('Average score', average === '—' ? '—' : `${average}%`, `${released.length} released`),
    statCard('Awaiting result', pending, 'under evaluation'),
  ].join('');
}

function renderExams(exams) {
  const host = el('#examList');
  if (!exams.length) {
    host.innerHTML = '<div class="empty">No published examinations yet.</div>';
    return;
  }

  host.innerHTML = `<div class="grid grid-2">${exams
    .map((exam) => {
      const attempt = exam.myAttempt;
      const attempted = attempt && attempt.status !== 'in-progress';
      const action = attempted
        ? `<span class="badge badge-${attempt.status}">${attempt.status.replace('-', ' ')}</span>`
        : exam.isLive
          ? `<a class="btn btn-sm" href="/exam.html?examId=${exam._id}">${attempt ? 'Resume' : 'Start'} exam</a>`
          : '<span class="badge badge-closed">closed</span>';

      return `<div class="card">
        <div class="card-head">
          <div>
            <h3>${escapeHtml(exam.title)}</h3>
            <p class="muted small">${escapeHtml(exam.subject)}</p>
          </div>
          ${action}
        </div>
        <p class="small muted">${escapeHtml(exam.description || '')}</p>
        <div class="row small muted" style="margin-top:.5rem">
          <span>⏱ ${exam.durationMinutes} min</span>
          <span>· ${exam.totalMarks} marks</span>
          <span>· pass ${exam.passingMarks}</span>
          <span>· closes ${formatDateTime(exam.endsAt)}</span>
        </div>
      </div>`;
    })
    .join('')}</div>`;
}

function renderResults(results) {
  const host = el('#resultList');
  if (!results.length) {
    host.innerHTML = '<div class="empty">You have not attempted any exam yet.</div>';
    return;
  }

  host.innerHTML = `<table>
    <thead><tr>
      <th>Exam</th><th>Submitted</th><th>Status</th><th class="right">Score</th>
      <th class="right">%</th><th>Grade</th><th class="right">Report</th>
    </tr></thead>
    <tbody>
      ${results
        .map(
          (r) => `<tr>
            <td><strong>${escapeHtml(r.exam?.title || '—')}</strong><br /><span class="muted small">${escapeHtml(r.exam?.subject || '')}</span></td>
            <td class="small">${formatDateTime(r.submittedAt)}</td>
            <td><span class="badge badge-${r.status}">${r.status.replace('-', ' ')}</span></td>
            <td class="right">${r.totalScore === null ? '—' : `${r.totalScore} / ${r.exam?.totalMarks ?? '—'}`}</td>
            <td class="right">${r.percentage === null ? '—' : `${r.percentage}%`}</td>
            <td>${r.grade || '—'}</td>
            <td class="right">
              ${r.resultAvailable
                ? `<div class="row" style="justify-content:flex-end">
                     <a class="btn btn-sm btn-secondary" href="/result.html?submissionId=${r.id}">View</a>
                     <button class="btn btn-sm btn-secondary" data-pdf="${r.exam?._id}">PDF</button>
                   </div>`
                : '<span class="muted small">pending</span>'}
            </td>
          </tr>`
        )
        .join('')}
    </tbody>
  </table>`;

  host.querySelectorAll('[data-pdf]').forEach((button) => {
    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        await download(`/reports/exams/${button.dataset.pdf}/students/${user.id}/report.pdf`, 'report.pdf');
        toast('Report downloaded', 'success');
      } catch (err) {
        toast(err.message, 'error');
      } finally {
        button.disabled = false;
      }
    });
  });
}
