import axios from 'axios';
import { useAuthStore } from '../store/authStore';

// Issue 20: no silent fallback — a missing env var must be caught at startup,
// not silently route dev traffic to the production server.
const BASE_URL = import.meta.env.VITE_API_URL;
if (!BASE_URL) {
  throw new Error(
    'VITE_API_URL is not set. Create a .env file with VITE_API_URL=http://localhost:8000'
  );
}

const api = axios.create({
  baseURL: BASE_URL,
  timeout: 8000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Inject JWT from the in-memory store into every outgoing request
api.interceptors.request.use(
  (config) => {
    const token = useAuthStore.getState().sessionJwt;
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Issue 21: both 401 (expired) and 403 (revoked/invalid) clear the session
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if ([401, 403].includes(error.response?.status)) {
      useAuthStore.getState().clearSession();
      window.location.href = '/';
    }
    return Promise.reject(error);
  }
);

// Dedicated instance for violation logging — longer timeout, fire-and-forget friendly.
// Violations must survive poor network; we don't want the main api timeout killing them.
export const violationApi = axios.create({
  baseURL: BASE_URL,
  timeout: 20000,
  headers: { 'Content-Type': 'application/json' },
});

violationApi.interceptors.request.use(
  (config) => {
    const token = useAuthStore.getState().sessionJwt;
    if (token) config.headers.Authorization = `Bearer ${token}`;
    return config;
  },
  (error) => Promise.reject(error)
);

export default api;