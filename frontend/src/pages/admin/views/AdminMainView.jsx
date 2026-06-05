import React, { useState, useEffect } from 'react';
import { 
  PlusCircle, Activity, CheckCircle, Clock, Users, 
  BarChart2, CalendarDays, FileText, FileEdit, Trash2, RefreshCw, Link, Copy, AlertTriangle, Key
} from 'lucide-react';
import { adminApi } from '../../../hooks/useAdminApi';
import { useTrueTime } from '../../../hooks/useTrueTime';

const LiveCountdown = ({ rawDate, duration, isUpcoming, ts }) => {
  const [timeLeft, setTimeLeft] = useState('...'); 
  useEffect(() => {
    if (!rawDate || !ts) return; 
    const startTimeMs = new Date(rawDate).getTime();
    const endTimeMs = isUpcoming ? startTimeMs : startTimeMs + (parseInt(duration) || 0) * 60000;
    const updateTimer = () => {
      const now = ts.now();
      const diff = endTimeMs - now;
      if (diff <= 0) {
        setTimeLeft(isUpcoming ? 'Starting Soon...' : 'Exam Ended');
      } else {
        const days = Math.floor(diff / (1000 * 60 * 60 * 24));
        const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
        const m = Math.floor((diff / 60000) % 60);
        const s = Math.floor((diff / 1000) % 60);
        if (days > 0) setTimeLeft(`${days}d ${hours}h ${m}m`);
        else if (hours > 0) setTimeLeft(`${hours}h ${m}m ${s}s`);
        else setTimeLeft(`${m}m ${s}s`);
      }
    };
    updateTimer();
    const intv = setInterval(updateTimer, 1000);
    return () => clearInterval(intv);
  }, [rawDate, duration, isUpcoming, ts]);
  return <span className="font-mono">{timeLeft}</span>;
};

