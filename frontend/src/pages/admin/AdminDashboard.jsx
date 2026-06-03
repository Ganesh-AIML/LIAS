import { useState, lazy, Suspense } from 'react';
import { Shield, BookOpen, Users, Monitor, BarChart2, LogOut, Lock } from 'lucide-react';

const ExamManager    = lazy(() => import('./ExamManager'));
const StudentManager = lazy(() => import('./StudentManager'));
const LiveMonitor    = lazy(() => import('./LiveMonitor'));
const ExamAnalytics  = lazy(() => import('./ExamAnalytics'));

const NAV = [
  { id: 'exams',     label: 'Exam Manager', icon: BookOpen  },
  { id: 'students',  label: 'Students',     icon: Users     },
  { id: 'monitor',   label: 'Live Monitor', icon: Monitor   },
  { id: 'analytics', label: 'Analytics',    icon: BarChart2 },
];

// ── LOGIN GATE ─────────────────────────────────────────────────────────────────
function AdminLoginGate({ onSuccess }) {
  const [token, setToken]     = useState('');
  const [error, setError]     = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault();
    if (!token.trim()) return;
    setIsLoading(true);
    setError('');
    try {
      // Hits the newly created explicit verify endpoint
      const res = await fetch(`${import.meta.env.VITE_API_URL}/admin/verify`, {
        headers: { 'X-Admin-Token': token.trim() },
      });
      if (res.ok) {
        sessionStorage.setItem('lias_admin_token', token.trim());
        onSuccess();
      } else {
        setError('Invalid admin credentials.');
      }
    } catch {
      setError('Cannot reach server. Check your connection.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center p-4 font-sans">
      <div className="bg-white w-full max-w-md p-8 rounded-2xl shadow-xl border border-slate-200">
        <div className="text-center mb-8">
          <div className="w-12 h-12 bg-cyan-600 rounded-xl flex items-center justify-center mx-auto mb-4 shadow-sm">
            <Shield size={26} className="text-white" />
          </div>
          <h1 className="text-2xl font-black text-[#1E293B] tracking-tight">LIAS Admin</h1>
          <p className="text-sm font-bold text-[#64748B] uppercase tracking-widest mt-1">Secure Control Panel</p>
        </div>
        
        {error && (
          <div className="bg-rose-50 text-rose-500 p-3 rounded-lg text-sm mb-4 font-bold">{error}</div>
        )}
        
        <form onSubmit={handleLogin} className="space-y-5">
          <div>
            <label className="block text-xs font-bold text-slate-600 uppercase mb-2">Admin Token</label>
            <div className="relative">
              <Lock size={18} className="absolute left-3 top-3 text-slate-400" />
              <input
                type="password"
                required
                value={token}
                onChange={e => setToken(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:border-[#06B6D4] outline-none"
              />
            </div>
          </div>
          <button
            type="submit"
            disabled={isLoading}
            className="w-full bg-[#06B6D4] hover:bg-cyan-700 disabled:opacity-60 text-white font-bold py-3 rounded-lg shadow-md mt-4 transition-colors"
          >
            {isLoading ? 'Verifying...' : 'Enter Control Panel'}
          </button>
        </form>
      </div>
    </div>
  );
}

// ── SHELL ──────────────────────────────────────────────────────────────────────
export default function AdminDashboard() {
  const [isAuthed, setIsAuthed]   = useState(!!sessionStorage.getItem('lias_admin_token'));
  const [activeTab, setActiveTab] = useState('exams');

  if (!isAuthed) return <AdminLoginGate onSuccess={() => setIsAuthed(true)} />;

  return (
    <div className="min-h-screen bg-[#F8FAFC] font-sans text-slate-900">
      <nav className="bg-white border-b border-slate-200 sticky top-0 z-40 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-cyan-600 rounded-md flex items-center justify-center">
                <Shield size={18} className="text-white" />
              </div>
              <h1 className="text-xl font-bold tracking-tight">
                LIAS <span className="text-cyan-600">Admin</span>
              </h1>
            </div>
            <div className="flex items-center gap-1">
              {NAV.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  onClick={() => setActiveTab(id)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all ${activeTab === id ? 'bg-cyan-50 text-cyan-700 border border-cyan-200' : 'text-slate-600 hover:bg-slate-100'}`}
                >
                  <Icon size={16} /> {label}
                </button>
              ))}
              <button
                onClick={() => { sessionStorage.removeItem('lias_admin_token'); setIsAuthed(false); }}
                className="ml-3 flex items-center gap-1.5 text-sm font-bold text-red-500 hover:bg-red-50 px-3 py-2 rounded-lg transition-colors"
              >
                <LogOut size={15} /> Sign Out
              </button>
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-8 pb-16">
        <Suspense fallback={<div className="py-20 text-center text-slate-400 font-bold animate-pulse">Loading...</div>}>
          {activeTab === 'exams'     && <ExamManager />}
          {activeTab === 'students'  && <StudentManager />}
          {activeTab === 'monitor'   && <LiveMonitor />}
          {activeTab === 'analytics' && <ExamAnalytics />}
        </Suspense>
      </main>
    </div>
  );
}