import React, { useState, useEffect, useRef } from 'react';
import {
  Activity, LayoutDashboard, BookOpen, Users, Monitor,
  BarChart2, LogOut, User, X, Lock, KeyRound, ChevronDown,
  PlusCircle, Trash2, Edit3, Eye, RefreshCw, Search,
  Clock, CheckCircle, AlertTriangle, Shield, Wifi, WifiOff
} from 'lucide-react';
import api from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import { useNavigate } from 'react-router-dom';

// ── ADMIN API HELPER ───────────────────────────────────────────────────────────
// All admin routes require X-Admin-Token header instead of Bearer JWT
const adminApi = {
  get:    (path) => fetch(`${import.meta.env.VITE_API_URL}${path}`, { headers: adminHeaders() }).then(r => r.json()),
  post:   (path, body) => fetch(`${import.meta.env.VITE_API_URL}${path}`, { method: 'POST',   headers: adminHeaders(), body: JSON.stringify(body) }).then(r => r.json()),
  put:    (path, body) => fetch(`${import.meta.env.VITE_API_URL}${path}`, { method: 'PUT',    headers: adminHeaders(), body: JSON.stringify(body) }).then(r => r.json()),
  delete: (path)       => fetch(`${import.meta.env.VITE_API_URL}${path}`, { method: 'DELETE', headers: adminHeaders() }).then(r => r.json()),
};

function adminHeaders() {
  const token = sessionStorage.getItem('lias_admin_token') || '';
  return { 'Content-Type': 'application/json', 'X-Admin-Token': token };
}

