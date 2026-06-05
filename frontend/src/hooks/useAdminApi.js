const BASE = import.meta.env.VITE_API_URL;

// ── ENTERPRISE CACHE CONFIGURATION ──
const CACHE = {};
const CACHE_TTL = 20000; // 20 seconds. Data stays fresh, stops rapid-fire UI re-fetching.

// Helper to wipe cache when data is altered (POST, PUT, DELETE)
const invalidateCache = () => {
  for (let key in CACHE) {
    delete CACHE[key];
  }
};

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
  get: async (path) => {
    const now = Date.now();
    
    // 1. Check if we have valid, unexpired data in memory
    if (CACHE[path] && (now - CACHE[path].time < CACHE_TTL)) {
      return CACHE[path].data; // Serve instantly without hitting the server
    }

    // 2. If not, fetch normally via the unified request handler
    const data = await request(path);
    
    // 3. Save to memory cache
    CACHE[path] = { data, time: now }; 
    return data;
  },

  post: async (path, body) => {
    invalidateCache(); // 🚀 Wipe cache on mutation
    return request(path, { method: 'POST', body: JSON.stringify(body) });
  },

  put: async (path, body) => {
    invalidateCache(); // 🚀 Wipe cache on mutation
    return request(path, { method: 'PUT', body: JSON.stringify(body) });
  },

  delete: async (path) => {
    invalidateCache(); // 🚀 Wipe cache on mutation
    return request(path, { method: 'DELETE' });
  },
};