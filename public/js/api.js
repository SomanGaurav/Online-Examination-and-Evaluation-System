/* Shared API client, session helpers and small DOM utilities. */

const TOKEN_KEY = 'oees.token';
const USER_KEY = 'oees.user';

export const session = {
  get token() {
    return localStorage.getItem(TOKEN_KEY);
  },
  get user() {
    try {
      return JSON.parse(localStorage.getItem(USER_KEY));
    } catch {
      return null;
    }
  },
  save(token, user) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  },
  clear() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  },
};

export async function api(path, { method = 'GET', body, raw = false } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (session.token) headers.Authorization = `Bearer ${session.token}`;

  const res = await fetch(`/api${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (res.status === 401) {
    session.clear();
    if (!location.pathname.endsWith('index.html') && location.pathname !== '/') {
      location.replace('/index.html');
    }
    throw new Error('Session expired');
  }

  if (raw) return res;

  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = payload?.error?.details ? ` (${JSON.stringify(payload.error.details)})` : '';
    throw new Error((payload?.error?.message || res.statusText) + detail);
  }
  return payload.data;
}

/** Triggers a browser download for an authenticated binary endpoint. */
export async function download(path, fallbackName) {
  const res = await api(path, { raw: true });
  if (!res.ok) throw new Error('Export failed');

  const disposition = res.headers.get('Content-Disposition') || '';
  const match = disposition.match(/filename="([^"]+)"/);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = match ? match[1] : fallbackName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function requireRole(...roles) {
  const user = session.user;
  if (!user) {
    location.replace('/index.html');
    return null;
  }
  if (roles.length && !roles.includes(user.role)) {
    location.replace(user.role === 'student' ? '/student.html' : '/teacher.html');
    return null;
  }
  return user;
}

export function mountNav(container, user, links) {
  container.innerHTML = `
    <div class="nav-brand">Exam<span>Eval</span></div>
    <nav class="nav-links">
      ${links.map((l) => `<a href="${l.href}" class="${l.active ? 'active' : ''}">${l.label}</a>`).join('')}
    </nav>
    <div class="nav-user">
      <span class="badge badge-${user.role}">${user.role}</span>
      <span>${user.name}</span>
      <button class="btn btn-ghost" id="signOut">Sign out</button>
    </div>`;

  container.querySelector('#signOut').addEventListener('click', async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    session.clear();
    location.replace('/index.html');
  });
}

/* ------------------------------- DOM helpers -------------------------------- */

export function el(selector, root = document) {
  return root.querySelector(selector);
}

export function els(selector, root = document) {
  return [...root.querySelectorAll(selector)];
}

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

export function toast(message, kind = 'info') {
  let host = el('#toastHost');
  if (!host) {
    host = document.createElement('div');
    host.id = 'toastHost';
    host.className = 'toast-host';
    document.body.appendChild(host);
  }
  const node = document.createElement('div');
  node.className = `toast toast-${kind}`;
  node.textContent = message;
  host.appendChild(node);
  setTimeout(() => node.remove(), 4200);
}

export function formatDateTime(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString(undefined, {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

export function renderResponse(response) {
  if (response === null || response === undefined || response === '') return '<em class="muted">Not attempted</em>';
  if (Array.isArray(response)) return escapeHtml(response.join(', '));
  return escapeHtml(response);
}