export default function AdminMainView({ onScheduleClick, onResumeDraft, onMonitorLive, onViewUpcoming, onViewAnalytics }) {
  const { ts } = useTrueTime();
  const [exams, setExams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isFetchingDraft, setIsFetchingDraft] = useState(false);
  
  // 🚀 Feature 1: Custom Delete Modal State
  const [examToDelete, setExamToDelete] = useState(null);
  const [isDeletingExam, setIsDeletingExam] = useState(false);

  const fetchExams = async () => {
    try {
      const res = await adminApi.get('/admin/exams');
      if (res.success) setExams(res.data);
    } catch (err) { console.error(err); } 
    finally { setLoading(false); }
  };

  useEffect(() => {
    fetchExams();
    const interval = setInterval(fetchExams, 15000);
    return () => clearInterval(interval);
  }, []);

  const confirmDeleteExam = async () => {
    if (!examToDelete) return;
    setIsDeletingExam(true); // 🚀 Set loading to true
    try {
      await adminApi.delete(`/admin/exams/${examToDelete.id}`);
      setExamToDelete(null);
      fetchExams();
    } catch (err) { 
      alert(err.message); 
    } finally {
      setIsDeletingExam(false); // 🚀 Reset loading state
    }
  };

  const handleEditDraft = async (id) => {
    setIsFetchingDraft(true);
    try {
      const res = await adminApi.get(`/admin/exams/${id}`);
      if (res.success) onResumeDraft(res.data); 
    } catch (err) { alert("Failed to load draft payload."); } 
    finally { setIsFetchingDraft(false); }
  };

  const handleCopyLink = (examId) => {
    const link = `${window.location.origin}/join?exam=${examId}`; 
    navigator.clipboard.writeText(link);
    alert("Student Login portal link copied to clipboard!");
  };

  const liveTests = exams.filter(e => e.status === 'live');
  const upcomingTests = exams.filter(e => e.status === 'upcoming');
  const pastTests = exams.filter(e => e.status === 'completed');
  const draftTests = exams.filter(e => e.status === 'draft');

  if (loading || isFetchingDraft) {
    return <div className="flex items-center justify-center py-20 text-slate-400 font-bold animate-pulse"><RefreshCw className="animate-spin mr-2" /> {isFetchingDraft ? 'Hydrating Draft...' : 'Loading Control Panel...'}</div>;
  }

  return (
    <div className="space-y-8 animate-in fade-in duration-300 relative">
      
      {/* 🚀 Feature 1: Custom Confirmation Modal */}
      {examToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-2xl animate-in zoom-in duration-200">
            <div className="flex items-center gap-3 mb-3 text-red-600">
              <AlertTriangle size={24} />
              <h3 className="text-xl font-black">Delete Examination?</h3>
            </div>
            <p className="text-sm font-semibold text-slate-600 mb-2">You are about to permanently delete <span className="text-slate-900 font-bold">"{examToDelete.title}"</span>.</p>
            <p className="text-xs text-slate-500 mb-6 bg-red-50 p-3 rounded-lg border border-red-100">
              This will irreversibly erase all questions, coding problems, enrolled students, and live test sessions. This cannot be undone.
            </p>
            <div className="flex justify-end gap-3">
  <button 
    onClick={() => setExamToDelete(null)} 
    disabled={isDeletingExam}
    className="px-4 py-2 font-bold text-slate-600 hover:bg-slate-100 rounded-lg text-sm transition-colors disabled:opacity-50"
  >
    Cancel
  </button>
  <button 
    onClick={confirmDeleteExam} 
    disabled={isDeletingExam}
    className={`px-4 py-2 font-bold text-white rounded-lg shadow-sm text-sm transition-colors ${isDeletingExam ? 'bg-red-400 cursor-not-allowed' : 'bg-red-600 hover:bg-red-700'}`}
  >
    {isDeletingExam ? 'Deleting Exam...' : 'Yes, Delete Exam'}
  </button>
</div>
          </div>
        </div>
      )}

      {/* ── LIVE EXAMS ── */}
      {liveTests.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <span className="flex h-3 w-3 relative"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span><span className="relative inline-flex rounded-full h-3 w-3 bg-red-500"></span></span>
              <h2 className="text-lg font-black text-slate-900 tracking-tight">Active Examinations</h2>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {liveTests.map(test => (
              <div key={test.id} className="bg-white border-2 border-red-100 rounded-2xl p-5 shadow-[0_4px_20px_-4px_rgba(239,68,68,0.1)] relative overflow-hidden group flex flex-col">
<div className="absolute top-0 right-0 bg-red-50 text-red-600 text-[10px] font-black uppercase px-3 py-1 rounded-bl-lg tracking-widest flex items-center gap-1 z-10">Live Now</div>
<div className="flex justify-between items-start mb-4 pt-4 relative z-10">
                  <h3 className="font-black text-lg text-slate-900 pr-12 truncate">{test.title}</h3>
                  <div className="flex gap-2">
                    <button onClick={() => handleCopyLink(test.id)} className="text-slate-400 hover:text-cyan-600 transition-colors" title="Copy Student Link"><Link size={18}/></button>
                    <button onClick={() => setExamToDelete(test)} className="text-slate-400 hover:text-red-600 transition-colors" title="Delete Exam"><Trash2 size={18}/></button>
                  </div>
                </div>
                
                {/* 🚀 Feature 3: Passwords Display */}
                <div className="bg-slate-50 border border-slate-100 rounded-lg p-3 mb-4 space-y-1.5">
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-slate-500 font-bold uppercase flex items-center gap-1"><Key size={12}/> Start Pwd:</span>
                    <span className="font-mono font-black text-slate-800 bg-white border px-1.5 py-0.5 rounded">{test.start_password || '********'}</span>
                  </div>
                  {test.end_password && (
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-slate-500 font-bold uppercase flex items-center gap-1"><Key size={12}/> End Pwd:</span>
                      <span className="font-mono font-black text-slate-800 bg-white border px-1.5 py-0.5 rounded">{test.end_password}</span>
                    </div>
                  )}
                </div>

                <div className="space-y-2 mb-6 flex-grow">
                  <div className="flex items-center justify-between text-sm"><span className="text-slate-500 font-bold flex items-center gap-1.5"><Clock size={14}/> Ends in</span><span className="font-bold text-red-600 bg-red-50 px-2 py-0.5 rounded"><LiveCountdown rawDate={test.starts_at_ms} duration={test.duration_minutes} isUpcoming={false} ts={ts} /></span></div>
                  <div className="flex items-center justify-between text-sm"><span className="text-slate-500 font-bold flex items-center gap-1.5"><Users size={14}/> Active Now</span><span className="font-black text-slate-700">{test.participants || 0}</span></div>
                </div>
                <button onClick={() => onMonitorLive(test)} className="w-full py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-all shadow-sm group-hover:shadow-md mt-auto"><Activity size={16} /> Enter Live Monitor</button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── UPCOMING EXAMS ── */}
      <section>
        <div className="flex items-center gap-2 mb-4"><CalendarDays size={20} className="text-cyan-600" /><h2 className="text-lg font-black text-slate-900 tracking-tight">Upcoming Examinations</h2></div>
        {upcomingTests.length === 0 ? (
          <div className="bg-slate-50 border border-slate-200 border-dashed rounded-2xl p-8 text-center"><CalendarDays size={32} className="mx-auto text-slate-300 mb-3" /><p className="text-slate-500 font-bold">No upcoming exams scheduled.</p></div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {upcomingTests.map(test => (
              <div key={test.id} className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm hover:shadow-md transition-shadow flex flex-col">
                <div className="flex justify-between items-start mb-4">
                  <h3 className="font-black text-lg text-slate-900 truncate">{test.title}</h3>
                  <div className="flex gap-2">
                    <button onClick={() => handleCopyLink(test.id)} className="text-slate-400 hover:text-cyan-600 transition-colors" title="Copy Student Link"><Link size={18}/></button>
                    <button onClick={() => setExamToDelete(test)} className="text-slate-400 hover:text-red-600 transition-colors" title="Delete Exam"><Trash2 size={18}/></button>
                  </div>
                </div>

                {/* 🚀 Feature 3: Passwords Display */}
                <div className="bg-slate-50 border border-slate-100 rounded-lg p-3 mb-4 space-y-1.5">
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-slate-500 font-bold uppercase flex items-center gap-1"><Key size={12}/> Start Pwd:</span>
                    <span className="font-mono font-black text-slate-800 bg-white border px-1.5 py-0.5 rounded">{test.start_password || '********'}</span>
                  </div>
                  {test.end_password && (
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-slate-500 font-bold uppercase flex items-center gap-1"><Key size={12}/> End Pwd:</span>
                      <span className="font-mono font-black text-slate-800 bg-white border px-1.5 py-0.5 rounded">{test.end_password}</span>
                    </div>
                  )}
                </div>

                <div className="space-y-2 mb-6 flex-grow">
                  <div className="flex items-center justify-between text-sm"><span className="text-slate-500 font-bold flex items-center gap-1.5"><CalendarDays size={14}/> Scheduled</span><span className="font-bold text-slate-700">{new Date(test.starts_at_ms).toLocaleDateString()}</span></div>
                  <div className="flex items-center justify-between text-sm"><span className="text-slate-500 font-bold flex items-center gap-1.5"><Clock size={14}/> Starts in</span><span className="font-bold text-cyan-700 bg-cyan-50 px-2 py-0.5 rounded"><LiveCountdown rawDate={test.starts_at_ms} isUpcoming={true} ts={ts} /></span></div>
                </div>
                <div className="flex gap-2 mt-auto">
                  <button onClick={() => onViewUpcoming(test)} className="flex-1 py-2.5 bg-cyan-50 hover:bg-cyan-100 text-cyan-700 rounded-xl text-sm font-bold transition-colors">Preview Setup</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── DRAFTS ── */}
      {draftTests.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-4"><FileEdit size={20} className="text-amber-500" /><h2 className="text-lg font-black text-slate-900 tracking-tight">Saved Drafts</h2></div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {draftTests.map(test => (
              <div key={test.id} className="bg-amber-50/30 border border-amber-200 rounded-2xl p-4 flex justify-between items-center group">
                <div className="overflow-hidden pr-4"><h3 className="font-bold text-slate-800 truncate">{test.title}</h3><p className="text-xs text-amber-600 font-semibold mt-0.5">Unpublished Setup</p></div>
                <div className="flex gap-2">
                  <button onClick={() => handleEditDraft(test.id)} className="p-2 text-slate-500 hover:text-cyan-700 hover:bg-white rounded-lg transition-all font-bold text-sm border border-transparent hover:border-cyan-200"><FileEdit size={16}/></button>
                  <button onClick={() => setExamToDelete(test)} className="p-2 text-slate-400 hover:text-red-600 hover:bg-white rounded-lg transition-all border border-transparent hover:border-red-200"><Trash2 size={16}/></button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── PAST ANALYTICS ── */}
      <section>
        <div className="flex items-center gap-2 mb-4"><BarChart2 size={20} className="text-emerald-600" /><h2 className="text-lg font-black text-slate-900 tracking-tight">Past Examinations & Analytics</h2></div>
        {pastTests.length === 0 ? (
          <div className="bg-slate-50 border border-slate-200 border-dashed rounded-2xl p-8 text-center"><BarChart2 size={32} className="mx-auto text-slate-300 mb-3" /><p className="text-slate-500 font-bold">No completed exams yet.</p></div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 border-b border-slate-200 text-xs uppercase font-bold text-slate-500"><tr><th className="px-6 py-4">Test Title</th><th className="px-6 py-4">Date Conducted</th><th className="px-6 py-4 text-center">Participants</th><th className="px-6 py-4 text-right">Actions</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {pastTests.map(test => (
                  <tr key={test.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-4 font-bold text-slate-900">{test.title}</td>
                    <td className="px-6 py-4 text-slate-600 font-medium">{new Date(test.starts_at_ms).toLocaleDateString()}</td>
                    <td className="px-6 py-4 text-center text-slate-700 font-semibold">{test.participants || 0}</td>
                    <td className="px-6 py-4 text-right flex justify-end gap-2">
                      <button onClick={() => onViewAnalytics(test)} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-lg font-bold transition-colors">View Analytics</button>
                      <button onClick={() => setExamToDelete(test)} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"><Trash2 size={18}/></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}