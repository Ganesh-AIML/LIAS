import React, { useState, useEffect } from 'react';
import { 
  PlusCircle, Activity, CheckCircle, Clock, Users, 
  BarChart2, CalendarDays, FileText, FileEdit, Trash2, RefreshCw, Link, Copy
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

  const handleDeleteTest = async (id) => {
    if (!window.confirm("Permanently delete this exam and all its data?")) return;
    try {
      await adminApi.delete(`/admin/exams/${id}`);
      fetchExams();
    } catch (err) { alert(err.message); }
  };

  // Feature: Deep Fetch Draft
  const handleEditDraft = async (id) => {
    setIsFetchingDraft(true);
    try {
      const res = await adminApi.get(`/admin/exams/${id}`);
      if (res.success) onResumeDraft(res.data); // Pass full data to ScheduleTest
    } catch (err) { alert("Failed to load draft payload."); } 
    finally { setIsFetchingDraft(false); }
  };

  // Feature: Copy Link
  const handleCopyLink = () => {
    const link = `${window.location.origin}`; // Instructed to share base link to students
    navigator.clipboard.writeText(link);
    alert("Login portal link copied to clipboard!");
  };

  const liveTests = exams.filter(e => e.status === 'live');
  const upcomingTests = exams.filter(e => e.status === 'upcoming');
  const pastTests = exams.filter(e => e.status === 'completed');
  const draftTests = exams.filter(e => e.status === 'draft');

  if (loading || isFetchingDraft) {
    return <div className="flex items-center justify-center py-20 text-slate-400 font-bold animate-pulse"><RefreshCw className="animate-spin mr-2" /> {isFetchingDraft ? 'Hydrating Draft...' : 'Loading Control Panel...'}</div>;
  }

  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      
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
              <div key={test.id} className="bg-white border-2 border-red-100 rounded-2xl p-5 shadow-[0_4px_20px_-4px_rgba(239,68,68,0.1)] relative overflow-hidden group">
                <div className="absolute top-0 right-0 bg-red-50 text-red-600 text-[10px] font-black uppercase px-3 py-1 rounded-bl-lg tracking-widest flex items-center gap-1">Live Now</div>
                <div className="flex justify-between items-start mb-4">
                  <h3 className="font-black text-lg text-slate-900 pr-12 truncate">{test.title}</h3>
                  <button onClick={handleCopyLink} className="text-slate-400 hover:text-cyan-600 transition-colors" title="Copy Student Link"><Link size={18}/></button>
                </div>
                <div className="space-y-2 mb-6">
                  <div className="flex items-center justify-between text-sm"><span className="text-slate-500 font-bold flex items-center gap-1.5"><Clock size={14}/> Ends in</span><span className="font-bold text-red-600 bg-red-50 px-2 py-0.5 rounded"><LiveCountdown rawDate={test.starts_at_ms} duration={test.duration_minutes} isUpcoming={false} ts={ts} /></span></div>
                  <div className="flex items-center justify-between text-sm"><span className="text-slate-500 font-bold flex items-center gap-1.5"><Users size={14}/> Active Now</span><span className="font-black text-slate-700">{test.participants || 0}</span></div>
                </div>
                <button onClick={() => onMonitorLive(test)} className="w-full py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-all shadow-sm"><Activity size={16} /> Enter Live Monitor</button>
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
              <div key={test.id} className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm hover:shadow-md transition-shadow">
                <div className="flex justify-between items-start mb-4">
                  <h3 className="font-black text-lg text-slate-900 truncate">{test.title}</h3>
                  <button onClick={handleCopyLink} className="text-slate-400 hover:text-cyan-600 transition-colors" title="Copy Student Link"><Link size={18}/></button>
                </div>
                <div className="space-y-2 mb-6">
                  <div className="flex items-center justify-between text-sm"><span className="text-slate-500 font-bold flex items-center gap-1.5"><CalendarDays size={14}/> Scheduled</span><span className="font-bold text-slate-700">{new Date(test.starts_at_ms).toLocaleDateString()}</span></div>
                  <div className="flex items-center justify-between text-sm"><span className="text-slate-500 font-bold flex items-center gap-1.5"><Clock size={14}/> Starts in</span><span className="font-bold text-cyan-700 bg-cyan-50 px-2 py-0.5 rounded"><LiveCountdown rawDate={test.starts_at_ms} isUpcoming={true} ts={ts} /></span></div>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => onViewUpcoming(test)} className="flex-1 py-2.5 bg-cyan-50 hover:bg-cyan-100 text-cyan-700 rounded-xl text-sm font-bold transition-colors">Preview Setup</button>
                  <button onClick={() => handleDeleteTest(test.id)} className="p-2.5 bg-red-50 hover:bg-red-100 text-red-600 rounded-xl transition-colors"><Trash2 size={16}/></button>
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
                  <button onClick={() => handleDeleteTest(test.id)} className="p-2 text-slate-400 hover:text-red-600 hover:bg-white rounded-lg transition-all border border-transparent hover:border-red-200"><Trash2 size={16}/></button>
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
                    <td className="px-6 py-4 text-right">
                      <button onClick={() => onViewAnalytics(test)} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-lg font-bold transition-colors">View Analytics</button>
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