import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { RefreshCw, Search, Clock } from 'lucide-react';
import { adminApi } from '../../hooks/useAdminApi';

const MONITOR_POLL_MS = 15000;

export default function LiveMonitor() {
  const [exams, setExams]         = useState([]);
  const [selected, setSelected]   = useState(null);
  const [monitor, setMonitor]     = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [search, setSearch]       = useState('');
  const [syncing, setSyncing]     = useState(false);
  const [syncError, setSyncError] = useState('');
  const [newDuration, setNewDuration] = useState('');
  const intervalRef = useRef(null);

  // Fetch live exams once on mount
  useEffect(() => {
    adminApi.get('/admin/exams')
      .then(res => {
        if (res.success) setExams(res.data.filter(e => e.status === 'live'));
      })
      .catch(err => console.warn('Live exam fetch failed:', err.message));
  }, []);

  const fetchMonitor = useCallback(async (examId) => {
    setIsLoading(true);
    try {
      const res = await adminApi.get(`/admin/exams/${examId}/monitor`);
      if (res.success) {
        setMonitor(res.data);
        setNewDuration(String(res.data.exam.duration_minutes));
      }
    } catch (err) {
      console.warn('Monitor fetch failed:', err.message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const selectExam = useCallback((exam) => {
    setSelected(exam);
    setSyncError('');
    fetchMonitor(exam.id);
    clearInterval(intervalRef.current);
    intervalRef.current = setInterval(() => fetchMonitor(exam.id), MONITOR_POLL_MS);
  }, [fetchMonitor]);

  // Clean up interval on unmount
  useEffect(() => () => clearInterval(intervalRef.current), []);

  const handleSyncTime = useCallback(async () => {
    setSyncError('');
    const parsed = parseInt(newDuration);
    if (!newDuration || isNaN(parsed) || parsed < 1) {
      setSyncError('Enter a valid duration in minutes.');
      return;
    }
    if (!window.confirm(`Instantly change exam duration to ${parsed} minutes for ALL connected students?`)) return;
    setSyncing(true);
    try {
      await adminApi.post(`/admin/exams/${selected.id}/sync-time`, { new_duration_minutes: parsed });
      fetchMonitor(selected.id);
    } catch (err) {
      setSyncError(`Sync failed: ${err.message}`);
    } finally {
      setSyncing(false);
    }
  }, [newDuration, selected, fetchMonitor]);

  const handleRevoke = useCallback(async (sessionId, studentId) => {
    if (!window.confirm(`Kick out "${studentId}"? Their session will be terminated immediately.`)) return;
    try {
      await adminApi.delete(`/admin/exams/${selected.id}/sessions/${sessionId}/revoke`);
      fetchMonitor(selected.id);
    } catch (err) {
      alert(`Revoke failed: ${err.message}`);
    }
  }, [selected, fetchMonitor]);

  const filteredSessions = useMemo(() =>
    (monitor?.sessions || []).filter(s =>
      s.student_id.toLowerCase().includes(search.toLowerCase())
    ),
    [monitor, search]
  );

  const submittedCount = useMemo(() => (monitor?.sessions || []).filter(s => s.is_submitted).length, [monitor]);
  const totalCount     = (monitor?.sessions || []).length;

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold text-slate-900">Live Monitor</h2>

      {exams.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-12 text-center">
          <div className="w-3 h-3 rounded-full bg-slate-300 mx-auto mb-3" />
          <p className="text-slate-400 font-bold">No live exams at the moment.</p>
        </div>
      ) : (
        <div className="flex flex-wrap gap-3">
          {exams.map(e => (
            <button
              key={e.id}
              onClick={() => selectExam(e)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg border font-bold text-sm transition-all ${selected?.id === e.id ? 'bg-cyan-600 text-white border-cyan-600' : 'bg-white text-slate-700 border-slate-200 hover:border-cyan-300'}`}
            >
              <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              {e.title}
            </button>
          ))}
        </div>
      )}

      {selected && (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: 'Connected',   value: totalCount,                   color: 'text-slate-900' },
              { label: 'Submitted',   value: submittedCount,               color: 'text-emerald-600' },
              { label: 'In Progress', value: totalCount - submittedCount,  color: 'text-amber-600' },
              { label: 'Duration',    value: `${monitor?.exam?.duration_minutes ?? '—'} min`, color: 'text-cyan-600' },
            ].map(({ label, value, color }) => (
              <div key={label} className="bg-white border border-slate-200 p-5 rounded-xl shadow-sm">
                <p className="text-xs font-bold text-slate-500 uppercase mb-1">{label}</p>
                <p className={`text-3xl font-black ${color}`}>{value}</p>
              </div>
            ))}
          </div>

          {/* Time Sync */}
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 flex flex-col sm:flex-row sm:items-center gap-4">
            <div className="flex-1">
              <p className="font-bold text-amber-800 text-sm flex items-center gap-2"><Clock size={15} /> Live Time Control</p>
              <p className="text-xs text-amber-600 mt-0.5">Instantly changes remaining time for all connected students via WebSocket.</p>
              {syncError && <p className="text-xs text-red-600 font-bold mt-1">{syncError}</p>}
            </div>
            <div className="flex items-center gap-3">
              <input
                type="number"
                min="1"
                value={newDuration}
                onChange={e => setNewDuration(e.target.value)}
                placeholder="Minutes"
                className="w-28 border border-amber-300 rounded-lg px-3 py-2 text-sm outline-none bg-white font-bold"
              />
              <button
                onClick={handleSyncTime}
                disabled={syncing}
                className="bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white font-bold px-4 py-2 rounded-lg text-sm transition-colors"
              >
                {syncing ? 'Syncing...' : 'Sync Now'}
              </button>
            </div>
          </div>

          {/* Session Table */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
            <div className="p-4 border-b border-slate-100 flex items-center gap-3">
              <Search size={16} className="text-slate-400 flex-shrink-0" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search student..."
                className="text-sm outline-none flex-1 bg-transparent"
              />
              <button onClick={() => fetchMonitor(selected.id)} className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400 transition-colors" title="Refresh">
                <RefreshCw size={15} />
              </button>
            </div>

            {isLoading ? (
              <div className="py-12 text-center text-slate-400 animate-pulse font-bold">Fetching live data...</div>
            ) : (
              <table className="w-full text-sm text-left">
                <thead className="bg-slate-50 border-b border-slate-200 text-xs uppercase font-bold text-slate-500">
                  <tr>
                    <th className="px-6 py-3">Student</th>
                    <th className="px-6 py-3 text-center">Status</th>
                    <th className="px-6 py-3 text-center">Violations</th>
                    <th className="px-6 py-3 text-center">Joined At</th>
                    <th className="px-6 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredSessions.length === 0 && (
                    <tr><td colSpan="5" className="text-center py-10 text-slate-400 italic">No sessions match your search.</td></tr>
                  )}
                  {filteredSessions.map(s => (
                    <tr key={s.session_id} className={`hover:bg-slate-50 transition-colors ${s.total_violations >= 3 ? 'bg-red-50/40' : ''}`}>
                      <td className="px-6 py-3 font-bold text-slate-900">{s.student_id}</td>
                      <td className="px-6 py-3 text-center">
                        {s.is_submitted
                          ? <span className="text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded uppercase">Submitted</span>
                          : <span className="text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded uppercase animate-pulse">In Exam</span>}
                      </td>
                      <td className="px-6 py-3 text-center">
                        <span className={`font-black text-base ${s.total_violations >= 3 ? 'text-red-600' : s.total_violations > 0 ? 'text-amber-500' : 'text-slate-400'}`}>
                          {s.total_violations}
                        </span>
                      </td>
                      <td className="px-6 py-3 text-center text-slate-500 text-xs font-mono">
                        {new Date(s.created_at * 1000).toLocaleTimeString()}
                      </td>
                      <td className="px-6 py-3 text-right">
                        <button
                          onClick={() => handleRevoke(s.session_id, s.student_id)}
                          className="text-xs font-bold text-red-500 hover:bg-red-50 px-3 py-1.5 rounded-lg border border-red-200 transition-colors"
                        >
                          Kick Out
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}
