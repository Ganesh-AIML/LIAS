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
    // rule, not an auth failure. Let the calling page handle it (friendly
    // message + redirect to dashboard) instead of wiping the JWT and
    // bouncing to /join.
    const isAlreadySubmitted = status === 403 && detail === 'Exam already submitted.';
    if ([401, 403].includes(status) && !isAlreadySubmitted) {
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