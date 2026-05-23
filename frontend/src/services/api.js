import axios from 'axios';
import { useAuthStore } from '../store/authStore';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'https://lias-h2sq.onrender.com',
  timeout: 8000,
  headers: {
    'Content-Type': 'application/json',
  }
});

// Automatically inject JWT from the memory store into outgoing requests
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

// Gracefully intercept unauthorized responses (e.g., invalidated session)
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response && error.response.status === 403) {
      useAuthStore.getState().clearSession();
      window.location.href = '/';
    }
    return Promise.reject(error);
  }
);

export default api;