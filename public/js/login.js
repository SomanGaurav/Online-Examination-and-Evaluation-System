import { api, session, el, toast } from './api.js';

function landingFor(user) {
  return user.role === 'student' ? '/student.html' : '/teacher.html';
}

// Already signed in? Skip the form.
if (session.token && session.user) {
  location.replace(landingFor(session.user));
}

const loginForm = el('#loginForm');
const registerForm = el('#registerForm');
const tabLogin = el('#tabLogin');
const tabRegister = el('#tabRegister');

function showTab(which) {
  const isLogin = which === 'login';
  tabLogin.classList.toggle('active', isLogin);
  tabRegister.classList.toggle('active', !isLogin);
  loginForm.hidden = !isLogin;
  registerForm.hidden = isLogin;
}

tabLogin.addEventListener('click', () => showTab('login'));
tabRegister.addEventListener('click', () => showTab('register'));

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = loginForm.querySelector('button[type=submit]');
  button.disabled = true;
  try {
    const data = await api('/auth/login', {
      method: 'POST',
      body: { email: el('#loginEmail').value.trim(), password: el('#loginPassword').value },
    });
    session.save(data.token, data.user);
    location.replace(landingFor(data.user));
  } catch (err) {
    toast(err.message, 'error');
    button.disabled = false;
  }
});

registerForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = registerForm.querySelector('button[type=submit]');
  button.disabled = true;
  try {
    await api('/auth/register', {
      method: 'POST',
      body: {
        name: el('#regName').value.trim(),
        email: el('#regEmail').value.trim(),
        rollNumber: el('#regRoll').value.trim() || undefined,
        password: el('#regPassword').value,
      },
    });
    toast('Account created — sign in to continue', 'success');
    el('#loginEmail').value = el('#regEmail').value.trim();
    showTab('login');
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    button.disabled = false;
  }
});
