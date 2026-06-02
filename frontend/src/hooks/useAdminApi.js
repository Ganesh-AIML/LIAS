const BASE = import.meta.env.VITE_API_URL;

function adminHeaders() {
  const token = sessionStorage.getItem('lias_admin_token') || '';
  return { 'Content-Type': 'application/json', 'X-Admin-Token': token };
}

// Throws on HTTP 4xx/5xx — fetch() does not throw on non-2xx by default.
async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: { ...adminHeaders(), ...(options.headers || {}) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `HTTP ${res.status}`);
  }
  return res.json();
}

export const adminApi = {
  get:    (path)       => request(path),
  post:   (path, body) => request(path, { method: 'POST',   body: JSON.stringify(body) }),
  put:    (path, body) => request(path, { method: 'PUT',    body: JSON.stringify(body) }),
  delete: (path)       => request(path, { method: 'DELETE' }),
};