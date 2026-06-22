import React, { useState, useEffect, useCallback, useRef } from 'react';
import { 
  ArrowLeft, Users, CheckCircle, Activity, 
  Clock, RefreshCw, AlertTriangle, ShieldAlert, 
  Unlock, UserX, Lock
} from 'lucide-react';
import { adminApi } from '../../../hooks/useAdminApi';

const MONITOR_POLL_MS = 10000;

// Formats event_type keys like "face_not_detected" → "Face Not Detected"
function fmtLabel(key) {
  return key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// Task 9: Violation breakdown badge row
function ViolationBreakdown({ breakdown, total }) {
  if (!breakdown || total === 0) {
    return <span className="text-slate-300 font-bold text-sm">—</span>;
  }
  const entries = Object.entries(breakdown);
  if (entries.length === 0) return <span className="text-slate-300 font-bold text-sm">—</span>;
  return (
    <div className="flex flex-wrap gap-1 justify-center">
      {entries.map(([key, cnt]) => (
        <span
          key={key}
          className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-md border whitespace-nowrap ${
            key.includes('face') ? 'bg-orange-50 text-orange-700 border-orange-200' :
            key.includes('tab') || key.includes('switch') ? 'bg-purple-50 text-purple-700 border-purple-200' :
            key.includes('object') || key.includes('phone') ? 'bg-red-50 text-red-700 border-red-200' :
            'bg-amber-50 text-amber-700 border-amber-200'
          }`}
        >
          {fmtLabel(key)} ×{cnt}
        </span>
      ))}
    </div>
  );
}

export default function LiveTestMonitor({ test, onBack }) {
  const [monitorData, setMonitorData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [activeTab, setActiveTab] = useState('overview');
  const [actionLoading, setActionLoading] = useState({});
  const intervalRef = useRef(null);

  const fetchMonitor = useCallback(async () => {
    try {
      const res = await adminApi.get(`/admin/exams/${test.id}/monitor`);
      if (res.success) setMonitorData(res.data);
    } catch (err) {
      console.warn('Monitor fetch failed:', err.message);
    } finally {
      setIsLoading(false);
    }
  }, [test.id]);

  useEffect(() => {
    fetchMonitor();
    intervalRef.current = setInterval(fetchMonitor, MONITOR_POLL_MS);
    return () => clearInterval(intervalRef.current);
  }, [fetchMonitor]);

  // Task 10: Revoke (kick out)
  const handleRevoke = async (sessionId, studentId) => {
    if (!window.confirm(`Force terminate exam session for ${studentId}? This auto-submits their current progress.`)) return;
    setActionLoading(prev => ({ ...prev, [`revoke-${sessionId}`]: true }));
    try {
      const res = await adminApi.post('/admin/sessions/revoke', { session_id: sessionId });
      if (res.success) fetchMonitor();
    } catch (err) {
      alert(`Failed to revoke: ${err.message}`);
    } finally {
      setActionLoading(prev => ({ ...prev, [`revoke-${sessionId}`]: false }));
    }
  };

  // Task 10: Grant (unlock locked student)
  const handleGrant = async (sessionId, studentId) => {
    if (!window.confirm(`Unlock exam session for ${studentId}? They will be able to continue from where they left off.`)) return;
    setActionLoading(prev => ({ ...prev, [`grant-${sessionId}`]: true }));
    try {
      const res = await adminApi.post('/admin/sessions/grant', { session_id: sessionId });
      if (res.success) fetchMonitor();
    } catch (err) {
      alert(`Failed to grant: ${err.message}`);
    } finally {
      setActionLoading(prev => ({ ...prev, [`grant-${sessionId}`]: false }));
    }
  };

  const activeStudents = monitorData?.students.filter(s => !s.submitted) || [];
  const submittedStudents = monitorData?.students.filter(s => s.submitted) || [];
  const lockedStudents = monitorData?.students.filter(s => s.is_locked).length ?? 0;

  return (
    <div className="space-y-6">

      {/* HEADER */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="p-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl transition-colors">
            <ArrowLeft size={18} />
          </button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-black text-slate-900">{test?.title}</h1>
              <span className="flex h-2.5 w-2.5 relative">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500"></span>
              </span>
              <span className="text-[10px] font-black text-red-500 uppercase tracking-widest">Live</span>
            </div>
            <p className="text-sm text-slate-400 mt-0.5">Live Proctoring Dashboard · auto-refresh every 10s</p>
          </div>
        </div>
        <button
          onClick={() => { setSyncing(true); fetchMonitor().then(() => setSyncing(false)); }}
          className="flex items-center gap-2 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-sm font-bold transition-all"
        >
          <RefreshCw size={15} className={syncing ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {isLoading ? (
        <div className="py-20 text-center text-slate-400 font-bold">Establishing Secure Uplink...</div>
      ) : !monitorData ? (
        <div className="py-20 text-center text-red-500 font-bold">Failed to load live data.</div>
      ) : (
        <>
          {/* KPI CARDS */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
              <div className="flex justify-between items-start mb-3">
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Enrolled</p>
                <div className="p-2 bg-slate-50 rounded-xl"><Users size={15} className="text-slate-500" /></div>
              </div>
              <h3 className="text-3xl font-black text-slate-800">{monitorData.total_enrolled}</h3>
            </div>
            <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
              <div className="flex justify-between items-start mb-3">
                <p className="text-xs font-bold text-amber-600 uppercase tracking-wider">Active Now</p>
                <div className="p-2 bg-amber-50 rounded-xl"><Activity size={15} className="text-amber-600" /></div>
              </div>
              <h3 className="text-3xl font-black text-amber-600">{monitorData.active_now}</h3>
            </div>
            <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
              <div className="flex justify-between items-start mb-3">
                <p className="text-xs font-bold text-emerald-600 uppercase tracking-wider">Submitted</p>
                <div className="p-2 bg-emerald-50 rounded-xl"><CheckCircle size={15} className="text-emerald-600" /></div>
              </div>
              <h3 className="text-3xl font-black text-emerald-600">{monitorData.total_submitted}</h3>
            </div>
            <div className={`bg-white border rounded-2xl p-5 shadow-sm ${lockedStudents > 0 ? 'border-red-200 bg-red-50/30' : 'border-slate-200'}`}>
              <div className="flex justify-between items-start mb-3">
                <p className={`text-xs font-bold uppercase tracking-wider ${lockedStudents > 0 ? 'text-red-600' : 'text-slate-500'}`}>Locked</p>
                <div className={`p-2 rounded-xl ${lockedStudents > 0 ? 'bg-red-100' : 'bg-slate-50'}`}>
                  <ShieldAlert size={15} className={lockedStudents > 0 ? 'text-red-600' : 'text-slate-400'} />
                </div>
              </div>
              <h3 className={`text-3xl font-black ${lockedStudents > 0 ? 'text-red-600' : 'text-slate-400'}`}>{lockedStudents}</h3>
            </div>
          </div>

          {/* TABS + TABLE */}
          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
            <div className="flex border-b border-slate-200 bg-slate-50/60">
              <button
                onClick={() => setActiveTab('overview')}
                className={`px-6 py-4 text-sm font-bold transition-all border-b-2 ${
                  activeTab === 'overview'
                    ? 'border-blue-600 text-blue-700 bg-white'
                    : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-white/60'
                }`}
              >
                Active Candidates
                <span className={`ml-2 text-xs px-2 py-0.5 rounded-full font-black ${activeTab === 'overview' ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-500'}`}>
                  {activeStudents.length}
                </span>
              </button>
              <button
                onClick={() => setActiveTab('submitted')}
                className={`px-6 py-4 text-sm font-bold transition-all border-b-2 ${
                  activeTab === 'submitted'
                    ? 'border-emerald-600 text-emerald-700 bg-white'
                    : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-white/60'
                }`}
              >
                Completed
                <span className={`ml-2 text-xs px-2 py-0.5 rounded-full font-black ${activeTab === 'submitted' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                  {submittedStudents.length}
                </span>
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-white border-b border-slate-100 text-xs uppercase font-bold text-slate-400 tracking-wider">
                  <tr>
                    <th className="px-6 py-4">Student ID</th>
                    <th className="px-6 py-4 text-center">Status</th>
                    {/* Task 9: Violation breakdown header */}
                    <th className="px-6 py-4 text-center">Violations</th>
                    <th className="px-6 py-4 text-center">Joined At</th>
                    {activeTab === 'overview' && <th className="px-6 py-4 text-right">Actions</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(activeTab === 'overview' ? activeStudents : submittedStudents).length === 0 ? (
                    <tr>
                      <td colSpan="5" className="px-6 py-16 text-center">
                        <CheckCircle size={28} className="text-slate-200 mx-auto mb-2" />
                        <p className="text-slate-400 font-bold text-sm">
                          {activeTab === 'overview' ? 'No active candidates right now.' : 'No submissions yet.'}
                        </p>
                      </td>
                    </tr>
                  ) : (activeTab === 'overview' ? activeStudents : submittedStudents).map(s => (
                    <tr key={s.student_id} className={`transition-colors group ${
                      s.is_locked ? 'bg-red-50/60 hover:bg-red-50/90' :
                      s.total_violations > 0 ? 'bg-amber-50/30 hover:bg-amber-50/50' :
                      'hover:bg-blue-50/30'
                    }`}>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-slate-900">{s.student_id}</span>
                          {s.is_locked && <Lock size={13} className="text-red-500" title="Locked — awaiting admin action" />}
                          {!s.is_locked && s.total_violations >= 3 && <AlertTriangle size={13} className="text-amber-500" />}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-center">
                        {s.submitted
                          ? <span className="text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 px-2.5 py-1 rounded-md uppercase">Completed</span>
                          : s.is_locked
                            ? <span className="text-[10px] font-bold bg-red-50 text-red-700 border border-red-200 px-2.5 py-1 rounded-md uppercase flex items-center gap-1 justify-center">
                                <Lock size={10} /> Locked
                              </span>
                            : <span className="text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200 px-2.5 py-1 rounded-md uppercase">In Exam</span>
                        }
                      </td>
                      {/* Task 9: Show violation breakdown tags */}
                      <td className="px-6 py-4 text-center">
                        <ViolationBreakdown breakdown={s.violation_breakdown} total={s.total_violations} />
                      </td>
                      <td className="px-6 py-4 text-center text-slate-400 font-mono text-xs">
                        {new Date(s.joined_at * 1000).toLocaleTimeString()}
                      </td>
                      {/* Task 10: GRANT + REVOKE actions */}
                      {activeTab === 'overview' && (
                        <td className="px-6 py-4 text-right">
                          <div className="flex items-center justify-end gap-2">
                            {s.is_locked && (
                              <button
                                onClick={() => handleGrant(s.session_id, s.student_id)}
                                disabled={!!actionLoading[`grant-${s.session_id}`]}
                                className="text-xs font-bold text-emerald-700 hover:bg-emerald-50 px-3 py-1.5 rounded-lg border border-emerald-300 transition-colors flex items-center gap-1 disabled:opacity-50"
                                title="Unlock student — resume exam from current state"
                              >
                                <Unlock size={11} />
                                {actionLoading[`grant-${s.session_id}`] ? 'Unlocking…' : 'Grant'}
                              </button>
                            )}
                            <button
                              onClick={() => handleRevoke(s.session_id, s.student_id)}
                              disabled={!!actionLoading[`revoke-${s.session_id}`]}
                              className="text-xs font-bold text-red-600 hover:bg-red-50 px-3 py-1.5 rounded-lg border border-red-200 transition-colors opacity-0 group-hover:opacity-100 flex items-center gap-1 disabled:opacity-50"
                              title="Force terminate — auto-submits current progress"
                            >
                              <UserX size={11} />
                              {actionLoading[`revoke-${s.session_id}`] ? 'Revoking…' : 'Revoke'}
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}