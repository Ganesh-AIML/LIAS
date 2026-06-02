import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import api from '../services/api';
import { KeyRound, User, Lock } from 'lucide-react';

export default function StudentAuth() {
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [token, setToken] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const setAuthSession = useAuthStore((state) => state.setAuthSession);
  // Pre-fill token from URL param (?token=LIAS_Ganesh&exam=exam_789)
// Allows students to click a generated link and go straight to password entry.
useEffect(() => {
  const params = new URLSearchParams(window.location.search);
  const urlToken = params.get('token');

  if (urlToken) {
    setToken(urlToken);
  }

  // exam param is informational — actual exam_id comes from server after auth
}, []);
  const navigate = useNavigate();

  const handleJoin = async (e) => {
    e.preventDefault();
    setError('');

    // Issue 22: client-side validation before hitting the API
    if (name.trim().length < 2) {
      setError('Student ID must be at least 2 characters.');
      return;
    }
    if (token.trim().length < 4) {
      setError('Exam token must be at least 4 characters.');
      return;
    }
    if (!password) {
      setError('Password is required.');
      return;
    }

    setLoading(true);
const timeoutId = setTimeout(() => {
  setError('Server is waking up — this may take 15–20 seconds on first login. Please wait...');
}, 4000);
try {
  const response = await api.post('/auth/join', {
        student_id: name.trim(),
        password: password,   // Issue 23: no .trim() on password — spaces are valid
        exam_token: token.trim(),
      });
      const { session_jwt, exam_id, session_id } = response.data;
      setAuthSession(name.trim(), token.trim(), session_jwt, exam_id, session_id);
      navigate('/precheck');
    } catch (err) {
      setError(err.response?.data?.detail || 'Invalid credentials or token.');
    } finally {
    clearTimeout(timeoutId);
    setLoading(false);
  }
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center p-4 font-sans">
      <div className="bg-white w-full max-w-md p-8 rounded-2xl shadow-xl border border-slate-200">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-black text-[#1E293B] tracking-tight">LIAS</h1>
          <p className="text-sm font-bold text-[#64748B] uppercase tracking-widest mt-1">Secure Assessment Portal</p>
        </div>

        {error && <div className="bg-rose-50 text-rose-500 p-3 rounded-lg text-sm mb-4 font-bold">{error}</div>}

        <form onSubmit={handleJoin} className="space-y-5">
          <div>
            <label className="block text-xs font-bold text-slate-600 uppercase mb-2">Student Identifier</label>
            <div className="relative">
              <User size={18} className="absolute left-3 top-3 text-slate-400" />
              <input type="text" required value={name} onChange={e => setName(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:border-[#06B6D4] outline-none" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-600 uppercase mb-2">Password</label>
            <div className="relative">
              <Lock size={18} className="absolute left-3 top-3 text-slate-400" />
              <input type="password" required value={password} onChange={e => setPassword(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:border-[#06B6D4] outline-none" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-600 uppercase mb-2">Exam Token</label>
            <div className="relative">
              <KeyRound size={18} className="absolute left-3 top-3 text-slate-400" />
              <input type="text" required value={token} onChange={e => setToken(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:border-[#06B6D4] outline-none" />
            </div>
          </div>

          <button type="submit" disabled={loading} className="w-full bg-[#06B6D4] hover:bg-cyan-700 text-white font-bold py-3 rounded-lg shadow-md mt-4">
            {loading ? 'Authenticating...' : 'Verify & Continue'}
          </button>
        </form>
      </div>
    </div>
  );
}