// ── SHARED COMPONENTS ──────────────────────────────────────────────────────────
const StatusBadge = ({ status }) => {
  const map = {
    live:      'bg-red-50 text-red-700 border-red-200 animate-pulse',
    upcoming:  'bg-indigo-50 text-indigo-700 border-indigo-200',
    completed: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    draft:     'bg-amber-50 text-amber-700 border-amber-200',
  };
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${map[status] || map.draft}`}>
      {status}
    </span>
  );
};

const Modal = ({ title, onClose, children, footer }) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
    <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={onClose} />
    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg relative z-10 overflow-hidden border border-slate-200">
      <div className="flex items-center justify-between p-6 border-b border-slate-100">
        <h2 className="text-lg font-bold text-slate-900">{title}</h2>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X size={20} /></button>
      </div>
      <div className="p-6 space-y-4">{children}</div>
      {footer && <div className="p-6 border-t border-slate-100 bg-slate-50 flex justify-end gap-3">{footer}</div>}
    </div>
  </div>
);

const Field = ({ label, ...props }) => (
  <div>
    <label className="block text-xs font-bold text-slate-600 uppercase mb-1.5">{label}</label>
    <input className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:border-cyan-500 outline-none bg-slate-50" {...props} />
  </div>
);

// ── LOGIN GATE ─────────────────────────────────────────────────────────────────
function AdminLoginGate({ onSuccess }) {
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault();
    if (!token.trim()) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL}/admin/exams`, {
        headers: { 'X-Admin-Token': token.trim() },
      });
      if (res.ok) {
        sessionStorage.setItem('lias_admin_token', token.trim());
        onSuccess();
      } else {
        setError('Invalid admin token.');
      }
    } catch {
      setError('Cannot reach server.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-8 border border-slate-200">
        <div className="flex items-center gap-3 mb-8">
          <div className="w-10 h-10 bg-cyan-600 rounded-xl flex items-center justify-center">
            <Shield size={22} className="text-white" />
          </div>
          <div>
            <h1 className="text-xl font-black text-slate-900">LIAS Admin</h1>
            <p className="text-xs text-slate-500 font-medium">Secure Control Panel</p>
          </div>
        </div>
        {error && <p className="text-sm text-red-500 font-bold mb-4">{error}</p>}
        <form onSubmit={handleLogin} className="space-y-4">
          <div className="relative">
            <Lock size={16} className="absolute left-3 top-3 text-slate-400" />
            <input
              type="password"
              placeholder="Admin token"
              value={token}
              onChange={e => setToken(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-lg text-sm outline-none focus:border-cyan-500"
            />
          </div>
          <button type="submit" disabled={loading}
            className="w-full bg-cyan-600 hover:bg-cyan-700 text-white font-bold py-3 rounded-lg text-sm">
            {loading ? 'Verifying...' : 'Enter Control Panel'}
          </button>
        </form>
      </div>
    </div>
  );
}

// ── EXAM MANAGER VIEW ──────────────────────────────────────────────────────────
function ExamManagerView() {
  const [exams, setExams]         = useState([]);
  const [loading, setLoading]     = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing]     = useState(null);
  const [form, setForm]           = useState({
    title: '', duration_minutes: 120, starts_at: '',
    start_password: '', end_password: '', status: 'upcoming',
  });

  const fetchExams = async () => {
    setLoading(true);
    const res = await adminApi.get('/admin/exams');
    if (res.success) setExams(res.data);
    setLoading(false);
  };

  useEffect(() => { fetchExams(); }, []);

  const openCreate = () => {
    setEditing(null);
    setForm({ title: '', duration_minutes: 120, starts_at: '', start_password: '', end_password: '', status: 'upcoming' });
    setShowCreate(true);
  };

  const openEdit = async (exam) => {
    const res = await adminApi.get(`/admin/exams/${exam.id}`);
    if (!res.success) return alert('Failed to load exam.');
    const d = res.data;
    const dt = new Date(d.starts_at_ms);
    const localISO = new Date(dt.getTime() - dt.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    setForm({ title: d.title, duration_minutes: d.duration_minutes, starts_at: localISO, start_password: '', end_password: '', status: 'upcoming' });
    setEditing(exam.id);
    setShowCreate(true);
  };

  const handleSubmit = async () => {
    if (!form.title || !form.starts_at || !form.duration_minutes) return alert('Fill required fields.');
    const payload = {
      ...form,
      duration_minutes: parseInt(form.duration_minutes),
      starts_at: new Date(form.starts_at).getTime(),
    };
    if (editing) {
      if (!form.start_password) delete payload.start_password;
      if (!form.end_password)   delete payload.end_password;
      const res = await adminApi.put(`/admin/exams/${editing}`, payload);
      if (!res.success) return alert(res.detail || 'Update failed.');
    } else {
      if (!form.start_password) return alert('Start password is required.');
      const res = await adminApi.post('/admin/exams', payload);
      if (!res.success) return alert(res.detail || 'Create failed.');
    }
    setShowCreate(false);
    fetchExams();
  };

  const handleDelete = async (id, title) => {
    if (!confirm(`Delete "${title}" and ALL related data? This cannot be undone.`)) return;
    const res = await adminApi.delete(`/admin/exams/${id}`);
    if (res.success) fetchExams();
    else alert(res.detail || 'Delete failed.');
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-slate-900">Exam Management</h2>
        <div className="flex gap-3">
          <button onClick={fetchExams} className="p-2 border border-slate-200 rounded-lg hover:bg-slate-50 text-slate-500">
            <RefreshCw size={16} />
          </button>
          <button onClick={openCreate} className="flex items-center gap-2 bg-cyan-600 hover:bg-cyan-700 text-white font-bold px-4 py-2 rounded-lg text-sm">
            <PlusCircle size={16} /> New Exam
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-16 text-slate-400 font-bold animate-pulse">Loading exams...</div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
          <table className="w-full text-sm text-left">
            <thead className="bg-slate-50 border-b border-slate-200 text-xs uppercase font-bold text-slate-500">
              <tr>
                <th className="px-6 py-4">Title</th>
                <th className="px-6 py-4">Starts At</th>
                <th className="px-6 py-4 text-center">Duration</th>
                <th className="px-6 py-4 text-center">Status</th>
                <th className="px-6 py-4 text-center">Students</th>
                <th className="px-6 py-4 text-center">Submitted</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {exams.length === 0 && (
                <tr><td colSpan="7" className="text-center py-12 text-slate-400 italic">No exams found. Create one above.</td></tr>
              )}
              {exams.map(exam => (
                <tr key={exam.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-6 py-4 font-bold text-slate-900">{exam.title}</td>
                  <td className="px-6 py-4 text-slate-600 font-medium">{new Date(exam.starts_at_ms).toLocaleString()}</td>
                  <td className="px-6 py-4 text-center text-slate-700 font-semibold">{exam.duration_minutes} min</td>
                  <td className="px-6 py-4 text-center"><StatusBadge status={exam.status} /></td>
                  <td className="px-6 py-4 text-center font-bold text-slate-700">{exam.participants}</td>
                  <td className="px-6 py-4 text-center font-bold text-emerald-600">{exam.submitted}</td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex justify-end gap-2">
                      <button onClick={() => openEdit(exam)} className="p-1.5 hover:bg-amber-50 hover:text-amber-600 text-slate-400 rounded-lg transition-colors"><Edit3 size={16} /></button>
                      <button onClick={() => handleDelete(exam.id, exam.title)} className="p-1.5 hover:bg-red-50 hover:text-red-600 text-slate-400 rounded-lg transition-colors"><Trash2 size={16} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && (
        <Modal
          title={editing ? 'Edit Exam' : 'Create New Exam'}
          onClose={() => setShowCreate(false)}
          footer={
            <>
              <button onClick={() => setShowCreate(false)} className="px-4 py-2 text-slate-600 font-bold hover:bg-slate-100 rounded-lg">Cancel</button>
              <button onClick={handleSubmit} className="px-6 py-2 bg-cyan-600 text-white font-bold rounded-lg">{editing ? 'Save Changes' : 'Create Exam'}</button>
            </>
          }
        >
          <Field label="Title *" value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} placeholder="e.g. LIAS Placement Drive 2026" />
          <Field label="Start Date & Time *" type="datetime-local" value={form.starts_at} onChange={e => setForm(p => ({ ...p, starts_at: e.target.value }))} />
          <Field label="Duration (minutes) *" type="number" value={form.duration_minutes} onChange={e => setForm(p => ({ ...p, duration_minutes: e.target.value }))} min="1" max="480" />
          <Field label={editing ? 'New Start Password (leave blank to keep)' : 'Start Password *'} type="password" value={form.start_password} onChange={e => setForm(p => ({ ...p, start_password: e.target.value }))} />
          <Field label={editing ? 'New End Password (leave blank to keep)' : 'End Password (optional)'} type="password" value={form.end_password} onChange={e => setForm(p => ({ ...p, end_password: e.target.value }))} />
          {!editing && (
            <div>
              <label className="block text-xs font-bold text-slate-600 uppercase mb-1.5">Status</label>
              <select value={form.status} onChange={e => setForm(p => ({ ...p, status: e.target.value }))}
                className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm outline-none bg-slate-50">
                <option value="upcoming">Upcoming</option>
                <option value="draft">Draft</option>
              </select>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}

// ── STUDENT MANAGER VIEW ───────────────────────────────────────────────────────
function StudentManagerView() {
  const [students, setStudents]   = useState([]);
  const [exams, setExams]         = useState([]);
  const [loading, setLoading]     = useState(true);
  const [search, setSearch]       = useState('');
  const [filterExam, setFilterExam] = useState('');
  const [showAdd, setShowAdd]     = useState(false);
  const [editing, setEditing]     = useState(null);
  const [form, setForm]           = useState({ student_id: '', exam_id: '', token: '', password: '' });
  const [editForm, setEditForm]   = useState({ student_id: '', password: '', is_active: true });

  const fetchAll = async () => {
    setLoading(true);
    const [sRes, eRes] = await Promise.all([
      adminApi.get(`/admin/students${filterExam ? `?exam_id=${filterExam}` : ''}`),
      adminApi.get('/admin/exams'),
    ]);
    if (sRes.success) setStudents(sRes.data);
    if (eRes.success) setExams(eRes.data);
    setLoading(false);
  };

  useEffect(() => { fetchAll(); }, [filterExam]);

  const filtered = students.filter(s =>
    s.student_id.toLowerCase().includes(search.toLowerCase()) ||
    s.token.toLowerCase().includes(search.toLowerCase())
  );

  const handleAdd = async () => {
    if (!form.student_id || !form.exam_id || !form.token || !form.password) return alert('All fields required.');
    const res = await adminApi.post('/admin/students', form);
    if (!res.success) return alert(res.detail || 'Failed to add student.');
    setShowAdd(false);
    setForm({ student_id: '', exam_id: '', token: '', password: '' });
    fetchAll();
  };

  const openEdit = (s) => {
    setEditing(s.token);
    setEditForm({ student_id: s.student_id, password: '', is_active: s.is_active });
  };

  const handleUpdate = async () => {
    const payload = { ...editForm };
    if (!payload.password) delete payload.password;
    const res = await adminApi.put(`/admin/students/${editing}`, payload);
    if (!res.success) return alert(res.detail || 'Update failed.');
    setEditing(null);
    fetchAll();
  };

  const handleRemove = async (token, student_id) => {
    if (!confirm(`Remove student "${student_id}"? Their session will be revoked.`)) return;
    const res = await adminApi.delete(`/admin/students/${token}`);
    if (res.success) fetchAll();
    else alert(res.detail || 'Remove failed.');
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h2 className="text-xl font-bold text-slate-900">Student Management</h2>
        <div className="flex gap-3">
          <select value={filterExam} onChange={e => setFilterExam(e.target.value)}
            className="border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none bg-white">
            <option value="">All Exams</option>
            {exams.map(e => <option key={e.id} value={e.id}>{e.title}</option>)}
          </select>
          <button onClick={fetchAll} className="p-2 border border-slate-200 rounded-lg hover:bg-slate-50 text-slate-500"><RefreshCw size={16} /></button>
          <button onClick={() => setShowAdd(true)} className="flex items-center gap-2 bg-cyan-600 hover:bg-cyan-700 text-white font-bold px-4 py-2 rounded-lg text-sm">
            <PlusCircle size={16} /> Add Student
          </button>
        </div>
      </div>

      <div className="relative">
        <Search size={16} className="absolute left-3 top-3 text-slate-400" />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by student ID or token..."
          className="w-full pl-9 pr-4 py-2.5 border border-slate-200 rounded-lg text-sm outline-none focus:border-cyan-500 bg-white" />
      </div>

      {loading ? (
        <div className="text-center py-16 text-slate-400 font-bold animate-pulse">Loading students...</div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
          <table className="w-full text-sm text-left">
            <thead className="bg-slate-50 border-b border-slate-200 text-xs uppercase font-bold text-slate-500">
              <tr>
                <th className="px-6 py-4">Student ID</th>
                <th className="px-6 py-4">Token</th>
                <th className="px-6 py-4">Exam</th>
                <th className="px-6 py-4 text-center">Status</th>
                <th className="px-6 py-4 text-center">Submitted</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.length === 0 && (
                <tr><td colSpan="6" className="text-center py-12 text-slate-400 italic">No students found.</td></tr>
              )}
              {filtered.map(s => (
                <tr key={s.token} className="hover:bg-slate-50 transition-colors">
                  <td className="px-6 py-4 font-bold text-slate-900">{s.student_id}</td>
                  <td className="px-6 py-4 font-mono text-slate-600 text-xs">{s.token}</td>
                  <td className="px-6 py-4 text-slate-600">{s.exam_id}</td>
                  <td className="px-6 py-4 text-center">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold border ${s.is_active ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-100 text-slate-500 border-slate-200'}`}>
                      {s.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-center">
                    {s.submitted
                      ? <CheckCircle size={16} className="text-emerald-500 mx-auto" />
                      : <span className="text-slate-300 text-xs">—</span>}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex justify-end gap-2">
                      <button onClick={() => openEdit(s)} className="p-1.5 hover:bg-amber-50 hover:text-amber-600 text-slate-400 rounded-lg"><Edit3 size={15} /></button>
                      <button onClick={() => handleRemove(s.token, s.student_id)} className="p-1.5 hover:bg-red-50 hover:text-red-600 text-slate-400 rounded-lg"><Trash2 size={15} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showAdd && (
        <Modal title="Add Student" onClose={() => setShowAdd(false)}
          footer={<>
            <button onClick={() => setShowAdd(false)} className="px-4 py-2 text-slate-600 font-bold hover:bg-slate-100 rounded-lg">Cancel</button>
            <button onClick={handleAdd} className="px-6 py-2 bg-cyan-600 text-white font-bold rounded-lg">Add Student</button>
          </>}
        >
          <div>
            <label className="block text-xs font-bold text-slate-600 uppercase mb-1.5">Exam *</label>
            <select value={form.exam_id} onChange={e => setForm(p => ({ ...p, exam_id: e.target.value }))}
              className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm outline-none bg-slate-50">
              <option value="">Select exam...</option>
              {exams.map(e => <option key={e.id} value={e.id}>{e.title}</option>)}
            </select>
          </div>
          <Field label="Student ID *" value={form.student_id} onChange={e => setForm(p => ({ ...p, student_id: e.target.value }))} placeholder="e.g. Ganesh" />
          <Field label="Exam Token *" value={form.token} onChange={e => setForm(p => ({ ...p, token: e.target.value }))} placeholder="e.g. LIAS_Ganesh" />
          <Field label="Password *" type="password" value={form.password} onChange={e => setForm(p => ({ ...p, password: e.target.value }))} />
        </Modal>
      )}

      {editing && (
        <Modal title="Edit Student" onClose={() => setEditing(null)}
          footer={<>
            <button onClick={() => setEditing(null)} className="px-4 py-2 text-slate-600 font-bold hover:bg-slate-100 rounded-lg">Cancel</button>
            <button onClick={handleUpdate} className="px-6 py-2 bg-cyan-600 text-white font-bold rounded-lg">Save Changes</button>
          </>}
        >
          <Field label="Student ID" value={editForm.student_id} onChange={e => setEditForm(p => ({ ...p, student_id: e.target.value }))} />
          <Field label="New Password (leave blank to keep)" type="password" value={editForm.password} onChange={e => setEditForm(p => ({ ...p, password: e.target.value }))} />
          <div className="flex items-center gap-3">
            <input type="checkbox" id="isActive" checked={editForm.is_active} onChange={e => setEditForm(p => ({ ...p, is_active: e.target.checked }))} className="w-4 h-4" />
            <label htmlFor="isActive" className="text-sm font-bold text-slate-700">Active (can log in)</label>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── LIVE MONITOR VIEW ──────────────────────────────────────────────────────────
function LiveMonitorView() {
  const [exams, setExams]         = useState([]);
  const [selected, setSelected]   = useState(null);
  const [monitor, setMonitor]     = useState(null);
  const [loading, setLoading]     = useState(false);
  const [search, setSearch]       = useState('');
  const [syncing, setSyncing]     = useState(false);
  const [newDuration, setNewDuration] = useState('');
  const intervalRef = useRef(null);

  useEffect(() => {
    adminApi.get('/admin/exams').then(res => {
      if (res.success) setExams(res.data.filter(e => e.status === 'live'));
    });
  }, []);

  const fetchMonitor = async (examId) => {
    setLoading(true);
    const res = await adminApi.get(`/admin/exams/${examId}/monitor`);
    if (res.success) {
      setMonitor(res.data);
      setNewDuration(String(res.data.exam.duration_minutes));
    }
    setLoading(false);
  };

  const selectExam = (exam) => {
    setSelected(exam);
    fetchMonitor(exam.id);
    clearInterval(intervalRef.current);
    intervalRef.current = setInterval(() => fetchMonitor(exam.id), 15000);
  };

  useEffect(() => () => clearInterval(intervalRef.current), []);

  const handleSyncTime = async () => {
    if (!newDuration || isNaN(parseInt(newDuration))) return alert('Enter valid duration.');
    if (!confirm(`Instantly change exam duration to ${newDuration} minutes for ALL students?`)) return;
    setSyncing(true);
    const res = await adminApi.post(`/admin/exams/${selected.id}/sync-time`, {
      new_duration_minutes: parseInt(newDuration),
    });
    setSyncing(false);
    if (res.success) alert('✅ Time synced live!');
    else alert('❌ Sync failed: ' + (res.detail || res.message));
  };

  const handleRevoke = async (sessionId, studentId) => {
    if (!confirm(`Kick out "${studentId}"? Their session will be terminated.`)) return;
    const res = await adminApi.delete(`/admin/exams/${selected.id}/sessions/${sessionId}/revoke`);
    if (res.success) fetchMonitor(selected.id);
    else alert('Revoke failed.');
  };

  const filteredSessions = (monitor?.sessions || []).filter(s =>
    s.student_id.toLowerCase().includes(search.toLowerCase())
  );

  const submittedCount = (monitor?.sessions || []).filter(s => s.is_submitted).length;
  const totalCount     = (monitor?.sessions || []).length;

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold text-slate-900">Live Monitor</h2>

      {exams.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-12 text-center text-slate-400 font-bold">
          No live exams at the moment.
        </div>
      ) : (
        <div className="flex flex-wrap gap-3">
          {exams.map(e => (
            <button key={e.id} onClick={() => selectExam(e)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg border font-bold text-sm transition-all ${selected?.id === e.id ? 'bg-cyan-600 text-white border-cyan-600' : 'bg-white text-slate-700 border-slate-200 hover:border-cyan-300'}`}>
              <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              {e.title}
            </button>
          ))}
        </div>
      )}

      {selected && (
        <>
          {/* KPI Row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white border border-slate-200 p-5 rounded-xl shadow-sm">
              <p className="text-xs font-bold text-slate-500 uppercase mb-1">Connected</p>
              <p className="text-3xl font-black text-slate-900">{totalCount}</p>
            </div>
            <div className="bg-white border border-slate-200 p-5 rounded-xl shadow-sm">
              <p className="text-xs font-bold text-slate-500 uppercase mb-1">Submitted</p>
              <p className="text-3xl font-black text-emerald-600">{submittedCount}</p>
            </div>
            <div className="bg-white border border-slate-200 p-5 rounded-xl shadow-sm">
              <p className="text-xs font-bold text-slate-500 uppercase mb-1">In Progress</p>
              <p className="text-3xl font-black text-amber-600">{totalCount - submittedCount}</p>
            </div>
            <div className="bg-white border border-slate-200 p-5 rounded-xl shadow-sm">
              <p className="text-xs font-bold text-slate-500 uppercase mb-1">Duration</p>
              <p className="text-3xl font-black text-cyan-600">{monitor?.exam?.duration_minutes ?? '—'} min</p>
            </div>
          </div>

          {/* Time Sync Controller */}
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 flex flex-col sm:flex-row sm:items-center gap-4">
            <div className="flex-1">
              <p className="font-bold text-amber-800 text-sm">Live Time Control</p>
              <p className="text-xs text-amber-600 mt-0.5">Changes take effect instantly for all connected students via WebSocket.</p>
            </div>
            <div className="flex items-center gap-3">
              <input
                type="number" min="1" value={newDuration}
                onChange={e => setNewDuration(e.target.value)}
                placeholder="Minutes"
                className="w-28 border border-amber-300 rounded-lg px-3 py-2 text-sm outline-none bg-white font-bold"
              />
              <button onClick={handleSyncTime} disabled={syncing}
                className="bg-amber-500 hover:bg-amber-600 text-white font-bold px-4 py-2 rounded-lg text-sm disabled:opacity-50">
                {syncing ? 'Syncing...' : 'Sync Now'}
              </button>
            </div>
          </div>

          {/* Session Table */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
            <div className="p-4 border-b border-slate-100 flex items-center gap-3">
              <Search size={16} className="text-slate-400" />
              <input value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Search student..." className="text-sm outline-none flex-1" />
              <button onClick={() => fetchMonitor(selected.id)} className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400">
                <RefreshCw size={15} />
              </button>
            </div>
            {loading ? (
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
                    <tr><td colSpan="5" className="text-center py-10 text-slate-400 italic">No sessions found.</td></tr>
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
                        <button onClick={() => handleRevoke(s.session_id, s.student_id)}
                          className="text-xs font-bold text-red-500 hover:bg-red-50 px-3 py-1.5 rounded-lg border border-red-200 transition-colors">
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

// ── ROOT ADMIN DASHBOARD ────────────────────────────────────────────────────────
const NAV = [
  { id: 'exams',    label: 'Exam Manager',   icon: BookOpen  },
  { id: 'students', label: 'Students',        icon: Users     },
  { id: 'monitor',  label: 'Live Monitor',    icon: Monitor   },
];

export default function AdminDashboard() {
  const [authed, setAuthed]   = useState(!!sessionStorage.getItem('lias_admin_token'));
  const [activeTab, setActiveTab] = useState('exams');

  if (!authed) return <AdminLoginGate onSuccess={() => setAuthed(true)} />;

  return (
    <div className="min-h-screen bg-[#F8FAFC] font-sans text-slate-900">
      {/* Navbar */}
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
              {NAV.map(n => {
                const Icon = n.icon;
                return (
                  <button key={n.id} onClick={() => setActiveTab(n.id)}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all ${activeTab === n.id ? 'bg-cyan-50 text-cyan-700 border border-cyan-200' : 'text-slate-600 hover:bg-slate-100'}`}>
                    <Icon size={16} /> {n.label}
                  </button>
                );
              })}
              <button
                onClick={() => { sessionStorage.removeItem('lias_admin_token'); setAuthed(false); }}
                className="ml-3 flex items-center gap-1.5 text-sm font-bold text-red-500 hover:bg-red-50 px-3 py-2 rounded-lg transition-colors">
                <LogOut size={15} /> Sign Out
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* Main */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-8 pb-16">
        {activeTab === 'exams'    && <ExamManagerView />}
        {activeTab === 'students' && <StudentManagerView />}
        {activeTab === 'monitor'  && <LiveMonitorView />}
      </main>
    </div>
  );
}