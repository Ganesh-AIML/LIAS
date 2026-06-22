import axios from 'axios';
import { useAuthStore } from '../store/authStore';

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

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status;
    const detail = error.response?.data?.detail;
    // AUD-034 FIX: "Exam already submitted" is a legitimate-session business
    // rule, not an auth failure.
    const isAlreadySubmitted = status === 403 && detail === 'Exam already submitted.';
    // Task-6 FIX: Wrong exam password returns 403 "Incorrect Start/End Password."
    // This is a credential check, NOT a session auth failure — must NOT wipe JWT or redirect.
    const isPasswordCheck = status === 403 && (
      detail?.includes('Incorrect') || detail?.includes('Invalid') || detail?.includes('Password')
    );
    // Access denied to another exam (ownership guard) should also not wipe session.
    const isOwnershipGuard = status === 403 && detail === 'Access denied.';
    // AUD-011 / Task-8/10 FIX: a session revoked due to max violations is a
    // distinct, recoverable state (admin can GRANT to resume) — NOT a real
    // auth failure. The backend deliberately signals this via 401 + detail
    // containing "revoked" (see verify_session_guard, AUD-011). Wiping the
    // JWT and bouncing to /join here would make the Lock Overlay's polling
    // (and the violation-count sync that triggers it) impossible, since the
    // very call that detects the lock would itself kill the session first.
    const wwwAuth = error.response?.headers?.['www-authenticate'] || '';
    const isSessionRevoked = status === 401 && (
      detail?.toLowerCase().includes('revoked') || wwwAuth.includes('SESSION_REVOKED')
    );
    if ([401, 403].includes(status) && !isAlreadySubmitted && !isPasswordCheck && !isOwnershipGuard && !isSessionRevoked) {
      useAuthStore.getState().clearSession();
      // Redirect to student login, not admin
      window.location.href = '/join';
    }
    return Promise.reject(error);
  }
);

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