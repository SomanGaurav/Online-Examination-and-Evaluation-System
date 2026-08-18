import { api, requireRole, mountNav, el, els, escapeHtml, toast } from './api.js';

const user = requireRole('student');
const examId = new URLSearchParams(location.search).get('examId');

if (!examId) {
  location.replace('/student.html');
}

let state = {
  submissionId: null,
  exam: null,
  questions: [],
  answers: new Map(), // questionId -> response
  current: 0,
  remainingSeconds: 0,
};

let timerHandle = null;
let saveTimer = null;

if (user) {
  mountNav(el('#topbar'), user, [{ href: '/student.html', label: 'Dashboard' }]);
  boot();
}

async function boot() {
  try {
    const data = await api(`/exams/${examId}/attempts`, { method: 'POST' });
    state.submissionId = data.submissionId;
    state.exam = data.exam;
    state.questions = data.questions;
    state.remainingSeconds = data.remainingSeconds;
    data.savedAnswers.forEach((a) => state.answers.set(String(a.question), a.response));

    el('#examTitle').textContent = data.exam.title;
    el('#examMeta').textContent = `${data.exam.subject} · ${data.questions.length} questions · ${data.exam.totalMarks} marks`;

    renderPalette();
    renderQuestion(0);
    startTimer();
  } catch (err) {
    toast(err.message, 'error');
    setTimeout(() => location.replace('/student.html'), 1500);
  }
}

function startTimer() {
  updateTimerDisplay();
  timerHandle = setInterval(() => {
    state.remainingSeconds -= 1;
    updateTimerDisplay();
    if (state.remainingSeconds <= 0) {
      clearInterval(timerHandle);
      toast('Time is up — submitting your answers', 'error');
      finishExam(true);
    }
  }, 1000);
}

function updateTimerDisplay() {
  const timer = el('#timer');
  const m = Math.max(0, Math.floor(state.remainingSeconds / 60));
  const s = Math.max(0, state.remainingSeconds % 60);
  timer.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  timer.classList.toggle('danger', state.remainingSeconds <= 60);
}

function renderPalette() {
  const answeredCount = [...state.answers.values()].filter((v) => v !== null && v !== undefined && v !== '').length;
  el('#progressText').textContent = `${answeredCount} of ${state.questions.length} answered`;

  el('#palette').innerHTML = state.questions
    .map((q, i) => {
      const value = state.answers.get(String(q.id));
      const answered = Array.isArray(value) ? value.length > 0 : value !== null && value !== undefined && value !== '';
      const classes = [answered ? 'answered' : '', i === state.current ? 'current' : ''].filter(Boolean).join(' ');
      return `<button class="${classes}" data-index="${i}">${i + 1}</button>`;
    })
    .join('');

  els('#palette button').forEach((btn) => {
    btn.addEventListener('click', () => renderQuestion(Number(btn.dataset.index)));
  });
}

function renderQuestion(index) {
  state.current = index;
  const q = state.questions[index];
  const value = state.answers.get(String(q.id));

  const host = el('#questionHost');
  host.innerHTML = `
    <div class="card-head">
      <h2>Question ${index + 1} of ${state.questions.length}</h2>
      <span class="badge">${q.marks} mark${q.marks === 1 ? '' : 's'}</span>
    </div>
    <p style="font-size:1rem; margin-bottom:1rem">${escapeHtml(q.prompt)}</p>
    <div id="answerArea"></div>
    <div class="row" style="justify-content:space-between; margin-top:1.25rem">
      <button class="btn btn-secondary" id="prevBtn" ${index === 0 ? 'disabled' : ''}>← Previous</button>
      <button class="btn btn-secondary" id="clearBtn">Clear response</button>
      <button class="btn" id="nextBtn" ${index === state.questions.length - 1 ? 'disabled' : ''}>Next →</button>
    </div>
  `;

  renderAnswerArea(q, value);

  el('#prevBtn').addEventListener('click', () => renderQuestion(index - 1));
  el('#nextBtn').addEventListener('click', () => renderQuestion(index + 1));
  el('#clearBtn').addEventListener('click', () => {
    setAnswer(q, q.type === 'multi-select' ? [] : null);
    renderQuestion(index);
  });
}

