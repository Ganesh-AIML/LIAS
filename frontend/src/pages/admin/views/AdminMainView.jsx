import { useState, useEffect } from 'react';
import { 
  PlusCircle, Activity, CheckCircle, Clock, Users, 
  BarChart2, CalendarDays, FileText, FileEdit, Trash2 
} from 'lucide-react';

// 🛡️ THE SMART TIMER: Now fueled by the Secure Server Clock!
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

        if (days > 0) {
          setTimeLeft(`${days}d ${hours}h ${m}m`);
        } else if (hours > 0) {
          setTimeLeft(`${hours}h ${m}m ${s}s`);
        } else {
          setTimeLeft(`${m}m ${s < 10 ? '0' : ''}${s}s`);
        }
      }
    };

    updateTimer(); 
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [rawDate, duration, isUpcoming, ts]); // 🚀 Added ts to dependencies

  return <span className={isUpcoming ? "text-indigo-600 font-black tracking-wide" : "text-red-600 font-black tracking-wide"}>{timeLeft}</span>;
};

export default function TnpMainView({ 
  setSelectedTest, 
  onScheduleClick, 
  onViewUpcoming, 
  onResumeDraft, 
  onMonitorLive, 
  onDeleteTest,
  liveTests, 
  pastTests, 
  upcomingTests, 
  draftTests,
  ts // 🚀 ADD THIS PROP
}) {
  
  return (
    <div className="space-y-10 animate-in fade-in duration-300 relative">
      
      {/* COMMAND CENTER HEADER */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Assessment Command Center</h2>
          <p className="text-sm text-slate-500 mt-1">Manage all placement drives and monitor test analytics.</p>
        </div>
        <button onClick={onScheduleClick} className="flex items-center justify-center gap-2 bg-blue-900 hover:bg-blue-800 text-white font-bold py-3 px-6 rounded-xl transition-all shadow-sm">
          <PlusCircle size={20} /> Schedule New Test
        </button>
      </div>

      {/* SAVED DRAFTS */}
      {draftTests?.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-4">
            <FileEdit size={20} className="text-amber-500" />
            <h3 className="text-lg font-bold text-slate-900 uppercase tracking-wide">Saved Drafts</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {draftTests.map(draft => (
              <div key={draft.id} className="bg-white border border-slate-200 border-dashed rounded-xl p-5 shadow-sm flex flex-col justify-between hover:border-amber-300 transition-colors">
                <div>
                  <div className="flex justify-between items-start mb-2"><span className="bg-amber-50 text-amber-700 border border-amber-200 text-[10px] font-bold px-2 py-0.5 rounded uppercase">Draft</span></div>
                  <h4 className="font-bold text-slate-900 mb-2">{draft.title}</h4>
                  <div className="space-y-1.5 mb-4"><div className="flex items-center gap-2 text-xs font-medium text-slate-600"><Clock size={14} className="text-slate-400"/> Saved: {draft.lastSaved}</div></div>
                </div>
                <button onClick={() => onResumeDraft(draft)} className="w-full flex items-center justify-center gap-2 bg-amber-50 hover:bg-amber-100 text-amber-700 font-bold py-2 rounded-lg border border-amber-200 transition-colors text-sm">
                  <FileEdit size={16} /> Resume Editing
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* LIVE EXAMS */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <div className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse"></div>
          <h3 className="text-lg font-bold text-slate-900 uppercase tracking-wide">Live Examinations</h3>
        </div>
        {liveTests?.length > 0 ? (
          <div className="grid grid-cols-1 gap-4">
            {liveTests.map(test => (
              <div key={test.id} className="bg-white border-2 border-red-500/20 rounded-2xl p-6 shadow-sm relative overflow-hidden flex flex-col md:flex-row md:items-center justify-between gap-6">
                <div className="absolute top-0 left-0 w-2 h-full bg-red-500"></div>
                <div className="flex-1 pl-4">
                  <h4 className="text-xl font-bold text-slate-900 mb-3">{test.title}</h4>
                  <div className="flex flex-wrap items-center gap-6">
                    <div className="flex items-center gap-2 text-sm font-semibold text-slate-700 bg-red-50 text-red-600 border border-red-100 px-3 py-1 rounded font-mono">
                      <Clock size={16} className="animate-pulse" /> 
                      <LiveCountdown rawDate={test.rawDate || test.date} duration={test.duration} isUpcoming={false} ts={ts} /> remaining
                    </div>
                  </div>
                </div>
                
                <div className="flex items-center gap-2">
                  <button onClick={() => onMonitorLive(test)} className="bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 font-bold py-2.5 px-6 rounded-lg transition-colors flex items-center gap-2">
                    <Activity size={18} /> Monitor Live
                  </button>
                  <button onClick={() => onDeleteTest(test.id, 'live')} className="bg-white hover:bg-red-50 text-slate-400 hover:text-red-600 border border-slate-200 hover:border-red-200 p-2.5 rounded-lg transition-colors" title="Delete Live Test">
                    <Trash2 size={18} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="bg-slate-100 border border-slate-200 border-dashed rounded-xl p-8 text-center text-slate-500 font-medium">No examinations are currently active.</div>
        )}
      </section>

      {/* UPCOMING EXAMS - styled like the student dashboard! */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <CalendarDays size={20} className="text-indigo-500" />
          <h3 className="text-lg font-bold text-slate-900 uppercase tracking-wide">Upcoming Tests</h3>
        </div>
        {upcomingTests?.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {upcomingTests.map(test => (
              <div key={test.id} className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex flex-col justify-between hover:shadow-md transition-shadow">
                <div>
                  <div className="flex justify-between items-start mb-2"><span className="bg-indigo-50 text-indigo-700 border border-indigo-200 text-[10px] font-bold px-2 py-0.5 rounded uppercase">Scheduled</span></div>
                  <h4 className="font-bold text-slate-900 mb-2">{test.title}</h4>
                  <div className="space-y-2 mb-4">
                    <div className="flex items-center justify-between text-sm text-slate-600">
                      <span className="flex items-center gap-2"><CalendarDays size={14} className="text-slate-400"/> {new Date(test.rawDate || test.date).toLocaleDateString()}</span>
                      <span className="font-semibold text-slate-800">{new Date(test.rawDate || test.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                    <div className="flex items-center justify-between text-sm text-slate-600">
                      <span className="flex items-center gap-2"><Clock size={14} className="text-slate-400"/> {test.duration} Minutes</span>
                    </div>

                    {/* 🛡️ THE UPCOMING TIMER WIDGET */}
                    <div className="flex items-center justify-between text-sm text-slate-600 border-t border-slate-100 pt-3 mt-3">
                      <span className="flex items-center gap-2 font-bold"><Activity size={16} className="text-indigo-500" /> Starts in:</span>
                      <span className="bg-indigo-50 border border-indigo-100 px-2 py-0.5 rounded font-mono text-sm">
                        <LiveCountdown rawDate={test.rawDate || test.date} isUpcoming={true} ts={ts} />
                      </span>
                    </div>
                  </div>
                </div>
                
                <div className="flex gap-2 mt-4">
                  <button onClick={() => onViewUpcoming(test)} className="flex-1 flex items-center justify-center gap-2 bg-slate-50 hover:bg-indigo-50 text-indigo-600 font-bold py-2 rounded-lg border border-slate-200 hover:border-indigo-200 transition-colors text-sm">
                    <FileText size={16} /> View Full Setup
                  </button>
                  <button onClick={() => onDeleteTest(test.id, 'upcoming')} className="flex items-center justify-center bg-white hover:bg-red-50 text-slate-400 hover:text-red-600 border border-slate-200 hover:border-red-200 py-2 px-3 rounded-lg transition-colors" title="Delete Test">
                    <Trash2 size={16} />
                  </button>
                </div>

              </div>
            ))}
          </div>
        ) : (
          <div className="bg-slate-100 border border-slate-200 border-dashed rounded-xl p-8 text-center text-slate-500 font-medium">No upcoming tests scheduled.</div>
        )}
      </section>

      {/* PAST RESULTS */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <CheckCircle size={20} className="text-emerald-500" />
          <h3 className="text-lg font-bold text-slate-900 uppercase tracking-wide">Past Tests & Analytics</h3>
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 border-b border-slate-200 text-xs uppercase font-bold text-slate-500"><tr><th className="px-6 py-4">Test Title</th><th className="px-6 py-4">Date Conducted</th><th className="px-6 py-4 text-center">Participants</th><th className="px-6 py-4 text-center">Avg Score</th><th className="px-6 py-4 text-right">Actions</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {pastTests?.map(test => (
                  <tr key={test.id} className="hover:bg-slate-50 transition-colors"><td className="px-6 py-4 font-bold text-slate-900">{test.title}</td><td className="px-6 py-4 text-slate-600 font-medium">{test.date}</td><td className="px-6 py-4 text-center text-slate-700 font-semibold">{test.participants || 0}</td><td className="px-6 py-4 text-center font-bold text-blue-600">{test.avgScore || 0}</td><td className="px-6 py-4 text-right"><button onClick={() => setSelectedTest(test)} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 font-bold rounded-lg transition-colors text-xs border border-blue-200"><BarChart2 size={14} /> View Analytics</button></td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

    </div>
  );
}