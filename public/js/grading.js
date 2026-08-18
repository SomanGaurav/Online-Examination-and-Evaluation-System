import { api, requireRole, mountNav, el, els, escapeHtml, toast, renderResponse } from './api.js';

const user = requireRole('teacher', 'admin');
const examId = new URLSearchParams(location.search).get('examId');
if (!examId) location.replace('/teacher.html');

let exam = null;
let questions = [];
let currentQuestionId = null;

if (user) {
  mountNav(el('#topbar'), user, [{ href: '/teacher.html', label: 'Exams', active: true }]);
  init();
}

function statCard(label, value) {
  return `<div class="stat"><div class="stat-label">${label}</div><div class="stat-value">${value}</div></div>`;
}

async function init() {
  try {
    exam = await api(`/exams/${examId}`);
    questions = exam.questions;

    el('#examTitle').textContent = exam.title;
    el('#examMeta').textContent = `${exam.subject} · ${exam.totalMarks} marks · ${exam.stats?.submissionCount ?? 0} submissions`;

    el('#questionSelect').innerHTML = questions
      .sort((a, b) => a.order - b.order)
      .map((q, i) => `<option value="${q.id}">Q${i + 1} · ${truncate(q.prompt, 60)} (${q.marks} marks)</option>`)
      .join('');

    await refreshStats();

    if (questions.length) {
      currentQuestionId = questions[0].id;
      await loadQueue();
    }
  } catch (err) {
    toast(err.message, 'error');
  }

  el('#questionSelect').addEventListener('change', async (e) => {
    currentQuestionId = e.target.value;
    await loadQueue();
  });
  el('#pendingOnlyToggle').addEventListener('change', loadQueue);
  el('#saveDraftBtn').addEventListener('click', () => saveBatch(false));
  el('#saveAndPublishBtn').addEventListener('click', () => saveBatch(true));
  el('#applyToAllBtn').addEventListener('click', applyFirstMarkToAll);
  el('#rerunAutoBtn').addEventListener('click', rerunAutoGrade);
  el('#publishBtn').addEventListener('click', publishAll);
}

function truncate(text, n) {
  return text.length > n ? `${text.slice(0, n - 1)}…` : text;
}

async function refreshStats() {
  const overview = await api(`/reports/exams/${examId}/overview`);
  el('#stats').innerHTML = [
    statCard('Submissions', overview.counts.submissions),
    statCard('Graded', overview.counts.graded),
    statCard('Pending evaluation', overview.counts.pendingEvaluation),
    statCard('Average score', `${overview.scores.average} / ${exam.totalMarks}`),
  ].join('');
}

async function loadQueue() {
  const host = el('#queueHost');
  host.innerHTML = '<p class="muted small">Loading responses…</p>';
  el('#batchBar').hidden = true;

  try {
    const pendingOnly = el('#pendingOnlyToggle').checked;
    const data = await api(
      `/grading/exams/${examId}/questions/${currentQuestionId}/queue?limit=500&pendingOnly=${pendingOnly}`
    );
    renderQueue(data);
  } catch (err) {
    host.innerHTML = `<p class="muted small">${escapeHtml(err.message)}</p>`;
  }
}