function renderAnswerArea(q, value) {
  const area = el('#answerArea');

  if (q.type === 'mcq' || q.type === 'true-false') {
    area.innerHTML = q.options
      .map(
        (opt) => `<label class="option">
          <input type="radio" name="opt" value="${escapeHtml(opt.key)}" ${value === opt.key ? 'checked' : ''} />
          <span>${escapeHtml(opt.text)}</span>
        </label>`
      )
      .join('');
    els('input[name=opt]', area).forEach((input) => {
      input.addEventListener('change', () => setAnswer(q, input.value));
    });
    return;
  }

  if (q.type === 'multi-select') {
    const selected = Array.isArray(value) ? value : [];
    area.innerHTML = q.options
      .map(
        (opt) => `<label class="option">
          <input type="checkbox" value="${escapeHtml(opt.key)}" ${selected.includes(opt.key) ? 'checked' : ''} />
          <span>${escapeHtml(opt.text)}</span>
        </label>`
      )
      .join('');
    els('input[type=checkbox]', area).forEach((input) => {
      input.addEventListener('change', () => {
        const chosen = els('input[type=checkbox]:checked', area).map((i) => i.value);
        setAnswer(q, chosen);
      });
    });
    return;
  }

  if (q.type === 'numeric') {
    area.innerHTML = `<input type="number" step="any" id="numAnswer" value="${value ?? ''}" placeholder="Enter numeric answer" />`;
    el('#numAnswer', area).addEventListener('input', (e) => setAnswer(q, e.target.value === '' ? null : Number(e.target.value)));
    return;
  }

  // short/long answer
  area.innerHTML = `<textarea id="essayAnswer" style="min-height:${q.type === 'long-answer' ? 220 : 100}px" placeholder="Type your answer here…">${escapeHtml(value || '')}</textarea>`;
  el('#essayAnswer', area).addEventListener('input', (e) => setAnswer(q, e.target.value));
}

function setAnswer(question, response) {
  state.answers.set(String(question.id), response);
  renderPalette();
  scheduleSave(question.id, response);
}

function scheduleSave(questionId, response) {
  clearTimeout(saveTimer);
  el('#saveState').textContent = 'Saving…';
  saveTimer = setTimeout(async () => {
    try {
      await api(`/submissions/${state.submissionId}/answers`, {
        method: 'PATCH',
        body: { questionId, response },
      });
      el('#saveState').textContent = `Saved ${new Date().toLocaleTimeString()}`;
    } catch (err) {
      el('#saveState').textContent = 'Save failed — will retry';
    }
  }, 500);
}

el('#finishBtn').addEventListener('click', () => finishExam(false));

async function finishExam(auto) {
  if (!auto) {
    const answered = [...state.answers.values()].filter((v) => v !== null && v !== undefined && v !== '').length;
    const remaining = state.questions.length - answered;
    if (remaining > 0 && !confirm(`${remaining} question(s) unanswered. Submit anyway?`)) return;
  }

  clearInterval(timerHandle);
  el('#finishBtn').disabled = true;

  try {
    const answers = state.questions.map((q) => ({ questionId: q.id, response: state.answers.get(String(q.id)) ?? null }));
    const result = await api(`/submissions/${state.submissionId}/submit`, { method: 'POST', body: { answers } });
    toast('Exam submitted', 'success');
    sessionStorage.setItem('oees.lastSubmission', JSON.stringify(result));
    location.replace('/student.html');
  } catch (err) {
    toast(err.message, 'error');
    el('#finishBtn').disabled = false;
  }
}

window.addEventListener('beforeunload', (event) => {
  if (state.submissionId) {
    event.preventDefault();
    event.returnValue = '';
  }
});
