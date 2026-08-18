import { api, download, requireRole, mountNav, el, escapeHtml, toast, renderResponse } from './api.js';

const user = requireRole('student', 'teacher', 'admin');
const submissionId = new URLSearchParams(location.search).get('submissionId');

if (!submissionId) location.replace('/student.html');

if (user) {
  mountNav(el('#topbar'), user, [
    { href: user.role === 'student' ? '/student.html' : '/teacher.html', label: 'Dashboard' },
  ]);
  load();
}

function statCard(label, value) {
  return `<div class="stat"><div class="stat-label">${label}</div><div class="stat-value">${value}</div></div>`;
}

async function load() {
  try {
    const data = await api(`/submissions/${submissionId}`);
    render(data);
  } catch (err) {
    toast(err.message, 'error');
  }
}

function render(sub) {
  el('#examTitle').textContent = sub.exam.title;
  el('#examMeta').textContent = `${sub.exam.subject} · ${sub.student.name}${sub.student.rollNumber ? ` (${sub.student.rollNumber})` : ''}`;

  el('#stats').innerHTML = [
    statCard('Total score', `${sub.totalScore} / ${sub.exam.totalMarks}`),
    statCard('Percentage', `${sub.percentage}%`),
    statCard('Grade', sub.grade || '—'),
    statCard('Status', sub.status.replace('-', ' ')),
  ].join('');

  el('#answers').innerHTML = sub.answers
    .map(
      (a) => `<div class="answer-card">
        <div class="answer-head">
          <div>
            <strong>Q${a.order + 1}.</strong> ${escapeHtml(a.prompt)}
            <div class="small muted">${a.type} · ${a.topic} · max ${a.maxMarks} marks</div>
          </div>
          <span class="badge ${a.awardedMarks === null ? 'badge-submitted' : 'badge-graded'}">
            ${a.awardedMarks === null ? 'pending' : `${a.awardedMarks} / ${a.maxMarks}`}
          </span>
        </div>
        ${a.options?.length ? renderOptions(a) : `<div class="answer-body">${renderResponse(a.response)}</div>`}
        ${(a.comments || []).map((c) => `<div class="comment">${escapeHtml(c.body)} — <em>${escapeHtml(c.author)}</em></div>`).join('')}
      </div>`
    )
    .join('');

  el('#pdfBtn').addEventListener('click', async () => {
    el('#pdfBtn').disabled = true;
    try {
      await download(`/reports/exams/${sub.exam._id}/students/${sub.student._id}/report.pdf`, 'report.pdf');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      el('#pdfBtn').disabled = false;
    }
  });
}

function renderOptions(answer) {
  const chosen = Array.isArray(answer.response) ? answer.response : [answer.response];
  return `<div style="margin-bottom:.6rem">${answer.options
    .map((opt) => {
      const isChosen = chosen.includes(opt.key);
      const classes = ['option'];
      if (opt.isCorrect !== undefined && opt.isCorrect) classes.push('correct');
      return `<div class="${classes.join(' ')}" style="cursor:default">
        <span>${isChosen ? '☑' : '☐'}</span>
        <span>${escapeHtml(opt.text)}</span>
      </div>`;
    })
    .join('')}</div>`;
}
