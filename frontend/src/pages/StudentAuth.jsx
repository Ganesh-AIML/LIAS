import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import api from '../services/api';
import { KeyRound, User, Lock, Activity, AlertCircle } from 'lucide-react';

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
  // 🚀 Auditor H-07 Fix: Vacuum Cleaner Logic
  // Instantly wipes any orphaned exam answers if a previous student 
  // closed the tab on a shared lab computer without clicking "Sign Out".
  Object.keys(localStorage).forEach(key => {
    if (key.startsWith('scope_')) {
      localStorage.removeItem(key);
    }
  });

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

  const floatingLabel = "absolute left-11 top-1/2 -translate-y-1/2 text-slate-400 text-sm font-medium pointer-events-none transition-all peer-focus:top-2.5 peer-focus:translate-y-0 peer-focus:text-[10px] peer-focus:font-bold peer-focus:uppercase peer-focus:tracking-wider peer-focus:text-blue-900 peer-[&:not(:placeholder-shown)]:top-2.5 peer-[&:not(:placeholder-shown)]:translate-y-0 peer-[&:not(:placeholder-shown)]:text-[10px] peer-[&:not(:placeholder-shown)]:font-bold peer-[&:not(:placeholder-shown)]:uppercase peer-[&:not(:placeholder-shown)]:tracking-wider peer-[&:not(:placeholder-shown)]:text-slate-400";
  const floatingInput = "peer w-full pl-11 pr-4 pt-5 pb-2 bg-white border border-slate-200 rounded-lg outline-none focus:border-blue-900 focus:ring-2 focus:ring-blue-50 transition-all placeholder-transparent";
  const floatingIcon = "absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 peer-focus:text-blue-900 transition-colors pointer-events-none";

  return (
    <div className="min-h-screen flex font-sans">
      {/* Branding panel */}
      <div className="hidden lg:flex lg:w-1/2 relative flex-col justify-between p-12 bg-gradient-to-br from-blue-900 via-blue-900 to-indigo-900 overflow-hidden">
        <div className="absolute -top-24 -right-24 w-72 h-72 bg-white/5 rounded-full"></div>
        <div className="absolute bottom-0 left-0 w-96 h-96 bg-indigo-600/10 rounded-full -translate-x-1/2 translate-y-1/2"></div>

        <div className="relative z-10 flex items-center">
          <div className="bg-white rounded-xl px-4 py-2 shadow-sm">
            <img src="/Main-Logo.png" alt="LIAS" className="h-10 w-auto object-contain" />
          </div>
        </div>

        <div className="relative z-10 max-w-sm">
          <h2 className="text-3xl font-bold text-white leading-tight mb-3">Secure Assessment Portal</h2>
          <p className="text-blue-100 text-sm leading-relaxed mb-8">Enter your credentials and exam token to begin your proctored examination session.</p>
          <div className="space-y-3">
            <div className="flex items-center gap-3 text-blue-100 text-sm">
              <div className="w-7 h-7 rounded-md bg-white/10 flex items-center justify-center shrink-0"><Lock size={14} /></div>
              Fullscreen-enforced exam environment
            </div>
            <div className="flex items-center gap-3 text-blue-100 text-sm">
              <div className="w-7 h-7 rounded-md bg-white/10 flex items-center justify-center shrink-0"><KeyRound size={14} /></div>
              Token-based secure session entry
            </div>
            <div className="flex items-center gap-3 text-blue-100 text-sm">
              <div className="w-7 h-7 rounded-md bg-white/10 flex items-center justify-center shrink-0"><Activity size={14} /></div>
              Real-time integrity monitoring
            </div>
          </div>
        </div>

        <p className="relative z-10 text-blue-300 text-xs font-medium">© LIAS Examination System</p>
      </div>

      {/* Form panel */}
      <div className="flex-1 flex items-center justify-center p-6 bg-slate-50">
        <div className="w-full max-w-sm">
          <div className="text-center lg:text-left mb-8">
            <div className="lg:hidden inline-flex items-center gap-2 mb-4">
              <img src="/Main-Logo.png" alt="LIAS" className="h-8 w-auto object-contain" />
            </div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Welcome back</h1>
            <p className="text-sm text-slate-500 mt-1">Sign in with your student credentials to continue.</p>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm mb-5 font-semibold flex items-start gap-2">
              <AlertCircle size={16} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleJoin} className="space-y-5">
            <div className="relative">
              <User size={18} className={floatingIcon} />
              <input id="studentId" type="text" required placeholder=" " value={name} onChange={e => setName(e.target.value)} className={floatingInput} />
              <label htmlFor="studentId" className={floatingLabel}>Student Identifier</label>
            </div>

            <div className="relative">
              <Lock size={18} className={floatingIcon} />
              <input id="password" type="password" required placeholder=" " value={password} onChange={e => setPassword(e.target.value)} className={floatingInput} />
              <label htmlFor="password" className={floatingLabel}>Password</label>
            </div>

            <div className="relative">
              <KeyRound size={18} className={floatingIcon} />
              <input id="examToken" type="text" required placeholder=" " value={token} onChange={e => setToken(e.target.value)} className={floatingInput} />
              <label htmlFor="examToken" className={floatingLabel}>Exam Token</label>
            </div>

            <button type="submit" disabled={loading} className="w-full bg-blue-900 hover:bg-blue-800 disabled:opacity-60 text-white font-bold py-3 rounded-lg shadow-md mt-2 transition-colors">
              {loading ? 'Authenticating...' : 'Verify & Continue'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}