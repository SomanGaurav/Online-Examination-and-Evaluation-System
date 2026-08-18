import { api, requireRole, mountNav, el, escapeHtml, toast, formatDateTime } from './api.js';

const user = requireRole('teacher', 'admin');
if (user) {
  mountNav(el('#topbar'), user, [{ href: '/teacher.html', label: 'Exams', active: true }]);
  load();
}

async function load() {
  try {
    const exams = await api('/exams?mine=true&limit=100');
    render(exams);
  } catch (err) {
    toast(err.message, 'error');
  }
}

function render(exams) {
  const host = el('#examList');
  if (!exams.length) {
    host.innerHTML = '<div class="empty">No exams yet — create your first one.</div>';
    return;
  }

  host.innerHTML = `<table>
    <thead><tr>
      <th>Title</th><th>Status</th><th class="right">Submissions</th>
      <th class="right">Graded</th><th class="right">Avg score</th><th>Updated</th><th></th>
    </tr></thead>
    <tbody>
      ${exams
        .map(
          (e) => `<tr>
            <td><strong>${escapeHtml(e.title)}</strong><br /><span class="muted small">${escapeHtml(e.subject)}</span></td>
            <td><span class="badge badge-${e.status}">${e.status}</span></td>
            <td class="right">${e.stats?.submissionCount ?? 0}</td>
            <td class="right">${e.stats?.gradedCount ?? 0}</td>
            <td class="right">${e.stats?.averageScore ?? 0}</td>
            <td class="small">${formatDateTime(e.updatedAt)}</td>
            <td class="right">
              <a class="btn btn-sm btn-secondary" href="/exam-builder.html?examId=${e._id}">Edit</a>
              <a class="btn btn-sm btn-secondary" href="/grading.html?examId=${e._id}">Grade</a>
              <a class="btn btn-sm btn-secondary" href="/analytics.html?examId=${e._id}">Analytics</a>
            </td>
          </tr>`
        )
        .join('')}
    </tbody>
  </table>`;
}

const dialog = el('#newExamDialog');
el('#newExamBtn').addEventListener('click', () => dialog.showModal());
el('#cancelNewExam').addEventListener('click', () => dialog.close());

el('#newExamForm').addEventListener('submit', async (event) => {
  if (event.submitter?.id === 'cancelNewExam') return;
  event.preventDefault();
  try {
    const exam = await api('/exams', {
      method: 'POST',
      body: {
        title: el('#feTitle').value.trim(),
        subject: el('#feSubject').value.trim(),
        description: el('#feDescription').value.trim(),
        durationMinutes: Number(el('#feDuration').value),
        passingMarks: Number(el('#fePassing').value) || 0,
      },
    });
    location.href = `/exam-builder.html?examId=${exam._id}`;
  } catch (err) {
    toast(err.message, 'error');
  }
});
