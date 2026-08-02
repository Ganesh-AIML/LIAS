import { useState } from 'react';
import { Lock, Mail, User, Shield, GraduationCap, LogIn, UserPlus, AlertCircle } from 'lucide-react';

const BASE = import.meta.env.VITE_API_URL;

// ── SHARED STAFF SESSION HELPERS ──────────────────────────────────────────────
export const clearStaffSession = () => {
  sessionStorage.removeItem('lias_staff_jwt');
  sessionStorage.removeItem('lias_staff');
  sessionStorage.removeItem('lias_admin_token'); // legacy key cleanup
};

export const getStaffSession = () => {
  try {
    const raw = sessionStorage.getItem('lias_staff');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

export const saveStaffSession = (token, staff) => {
  sessionStorage.setItem('lias_staff_jwt', token);
  sessionStorage.setItem('lias_staff', JSON.stringify(staff));
};

// ── AUTH PAGE ─────────────────────────────────────────────────────────────────
export default function AuthPage({ onSuccess }) {
  const [role, setRole] = useState('admin'); // 'admin' | 'faculty'
  const [facultyTab, setFacultyTab] = useState('login'); // 'login' | 'register'
  const [form, setForm] = useState({ email: '', password: '', name: '' });
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!form.email.trim() || !form.password) return;
    if (role === 'faculty' && facultyTab === 'register' && !form.name.trim()) {
      setError('Name is required.');
      return;
    }

    setIsLoading(true);
    try {
      const path =
        role === 'admin'
          ? '/admin/auth/login'
          : facultyTab === 'register'
          ? '/admin/auth/register'
          : '/admin/auth/faculty-login';

      const body =
        role === 'admin' || facultyTab === 'login'
          ? { email: form.email.trim(), password: form.password }
          : { name: form.name.trim(), email: form.email.trim(), password: form.password };

      const res = await fetch(`${BASE}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.detail || `HTTP ${res.status}`);
        return;
      }

      // Registration does not return a token — drop through to the login tab.
      if (!data.token) {
        setFacultyTab('login');
        setForm((f) => ({ ...f, name: '' }));
        setError('');
        return;
      }

      saveStaffSession(data.token, data.staff);
      onSuccess(data.staff);
    } catch {
      setError('Cannot reach server. Check your connection.');
    } finally {
      setIsLoading(false);
    }
  };

  const inputCls =
    'w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:border-blue-700 outline-none focus:ring-2 focus:ring-blue-100';

  return (
    <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center p-4 font-sans">
      <div className="bg-white w-full max-w-md p-8 rounded-2xl shadow-xl border border-slate-200">
        <div className="text-center mb-8">
          <div className="flex items-center justify-center mx-auto mb-4">
            <img src="/Main-Logo.png" alt="LIAS" className="h-25 w-auto object-contain" />
          </div>
          <h1 className="text-2xl font-black text-[#1E293B] tracking-tight">Staff Portal</h1>
          <p className="text-sm font-bold text-[#64748B] uppercase tracking-widest mt-1">Admin · Faculty · Module-Scoped</p>
        </div>

        {/* Role toggle */}
        <div className="grid grid-cols-2 gap-2 mb-6 bg-slate-100 p-1 rounded-xl">
          <button
            type="button"
            onClick={() => { setRole('admin'); setError(''); }}
            className={`flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-bold transition-all ${role === 'admin' ? 'bg-blue-900 text-white shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
          >
            <Shield size={15} /> Admin
          </button>
          <button
            type="button"
            onClick={() => { setRole('faculty'); setError(''); }}
            className={`flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-bold transition-all ${role === 'faculty' ? 'bg-blue-900 text-white shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
          >
            <GraduationCap size={15} /> Faculty
          </button>
        </div>

        {/* Faculty login/register tabs */}
        {role === 'faculty' && (
          <div className="flex gap-4 mb-5 text-sm font-bold">
            <button
              type="button"
              onClick={() => { setFacultyTab('login'); setError(''); }}
              className={`flex items-center gap-1.5 ${facultyTab === 'login' ? 'text-blue-900 border-b-2 border-blue-900 pb-1' : 'text-slate-400 hover:text-slate-600'}`}
            >
              <LogIn size={14} /> Login
            </button>
            <button
              type="button"
              onClick={() => { setFacultyTab('register'); setError(''); }}
              className={`flex items-center gap-1.5 ${facultyTab === 'register' ? 'text-blue-900 border-b-2 border-blue-900 pb-1' : 'text-slate-400 hover:text-slate-600'}`}
            >
              <UserPlus size={14} /> Register
            </button>
          </div>
        )}

        {error && (
          <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm mb-4 font-bold flex items-start gap-2">
            <AlertCircle size={16} className="mt-0.5 shrink-0" /> {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          {role === 'faculty' && facultyTab === 'register' && (
            <div>
              <label className="block text-xs font-bold text-slate-600 uppercase mb-2">Full Name</label>
              <div className="relative">
                <User size={18} className="absolute left-3 top-3 text-slate-400" />
                <input type="text" required value={form.name} onChange={set('name')} placeholder="Dr. Jane Doe" className={inputCls} />
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-bold text-slate-600 uppercase mb-2">Email</label>
            <div className="relative">
              <Mail size={18} className="absolute left-3 top-3 text-slate-400" />
              <input type="email" required value={form.email} onChange={set('email')} placeholder="you@college.edu" className={inputCls} />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-600 uppercase mb-2">Password</label>
            <div className="relative">
              <Lock size={18} className="absolute left-3 top-3 text-slate-400" />
              <input
                type="password"
                required
                value={form.password}
                onChange={set('password')}
                placeholder={role === 'faculty' && facultyTab === 'register' ? 'Min 4 characters' : '••••••••'}
                className={inputCls}
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full bg-blue-900 hover:bg-blue-800 disabled:opacity-60 text-white font-bold py-3 rounded-lg shadow-md mt-4 transition-colors"
          >
            {isLoading
              ? 'Verifying...'
              : role === 'admin'
              ? 'Sign In as Admin'
              : facultyTab === 'register'
              ? 'Create Faculty Account'
              : 'Sign In as Faculty'}
          </button>
        </form>

        <p className="text-[11px] text-slate-400 font-semibold text-center mt-5">
          Faculty accounts are created pending — an admin assigns your module before you can manage exams.
        </p>
      </div>
    </div>
  );
}
