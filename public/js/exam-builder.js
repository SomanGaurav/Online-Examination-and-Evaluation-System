import { api, requireRole, mountNav, el, els, escapeHtml, toast } from './api.js';

const user = requireRole('teacher', 'admin');
const examId = new URLSearchParams(location.search).get('examId');
if (!examId) location.replace('/teacher.html');

if (user) {
  mountNav(el('#topbar'), user, [{ href: '/teacher.html', label: 'Exams', active: true }]);
  init();
}

const OPTION_TYPES = ['mcq', 'multi-select', 'true-false'];

function init() {
  renderOptionRows(2);
  el('#qType').addEventListener('change', onTypeChange);
  onTypeChange();

  el('#questionForm').addEventListener('submit', onAddQuestion);
  el('#statusSelect').addEventListener('change', onStatusChange);

  loadExam();
}

function onTypeChange() {
  const type = el('#qType').value;
  const isOptionType = OPTION_TYPES.includes(type);
  el('#optionsHost').hidden = !isOptionType;
  el('#numericField').hidden = type !== 'numeric';
  el('#essayField').hidden = !['short-answer', 'long-answer'].includes(type);

  if (type === 'true-false') {
    el('#optionsHost').innerHTML = `
      <div class="field"><label>Correct answer</label>
        <select id="tfAnswer"><option value="true">True</option><option value="false">False</option></select>
      </div>`;
  } else if (isOptionType) {
    renderOptionRows(2);
  }
}

function renderOptionRows(count) {
  const rows = Array.from({ length: count }, (_, i) => optionRowHtml(i));
  el('#optionsHost').innerHTML = `
    <label>Options</label>
    <div id="optionRows">${rows.join('')}</div>
    <button type="button" class="btn btn-sm btn-secondary" id="addOptionBtn" style="margin:.4rem 0 .75rem">+ Add option</button>
  `;
  el('#addOptionBtn').addEventListener('click', () => {
    const wrap = el('#optionRows');
    wrap.insertAdjacentHTML('beforeend', optionRowHtml(wrap.children.length));
  });
}

function optionRowHtml(index) {
  const multi = el('#qType')?.value === 'multi-select';
  return `<div class="row" style="margin-bottom:.4rem">
    <input type="${multi ? 'checkbox' : 'radio'}" name="correctOpt" style="width:auto" />
    <input type="text" class="opt-text" placeholder="Option ${index + 1}" style="flex:1" />
  </div>`;
}

async function onAddQuestion(event) {
  event.preventDefault();
  const type = el('#qType').value;
  const marks = Number(el('#qMarks').value);
  const topic = el('#qTopic').value.trim() || 'general';
  const prompt = el('#qPrompt').value.trim();

  const payload = { type, marks, topic, prompt };

  if (type === 'true-false') {
    const answer = el('#tfAnswer').value;
    payload.options = [
      { key: 'true', text: 'True', isCorrect: answer === 'true' },
      { key: 'false', text: 'False', isCorrect: answer === 'false' },
    ];
  } else if (OPTION_TYPES.includes(type)) {
    const rows = els('#optionRows > div');
    const options = rows
      .map((row, i) => {
        const text = row.querySelector('.opt-text').value.trim();
        const isCorrect = row.querySelector('input[type=checkbox], input[type=radio]').checked;
        return text ? { key: String.fromCharCode(97 + i), text, isCorrect } : null;
      })
      .filter(Boolean);
    if (options.length < 2) return toast('Add at least 2 options', 'error');
    if (!options.some((o) => o.isCorrect)) return toast('Mark the correct option(s)', 'error');
    payload.options = options;
  } else if (type === 'numeric') {
    payload.numericAnswer = Number(el('#qNumericAnswer').value);
    payload.tolerance = Number(el('#qTolerance').value) || 0;
    if (Number.isNaN(payload.numericAnswer)) return toast('Enter a numeric answer', 'error');
  } else {
    payload.modelAnswer = el('#qModelAnswer').value.trim();
    payload.rubric = el('#qRubric').value.trim();
  }

  try {
    await api(`/exams/${examId}/questions`, { method: 'POST', body: { questions: [payload] } });
    toast('Question added', 'success');
    el('#questionForm').reset();
    onTypeChange();
    loadExam();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function onStatusChange() {
  try {
    await api(`/exams/${examId}/status`, { method: 'PATCH', body: { status: el('#statusSelect').value } });
    toast('Status updated', 'success');
  } catch (err) {
    toast(err.message, 'error');
    loadExam();
  }
}

async function loadExam() {
  try {
    const exam = await api(`/exams/${examId}`);
    el('#examTitle').textContent = exam.title;
    el('#examMeta').textContent = `${exam.subject} · ${exam.durationMinutes} min`;
    el('#statusSelect').value = exam.status;
    el('#totalMarksBadge').textContent = `${exam.totalMarks} marks · ${exam.questions.length} questions`;
    renderQuestions(exam.questions);
  } catch (err) {
    toast(err.message, 'error');
  }
}

function renderQuestions(questions) {
  const host = el('#questionList');
  if (!questions.length) {
    host.innerHTML = '<div class="empty">No questions yet — add one on the left.</div>';
    return;
  }

  host.innerHTML = questions
    .sort((a, b) => a.order - b.order)
    .map(
      (q, i) => `<div class="answer-card">
        <div class="answer-head">
          <div>
            <strong>Q${i + 1}.</strong> ${escapeHtml(q.prompt)}
            <div class="small muted">${q.type} · ${escapeHtml(q.topic)} · ${q.marks} marks</div>
          </div>
          <button class="btn btn-sm btn-danger" data-delete="${q.id}">Delete</button>
        </div>
        ${(q.options || [])
          .map((o) => `<div class="small ${o.isCorrect ? 'muted' : 'muted'}">${o.isCorrect ? '✅' : '▫️'} ${escapeHtml(o.text)}</div>`)
          .join('')}
      </div>`
    )
    .join('');

  els('[data-delete]', host).forEach((button) => {
    button.addEventListener('click', async () => {
      if (!confirm('Delete this question?')) return;
      try {
        await api(`/exams/${examId}/questions/${button.dataset.delete}`, { method: 'DELETE' });
        loadExam();
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  });
}
