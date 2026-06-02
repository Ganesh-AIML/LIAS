import { useState, useEffect, useCallback, useMemo } from 'react';
import { adminApi } from '../../hooks/useAdminApi';
import StatusBadge from '../../components/ui/StatusBadge';
import { Users, CheckCircle, AlertTriangle, Download, BarChart2, ChevronDown, ChevronUp } from 'lucide-react';

const MAX_VIOLATIONS = 3;

// ── CSV EXPORT ─────────────────────────────────────────────────────────────────
function exportCSV(data) {
  if (!data) return;
  const rows = [
    ['Student ID', 'Submitted', 'Joined At', 'Total Violations', 'tab_switch', 'face_absent', 'fullscreen_exit', 'Flagged'],
    ...data.students.map(s => [
      s.student_id,
      s.submitted ? 'Yes' : 'No',
      s.joined_at ? new Date(s.joined_at * 1000).toLocaleString() : 'N/A',
      s.total_violations,
      s.violation_detail?.tab_switch       || 0,
      s.violation_detail?.face_absent      || 0,
      s.violation_detail?.fullscreen_exit  || 0,
      s.total_violations >= MAX_VIOLATIONS ? 'Yes' : 'No',
    ]),
  ];
  const csv = rows.map(r => r.map(v => `"${v}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = `analytics_${data.exam_id}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── VIOLATION BAR ──────────────────────────────────────────────────────────────
function ViolationBar({ label, count, max }) {
  const pct = max > 0 ? Math.round((count / max) * 100) : 0;
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs font-bold text-slate-600">
        <span>{label}</span>
        <span>{count}</span>
      </div>
      <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
        <div className="h-2 bg-red-400 rounded-full transition-all duration-700" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// ── MAIN VIEW ──────────────────────────────────────────────────────────────────
export default function ExamAnalytics() {
  const [exams, setExams]         = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [data, setData]           = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError]         = useState('');
  const [sortCol, setSortCol]     = useState('student_id');
  const [sortAsc, setSortAsc]     = useState(true);

  // Fetch exam list on mount
  useEffect(() => {
    adminApi.get('/admin/exams')
      .then(res => { if (res.success) setExams(res.data); })
      .catch(err => console.warn('Exam list fetch failed:', err.message));
  }, []);

  const fetchAnalytics = useCallback(async (examId) => {
    if (!examId) return;
    setIsLoading(true);
    setError('');
    setData(null);
    try {
      const res = await adminApi.get(`/admin/exams/${examId}/analytics`);
      if (res.success) setData(res.data);
      else throw new Error(res.detail || 'Failed to load analytics.');
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleExamChange = useCallback((e) => {
    setSelectedId(e.target.value);
    fetchAnalytics(e.target.value);
  }, [fetchAnalytics]);

  const handleSort = useCallback((col) => {
    setSortCol(prev => {
      if (prev === col) { setSortAsc(a => !a); return col; }
      setSortAsc(true);
      return col;
    });
  }, []);

  const sortedStudents = useMemo(() => {
    if (!data?.students) return [];
    return [...data.students].sort((a, b) => {
      const av = a[sortCol] ?? '';
      const bv = b[sortCol] ?? '';
      if (typeof av === 'string') return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
      return sortAsc ? av - bv : bv - av;
    });
  }, [data, sortCol, sortAsc]);

  const SortIcon = ({ col }) => {
    if (sortCol !== col) return null;
    return sortAsc ? <ChevronUp size={13} className="inline ml-0.5" /> : <ChevronDown size={13} className="inline ml-0.5" />;
  };

  const maxViolation = data ? Math.max(...Object.values(data.violation_breakdown || {}), 1) : 1;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h2 className="text-xl font-bold text-slate-900">Exam Analytics</h2>
        {data && (
          <button
            onClick={() => exportCSV(data)}
            className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-4 py-2 rounded-lg text-sm"
          >
            <Download size={16} /> Export CSV
          </button>
        )}
      </div>

      {/* Exam Picker */}
      <div>
        <label className="block text-xs font-bold text-slate-600 uppercase mb-1.5">Select Exam</label>
        <select
          value={selectedId}
          onChange={handleExamChange}
          className="w-full max-w-md border border-slate-200 rounded-lg px-3 py-2.5 text-sm outline-none bg-white focus:border-cyan-500"
        >
          <option value="">Choose an exam...</option>
          {exams.map(e => <option key={e.id} value={e.id}>{e.title} — {e.status}</option>)}
        </select>
      </div>

      {isLoading && (
        <div className="py-20 text-center text-slate-400 font-bold animate-pulse">Loading analytics...</div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-600 font-bold p-4 rounded-xl text-sm">{error}</div>
      )}

      {!isLoading && selectedId && !data && !error && (
        <div className="py-16 text-center text-slate-400 font-bold">No submissions found for this exam.</div>
      )}

      {data && !isLoading && (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white border border-slate-200 p-5 rounded-xl shadow-sm">
              <p className="text-xs font-bold text-slate-500 uppercase flex items-center gap-1.5 mb-1">
                <Users size={13} className="text-slate-400" /> Enrolled
              </p>
              <p className="text-3xl font-black text-slate-900">{data.total_enrolled}</p>
            </div>
            <div className="bg-white border border-slate-200 p-5 rounded-xl shadow-sm">
              <p className="text-xs font-bold text-slate-500 uppercase flex items-center gap-1.5 mb-1">
                <CheckCircle size={13} className="text-emerald-500" /> Submitted
              </p>
              <p className="text-3xl font-black text-emerald-600">{data.total_submitted}</p>
            </div>
            <div className="bg-white border border-slate-200 p-5 rounded-xl shadow-sm">
              <p className="text-xs font-bold text-slate-500 uppercase flex items-center gap-1.5 mb-1">
                <AlertTriangle size={13} className="text-red-500" /> Total Violations
              </p>
              <p className="text-3xl font-black text-red-600">{data.total_violations}</p>
            </div>
            <div className="bg-white border border-slate-200 p-5 rounded-xl shadow-sm">
              <p className="text-xs font-bold text-slate-500 uppercase flex items-center gap-1.5 mb-1">
                <AlertTriangle size={13} className="text-amber-500" /> Flagged
              </p>
              <p className="text-3xl font-black text-amber-600">
                {data.students.filter(s => s.total_violations >= MAX_VIOLATIONS).length}
              </p>
            </div>
          </div>

          {/* Violation Breakdown */}
          {Object.keys(data.violation_breakdown || {}).length > 0 && (
            <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm space-y-4">
              <h3 className="font-bold text-slate-900 text-sm uppercase tracking-wide flex items-center gap-2">
                <BarChart2 size={16} className="text-red-400" /> Violation Breakdown
              </h3>
              {Object.entries(data.violation_breakdown).map(([type, count]) => (
                <ViolationBar key={type} label={type.replace(/_/g, ' ')} count={count} max={maxViolation} />
              ))}
            </div>
          )}

          {/* Student Table */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
            <div className="p-4 border-b border-slate-100 bg-slate-50">
              <h3 className="font-bold text-slate-900 text-sm">Per-Student Results</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-slate-50 border-b border-slate-200 text-xs uppercase font-bold text-slate-500">
                  <tr>
                    <th className="px-6 py-3 cursor-pointer select-none hover:text-slate-800" onClick={() => handleSort('student_id')}>
                      Student <SortIcon col="student_id" />
                    </th>
                    <th className="px-6 py-3 text-center cursor-pointer select-none hover:text-slate-800" onClick={() => handleSort('submitted')}>
                      Submitted <SortIcon col="submitted" />
                    </th>
                    <th className="px-6 py-3 text-center cursor-pointer select-none hover:text-slate-800" onClick={() => handleSort('total_violations')}>
                      Violations <SortIcon col="total_violations" />
                    </th>
                    <th className="px-6 py-3 text-center">Joined At</th>
                    <th className="px-6 py-3 text-center">Flagged</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sortedStudents.length === 0 && (
                    <tr><td colSpan="5" className="text-center py-10 text-slate-400 italic">No student data.</td></tr>
                  )}
                  {sortedStudents.map(s => {
                    const isFlagged = s.total_violations >= MAX_VIOLATIONS;
                    return (
                      <tr key={s.student_id} className={`hover:bg-slate-50 transition-colors ${isFlagged ? 'bg-red-50/30' : ''}`}>
                        <td className="px-6 py-3 font-bold text-slate-900">{s.student_id}</td>
                        <td className="px-6 py-3 text-center">
                          {s.submitted
                            ? <CheckCircle size={16} className="text-emerald-500 mx-auto" />
                            : <span className="text-slate-300 text-xs font-bold">—</span>}
                        </td>
                        <td className="px-6 py-3 text-center">
                          <span className={`font-black text-base ${isFlagged ? 'text-red-600' : s.total_violations > 0 ? 'text-amber-500' : 'text-slate-400'}`}>
                            {s.total_violations}
                          </span>
                        </td>
                        <td className="px-6 py-3 text-center text-slate-500 text-xs font-mono">
                          {s.joined_at ? new Date(s.joined_at * 1000).toLocaleTimeString() : '—'}
                        </td>
                        <td className="px-6 py-3 text-center">
                          {isFlagged && (
                            <span className="inline-flex items-center gap-1 bg-red-50 text-red-700 border border-red-200 px-2 py-0.5 rounded text-[10px] font-bold uppercase">
                              <AlertTriangle size={10} /> Flagged
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}