function renderQueue(data) {
  const { question, responses } = data;
  const host = el('#queueHost');

  if (!responses.length) {
    host.innerHTML = '<div class="empty">Nothing to grade here — everyone is scored for this question.</div>';
    return;
  }

  const showOptions = ['mcq', 'multi-select', 'true-false'].includes(question.type);
  const modelBlock =
    question.modelAnswer || question.rubric
      ? `<div class="card" style="background:var(--accent-soft); border-color:var(--accent); margin-bottom:.75rem">
          ${question.modelAnswer ? `<div><strong>Model answer:</strong> ${escapeHtml(question.modelAnswer)}</div>` : ''}
          ${question.rubric ? `<div class="small muted" style="margin-top:.25rem"><strong>Rubric:</strong> ${escapeHtml(question.rubric)}</div>` : ''}
        </div>`
      : '';

  host.innerHTML =
    modelBlock +
    responses
      .map((r) => {
        const correctText = showOptions
          ? question.options
              .filter((o) => o.isCorrect)
              .map((o) => o.text)
              .join(', ')
          : '';
        return `<div class="answer-card" data-submission="${r.submissionId}">
          <div class="answer-head">
            <div>
              <strong>${escapeHtml(r.student?.name || 'Unknown')}</strong>
              ${r.student?.rollNumber ? `<span class="muted small"> (${escapeHtml(r.student.rollNumber)})</span>` : ''}
            </div>
            <span class="badge badge-${r.status}">${r.status.replace('-', ' ')}</span>
          </div>
          <div class="answer-body">${renderResponse(r.response)}</div>
          ${showOptions ? `<div class="small muted" style="margin-bottom:.5rem">Correct: ${escapeHtml(correctText)}</div>` : ''}
          <div class="grade-controls">
            <input type="number" class="marks-input" min="0" max="${question.marks}" step="0.5"
                   placeholder="/ ${question.marks}" value="${r.awardedMarks ?? ''}" />
            <textarea class="comment-input" placeholder="Optional comment…"></textarea>
          </div>
          ${(r.comments || []).map((c) => `<div class="comment">${escapeHtml(c.body)} — <em>${escapeHtml(c.authorName || '')}</em></div>`).join('')}
        </div>`;
      })
      .join('');

  el('#batchBar').hidden = false;
  updateBatchSummary();

  els('.marks-input', host).forEach((input) => input.addEventListener('input', updateBatchSummary));
}

function updateBatchSummary() {
  const cards = els('.answer-card');
  const filled = cards.filter((c) => c.querySelector('.marks-input').value !== '').length;
  el('#batchSummary').textContent = `${filled} of ${cards.length} scored in this batch`;
}

function applyFirstMarkToAll() {
  const cards = els('.answer-card');
  if (!cards.length) return;
  const firstValue = cards[0].querySelector('.marks-input').value;
  if (firstValue === '') return toast('Enter a mark on the first response first', 'error');
  cards.forEach((card) => {
    const input = card.querySelector('.marks-input');
    if (input.value === '') input.value = firstValue;
  });
  updateBatchSummary();
}

async function saveBatch(publish) {
  const cards = els('.answer-card');
  const entries = cards
    .map((card) => {
      const marksValue = card.querySelector('.marks-input').value;
      const comment = card.querySelector('.comment-input').value.trim();
      if (marksValue === '' && !comment) return null;
      return {
        submissionId: card.dataset.submission,
        marks: marksValue === '' ? undefined : Number(marksValue),
        comment: comment || undefined,
      };
    })
    .filter(Boolean);

  if (!entries.length) return toast('Enter at least one mark', 'error');

  const button = publish ? el('#saveAndPublishBtn') : el('#saveDraftBtn');
  button.disabled = true;

  try {
    const result = await api(`/grading/exams/${examId}/questions/${currentQuestionId}/bulk`, {
      method: 'PATCH',
      body: { entries },
    });

    if (result.failures.length) {
      toast(`${result.failures.length} row(s) failed — see console`, 'error');
      console.warn('Grading failures', result.failures);
    } else {
      toast(`Saved marks for ${result.graded} submission(s)`, 'success');
    }

    if (publish) await publishAll(true);
    await refreshStats();
    await loadQueue();
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    button.disabled = false;
  }
}

async function rerunAutoGrade() {
  el('#rerunAutoBtn').disabled = true;
  try {
    const result = await api(`/grading/exams/${examId}/auto-grade`, { method: 'POST' });
    toast(`Re-scored ${result.rescored} submission(s)`, 'success');
    await refreshStats();
    await loadQueue();
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    el('#rerunAutoBtn').disabled = false;
  }
}

async function publishAll(silent) {
  if (!silent) el('#publishBtn').disabled = true;
  try {
    const result = await api(`/grading/exams/${examId}/publish`, { method: 'POST', body: {} });
    if (!silent) toast(`Published ${result.published} result(s)`, 'success');
    await refreshStats();
  } catch (err) {
    if (!silent) toast(err.message, 'error');
  } finally {
    if (!silent) el('#publishBtn').disabled = false;
  }
}
