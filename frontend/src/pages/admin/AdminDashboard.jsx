import { useState, lazy, Suspense } from 'react';
import { 
  Shield, Users, Monitor, BarChart2, LogOut, Lock,
  PlusCircle, LayoutDashboard
} from 'lucide-react';

// We will port these files in the upcoming tasks. 
// For now, they are lazy-loaded stubs.
const AdminMainView       = lazy(() => import('./views/AdminMainView'));
const ScheduleTest        = lazy(() => import('./views/ScheduleTest'));
const LiveTestMonitor     = lazy(() => import('./views/LiveTestMonitor'));
const UpcomingTestPreview = lazy(() => import('./views/UpcomingTestPreview'));
const AnalyticsView       = lazy(() => import('./views/AnalyticsView'));
const StudentDirectory    = lazy(() => import('./views/StudentDirectory'));

// ── LOGIN GATE (Retained from previous phase) ─────────────────────────────────
function AdminLoginGate({ onSuccess }) {
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault();
    if (!token.trim()) return;
    setIsLoading(true);
    setError('');
    try {
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
          <p className="text-sm font-bold text-[#64748B] uppercase tracking-widest mt-1">Unified Control Center</p>
        </div>
        
        {error && <div className="bg-rose-50 text-rose-500 p-3 rounded-lg text-sm mb-4 font-bold">{error}</div>}
        
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
          <button type="submit" disabled={isLoading} className="w-full bg-[#06B6D4] hover:bg-cyan-700 disabled:opacity-60 text-white font-bold py-3 rounded-lg shadow-md mt-4 transition-colors">
            {isLoading ? 'Verifying...' : 'Enter Control Panel'}
          </button>
        </form>
      </div>
    </div>
  );
}

// ── UNIFIED SHELL ──────────────────────────────────────────────────────────────
export default function AdminDashboard() {
  const [isAuthed, setIsAuthed] = useState(!!sessionStorage.getItem('lias_admin_token'));
  
  // Master State Machine (Modeled after SCOPE TnpDashboard)
  const [currentView, setCurrentView] = useState('main'); // main, schedule, live, preview, analytics, directory
  const [selectedExam, setSelectedExam] = useState(null);
  const [editingDraft, setEditingDraft] = useState(null);

  if (!isAuthed) return <AdminLoginGate onSuccess={() => setIsAuthed(true)} />;

  // Navigation Handlers
  const goHome = () => {
    setCurrentView('main');
    setSelectedExam(null);
    setEditingDraft(null);
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] font-sans text-slate-900">
      {/* SCOPE-style Top Navbar */}
      <nav className="bg-white border-b border-slate-200 sticky top-0 z-40 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 items-center justify-between">
            
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-2 cursor-pointer" onClick={goHome}>
                <div className="w-8 h-8 bg-cyan-600 rounded-md flex items-center justify-center">
                  <Shield size={18} className="text-white" />
                </div>
                <h1 className="text-xl font-black tracking-tight text-slate-800">
                  LIAS <span className="text-cyan-600">Admin</span>
                </h1>
              </div>

              {/* Global Quick Actions */}
              <div className="hidden md:flex items-center gap-2 border-l border-slate-200 pl-6">
                <button 
                  onClick={goHome}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-bold transition-all ${currentView === 'main' ? 'bg-slate-100 text-slate-900' : 'text-slate-500 hover:bg-slate-50'}`}
                >
                  <LayoutDashboard size={16} /> Dashboard
                </button>
                <button 
                  onClick={() => setCurrentView('directory')}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-bold transition-all ${currentView === 'directory' ? 'bg-slate-100 text-slate-900' : 'text-slate-500 hover:bg-slate-50'}`}
                >
                  <Users size={16} /> Student Directory
                </button>
              </div>
            </div>

            <div className="flex items-center gap-3">
               <button
                  onClick={() => {
                    setCurrentView('schedule');
                    setEditingDraft(null);
                  }}
                  className="hidden sm:flex items-center gap-1.5 bg-cyan-600 hover:bg-cyan-700 text-white px-4 py-2 rounded-lg text-sm font-bold transition-all shadow-sm"
                >
                  <PlusCircle size={16} /> Schedule Test
                </button>
              <button
                onClick={() => { sessionStorage.removeItem('lias_admin_token'); setIsAuthed(false); }}
                className="flex items-center gap-1.5 text-sm font-bold text-slate-500 hover:text-red-600 hover:bg-red-50 px-3 py-2 rounded-lg transition-colors"
              >
                <LogOut size={16} /> <span className="hidden sm:inline">Sign Out</span>
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* Dynamic View Renderer */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-8 pb-16">
        <Suspense fallback={<div className="flex items-center justify-center py-20 text-slate-400 font-bold animate-pulse">Loading View...</div>}>
          
          {currentView === 'main' && (
            <AdminMainView 
              onScheduleClick={() => { setCurrentView('schedule'); setEditingDraft(null); }}
              onResumeDraft={(draft) => { setEditingDraft(draft); setCurrentView('schedule'); }}
              onMonitorLive={(test) => { setSelectedExam(test); setCurrentView('live'); }}
              onViewUpcoming={(test) => { setSelectedExam(test); setCurrentView('preview'); }}
              onViewAnalytics={(test) => { setSelectedExam(test); setCurrentView('analytics'); }}
            />
          )}

          {currentView === 'schedule' && (
            <ScheduleTest 
              initialData={editingDraft}
              onBack={goHome}
            />
          )}

          {currentView === 'live' && (
            <LiveTestMonitor test={selectedExam} onBack={goHome} />
          )}

          {currentView === 'preview' && (
            <UpcomingTestPreview test={selectedExam} onBack={goHome} />
          )}

          {currentView === 'analytics' && (
            <AnalyticsView test={selectedExam} onBack={goHome} />
          )}

          {currentView === 'directory' && (
            <StudentDirectory />
          )}

        </Suspense>
      </main>
    </div>
  );
}