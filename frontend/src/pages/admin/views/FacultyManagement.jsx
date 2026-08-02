import { useState, useEffect, useCallback } from 'react';
import { Users, RefreshCw, Save, XCircle, ShieldCheck } from 'lucide-react';
import { adminApi } from '../../../hooks/useAdminApi';

// ── FACULTY MANAGEMENT (admin-only view) ──────────────────────────────────────
export default function FacultyManagement() {
  const [staffList, setStaffList] = useState([]);
  const [modules, setModules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [drafts, setDrafts] = useState({}); // staff_id -> module string ('' = cleared)
  const [savingId, setSavingId] = useState(null);
  const [notice, setNotice] = useState('');

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [staffRes, modRes] = await Promise.all([
        adminApi.get('/admin/staff'),
        adminApi.get('/admin/modules'),
      ]);
      if (staffRes.success) setStaffList(staffRes.data);
      if (modRes.success) setModules(modRes.data);
    } catch (err) {
      alert(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const faculty = staffList.filter(s => s.role === 'faculty');

  const saveModule = async (id) => {
    setSavingId(id);
    setNotice('');
    try {
      const value = drafts[id] || null;
      const res = await adminApi.put(`/admin/staff/${id}`, { module: value });
      if (res.success) {
        setStaffList(list => list.map(s => s.id === id ? { ...s, module: res.module } : s));
        fetchAll(); // refresh module dropdown source
        setNotice('Module updated.');
      }
    } catch (err) {
      alert(err.message);
    } finally {
      setSavingId(null);
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center py-20 text-slate-400 font-bold animate-pulse"><RefreshCw className="animate-spin mr-2" /> Loading Faculty...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 mb-4">
        <Users size={20} className="text-blue-700" />
        <h2 className="text-lg font-black text-slate-900 tracking-tight">Faculty Management</h2>
        <span className="text-[10px] font-black uppercase text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">{faculty.length} faculty</span>
      </div>

      {notice && <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 px-4 py-3 rounded-xl text-sm font-bold">{notice}</div>}

      {faculty.length === 0 ? (
        <div className="bg-slate-50 border border-slate-200 border-dashed rounded-2xl p-8 text-center">
          <Users size={32} className="mx-auto text-slate-300 mb-3" />
          <p className="text-slate-500 font-bold">No faculty accounts yet.</p>
          <p className="text-sm text-slate-400 font-semibold mt-1">Faculty register themselves through the Staff Portal — assign their module here.</p>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 border-b border-slate-200 text-xs uppercase font-bold text-slate-500">
              <tr>
                <th className="px-6 py-4">Name</th>
                <th className="px-6 py-4">Email</th>
                <th className="px-6 py-4">Current Module</th>
                <th className="px-6 py-4">Assign Module</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {faculty.map(s => (
                <tr key={s.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-6 py-4 font-bold text-slate-900">{s.name || '—'}</td>
                  <td className="px-6 py-4 text-slate-600 font-medium">{s.email}</td>
                  <td className="px-6 py-4">
                    {s.module ? (
                      <span className="text-xs font-black uppercase text-blue-700 bg-blue-50 border border-blue-100 px-2 py-0.5 rounded-full">{s.module}</span>
                    ) : (
                      <span className="text-xs font-bold uppercase text-amber-600 bg-amber-50 border border-amber-100 px-2 py-0.5 rounded-full">Pending</span>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <select
                        value={drafts[s.id] !== undefined ? drafts[s.id] : (s.module || '')}
                        onChange={e => setDrafts(d => ({ ...d, [s.id]: e.target.value }))}
                        className="w-48 bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-sm font-semibold focus:outline-none focus:border-blue-600"
                      >
                        <option value="">No module (pending)</option>
                        {modules.map(m => (
                          <option key={m.code} value={m.code}>{m.code} · {m.title}</option>
                        ))}
                      </select>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-right whitespace-nowrap">
                    <button
                      onClick={() => saveModule(s.id)}
                      disabled={savingId === s.id}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-900 hover:bg-blue-800 disabled:opacity-60 text-white rounded-lg font-bold transition-colors"
                    >
                      <Save size={14} /> {savingId === s.id ? 'Saving...' : 'Save'}
                    </button>
                    {s.module && (
                      <button
                        onClick={() => { setDrafts(d => ({ ...d, [s.id]: '' })); saveModule(s.id); }}
                        disabled={savingId === s.id}
                        className="inline-flex items-center gap-1 ml-2 px-2 py-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg font-bold transition-colors"
                        title="Clear module (return to pending)"
                      >
                        <XCircle size={14} /> Clear
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex items-start gap-2 bg-slate-50 border border-slate-200 rounded-xl p-4 text-xs text-slate-500 font-semibold">
        <ShieldCheck size={16} className="text-emerald-600 mt-0.5 shrink-0" />
        <p>
          Assigning a module grants the faculty member full exam-management access to every exam in that module.
          Clearing a module returns them to the pending state — their access is revoked immediately.
        </p>
      </div>
    </div>
  );
}
