import { useState, lazy, Suspense } from 'react';
import {
  GraduationCap, LayoutDashboard, Users, PlusCircle, LogOut,
  AlertTriangle, BookOpen
} from 'lucide-react';
import { clearStaffSession } from './AuthPage';

const AdminMainView       = lazy(() => import('./views/AdminMainView'));
const ScheduleTest        = lazy(() => import('./views/ScheduleTest'));
const LiveTestMonitor     = lazy(() => import('./views/LiveTestMonitor'));
const UpcomingTestPreview = lazy(() => import('./views/UpcomingTestPreview'));
const AnalyticsView       = lazy(() => import('./views/AnalyticsView'));
const StudentDirectory    = lazy(() => import('./views/StudentDirectory'));

// ── FACULTY PORTAL (minimal landing + module-scoped exam views) ───────────────
export default function FacultyPortal({ staff, onLogout }) {
  const [currentView, setCurrentView] = useState('main'); // main | schedule | live | preview | analytics | directory
  const [selectedExam, setSelectedExam] = useState(null);
  const [editingDraft, setEditingDraft] = useState(null);

  const isPending = !staff?.module;

  const goHome = () => {
    setCurrentView('main');
    setSelectedExam(null);
    setEditingDraft(null);
  };

  const handleLogout = () => {
    clearStaffSession();
    onLogout();
  };

  // Pending faculty: identity only — no module-scoped resources yet.
  if (isPending) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] font-sans text-slate-900 flex items-center justify-center p-4">
        <div className="bg-white w-full max-w-md p-8 rounded-2xl shadow-xl border border-slate-200 text-center">
          <div className="flex items-center justify-center mx-auto mb-4">
            <img src="/Main-Logo.png" alt="LIAS" className="h-20 w-auto object-contain" />
          </div>
          <div className="bg-amber-50 border border-amber-200 text-amber-700 rounded-xl p-4 mb-6 flex items-start gap-3 text-left">
            <AlertTriangle size={20} className="mt-0.5 shrink-0" />
            <div>
              <p className="font-black">Module assignment pending</p>
              <p className="text-sm font-semibold mt-1">
                Your account is active but no module has been assigned yet. Contact an administrator
                to assign your module before you can manage exams.
              </p>
            </div>
          </div>
          <div className="bg-slate-50 border border-slate-100 rounded-xl p-4 mb-6 text-left space-y-2">
            <p className="text-sm font-bold text-slate-700"><span className="text-slate-400 uppercase text-xs block mb-1">Faculty Name</span>{staff.name || '—'}</p>
            <p className="text-sm font-bold text-slate-700"><span className="text-slate-400 uppercase text-xs block mb-1">Role</span>{staff.role}</p>
            <p className="text-sm font-bold text-slate-700"><span className="text-slate-400 uppercase text-xs block mb-1">Assigned Module</span><span className="text-amber-600">None — pending</span></p>
          </div>
          <button onClick={handleLogout} className="w-full flex items-center justify-center gap-2 py-3 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-bold transition-colors">
            <LogOut size={16} /> Sign Out
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F8FAFC] font-sans text-slate-900">
      {/* Top Navbar */}
      <nav className="bg-white border-b border-slate-200 sticky top-0 z-40 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 items-center justify-between">
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-2 cursor-pointer" onClick={goHome}>
                <img src="/Main-Logo.png" alt="LIAS" className="h-20 w-auto object-contain" />
              </div>

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
              {/* Faculty identity chip */}
              <div className="hidden sm:flex items-center gap-2 bg-blue-50 border border-blue-100 rounded-xl px-3 py-1.5">
                <GraduationCap size={15} className="text-blue-700" />
                <span className="text-sm font-black text-blue-900">{staff.name || 'Faculty'}</span>
                <span className="text-[10px] font-black uppercase text-blue-600 bg-white border border-blue-100 px-2 py-0.5 rounded-full">{staff.module}</span>
              </div>

              <button
                onClick={() => { setCurrentView('schedule'); setEditingDraft(null); }}
                className="hidden sm:flex items-center gap-1.5 bg-blue-900 hover:bg-blue-800 text-white px-4 py-2 rounded-xl text-sm font-bold transition-all shadow-sm"
              >
                <PlusCircle size={16} /> Schedule Test
              </button>
              <button
                onClick={handleLogout}
                className="flex items-center gap-1.5 text-sm font-bold text-slate-500 hover:text-red-600 hover:bg-red-50 px-3 py-2 rounded-lg transition-colors"
              >
                <LogOut size={16} /> <span className="hidden sm:inline">Sign Out</span>
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* Module scope banner */}
      <div className="bg-blue-900 text-blue-50 text-center py-1.5 text-xs font-bold uppercase tracking-widest">
        Module: {staff.module}
      </div>

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
            <ScheduleTest initialData={editingDraft} onBack={goHome} />
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

      {/* Mobile footer nav */}
      <div className="md:hidden fixed bottom-0 inset-x-0 bg-white border-t border-slate-200 z-40 flex">
        <button onClick={goHome} className="flex-1 py-3 flex flex-col items-center gap-0.5 text-[10px] font-black text-slate-600"><BookOpen size={18} /> Exams</button>
        <button onClick={() => setCurrentView('directory')} className="flex-1 py-3 flex flex-col items-center gap-0.5 text-[10px] font-black text-slate-600"><Users size={18} /> Students</button>
      </div>
    </div>
  );
}
