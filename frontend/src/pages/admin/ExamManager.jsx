import { useState, useEffect, useCallback } from 'react';
import { PlusCircle, RefreshCw, Edit3, Trash2, Link, Copy, CheckCircle } from 'lucide-react';
import { adminApi } from '../../hooks/useAdminApi';
import Modal from '../../components/ui/Modal';
import Field from '../../components/ui/Field';
import StatusBadge from '../../components/ui/StatusBadge';

const POLL_INTERVAL_MS = 60000;

// ── GENERATE LINKS PANEL ───────────────────────────────────────────────────────
function GenerateLinksPanel({ exam, onClose }) {
  const [links, setLinks]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  const [copied, setCopied]   = useState(false);

  useEffect(() => {
    const fetchLinks = async () => {
      try {
        const studentsRes = await adminApi.get(`/admin/students?exam_id=${exam.id}`);
        if (!studentsRes.success) throw new Error('Failed to load students.');
        const tokens = studentsRes.data.map(s => s.token);
        if (tokens.length === 0) {
          setLinks([]);
          setLoading(false);
          return;
        }
        const linksRes = await adminApi.post(`/admin/exams/${exam.id}/generate-links`, {
          student_tokens: tokens,
        });
        if (!linksRes.success) throw new Error(linksRes.detail || 'Link generation failed.');
        setLinks(linksRes.links);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    fetchLinks();
  }, [exam.id]);

  const handleCopyAll = useCallback(() => {
    const text = links
      .map(l => `${l.student_id}: ${l.link}`)
      .join('\n');
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [links]);

  return (
    <Modal
      title={`Student Links — ${exam.title}`}
      onClose={onClose}
      footer={
        links.length > 0 && (
          <button
            onClick={handleCopyAll}
            className="flex items-center gap-2 bg-cyan-600 hover:bg-cyan-700 text-white font-bold px-5 py-2 rounded-lg text-sm"
          >
            {copied ? <CheckCircle size={16} /> : <Copy size={16} />}
            {copied ? 'Copied!' : 'Copy All Links'}
          </button>
        )
      }
    >
      {loading && <p className="text-slate-400 text-sm animate-pulse">Generating links...</p>}
      {error   && <p className="text-red-500 text-sm font-bold">{error}</p>}
      {!loading && !error && links.length === 0 && (
        <p className="text-slate-500 text-sm">No students enrolled in this exam yet. Add students first.</p>
      )}
      {links.map(l => (
        <div key={l.token} className="flex items-center justify-between gap-3 bg-slate-50 border border-slate-200 rounded-lg px-4 py-3">
          <div>
            <p className="font-bold text-slate-900 text-sm">{l.student_id}</p>
            <p className="text-xs font-mono text-slate-500 truncate max-w-xs">{l.link}</p>
          </div>
          <button
            onClick={() => navigator.clipboard.writeText(l.link)}
            className="text-slate-400 hover:text-cyan-600 transition-colors flex-shrink-0"
            title="Copy link"
          >
            <Copy size={15} />
          </button>
        </div>
      ))}
    </Modal>
  );
}

// ── MAIN VIEW ──────────────────────────────────────────────────────────────────
export default function ExamManager() {
  const [exams, setExams]           = useState([]);
  const [isLoading, setIsLoading]   = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId]   = useState(null);
  const [linksExam, setLinksExam]   = useState(null);
  const [formError, setFormError]   = useState('');
  const [form, setForm] = useState({
    title: '', duration_minutes: 120, starts_at: '',
    start_password: '', end_password: '', status: 'upcoming',
  });

  const fetchExams = useCallback(async () => {
    try {
      const res = await adminApi.get('/admin/exams');
      if (res.success) setExams(res.data);
    } catch (err) {
      // Network error — silently retain previous data
      console.warn('Exam fetch failed:', err.message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchExams();
    const interval = setInterval(fetchExams, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchExams]);

  const openCreate = useCallback(() => {
    setEditingId(null);
    setFormError('');
    setForm({ title: '', duration_minutes: 120, starts_at: '', start_password: '', end_password: '', status: 'upcoming' });
    setShowCreate(true);
  }, []);

  const openEdit = useCallback(async (exam) => {
    try {
      const res = await adminApi.get(`/admin/exams/${exam.id}`);
      const d   = res.data;
      const dt  = new Date(d.starts_at_ms);
      const localISO = new Date(dt.getTime() - dt.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
      setForm({ title: d.title, duration_minutes: d.duration_minutes, starts_at: localISO, start_password: '', end_password: '', status: 'upcoming' });
      setEditingId(exam.id);
      setFormError('');
      setShowCreate(true);
    } catch (err) {
      alert(`Failed to load exam: ${err.message}`);
    }
  }, []);

  const handleSubmit = useCallback(async () => {
    setFormError('');
    if (!form.title.trim() || !form.starts_at || !form.duration_minutes) {
      setFormError('Title, start time and duration are required.');
      return;
    }
    if (!editingId && !form.start_password) {
      setFormError('Start password is required for new exams.');
      return;
    }
    const payload = {
      ...form,
      duration_minutes: parseInt(form.duration_minutes),
      starts_at: new Date(form.starts_at).getTime(),
    };
    try {
      if (editingId) {
        if (!form.start_password) delete payload.start_password;
        if (!form.end_password)   delete payload.end_password;
        await adminApi.put(`/admin/exams/${editingId}`, payload);
      } else {
        await adminApi.post('/admin/exams', payload);
      }
      setShowCreate(false);
      fetchExams();
    } catch (err) {
      setFormError(err.message);
    }
  }, [form, editingId, fetchExams]);

  const handleDelete = useCallback(async (id, title) => {
    if (!window.confirm(`Delete "${title}" and ALL related data? This cannot be undone.`)) return;
    try {
      await adminApi.delete(`/admin/exams/${id}`);
      fetchExams();
    } catch (err) {
      alert(`Delete failed: ${err.message}`);
    }
  }, [fetchExams]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-slate-900">Exam Management</h2>
        <div className="flex gap-3">
          <button onClick={fetchExams} className="p-2 border border-slate-200 rounded-lg hover:bg-slate-50 text-slate-500" title="Refresh">
            <RefreshCw size={16} />
          </button>
          <button onClick={openCreate} className="flex items-center gap-2 bg-cyan-600 hover:bg-cyan-700 text-white font-bold px-4 py-2 rounded-lg text-sm">
            <PlusCircle size={16} /> New Exam
          </button>
        </div>
      </div>

      {isLoading ? (
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
                <tr><td colSpan="7" className="text-center py-12 text-slate-400 italic">No exams yet. Create one above.</td></tr>
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
                    <div className="flex justify-end gap-1">
                      <button onClick={() => setLinksExam(exam)} className="p-1.5 hover:bg-cyan-50 hover:text-cyan-600 text-slate-400 rounded-lg transition-colors" title="Generate student links">
                        <Link size={15} />
                      </button>
                      <button onClick={() => openEdit(exam)} className="p-1.5 hover:bg-amber-50 hover:text-amber-600 text-slate-400 rounded-lg transition-colors" title="Edit exam">
                        <Edit3 size={15} />
                      </button>
                      <button onClick={() => handleDelete(exam.id, exam.title)} className="p-1.5 hover:bg-red-50 hover:text-red-600 text-slate-400 rounded-lg transition-colors" title="Delete exam">
                        <Trash2 size={15} />
                      </button>
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
          title={editingId ? 'Edit Exam' : 'Create New Exam'}
          onClose={() => setShowCreate(false)}
          footer={
            <>
              <button onClick={() => setShowCreate(false)} className="px-4 py-2 text-slate-600 font-bold hover:bg-slate-100 rounded-lg">Cancel</button>
              <button onClick={handleSubmit} className="px-6 py-2 bg-cyan-600 text-white font-bold rounded-lg">{editingId ? 'Save Changes' : 'Create Exam'}</button>
            </>
          }
        >
          {formError && <p className="text-sm text-red-500 font-bold bg-red-50 p-3 rounded-lg">{formError}</p>}
          <Field label="Title *" value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} placeholder="e.g. LIAS Placement Drive 2026" />
          <Field label="Start Date & Time *" type="datetime-local" value={form.starts_at} onChange={e => setForm(p => ({ ...p, starts_at: e.target.value }))} />
          <Field label="Duration (minutes) *" type="number" value={form.duration_minutes} onChange={e => setForm(p => ({ ...p, duration_minutes: e.target.value }))} min="1" max="480" />
          <Field label={editingId ? 'New Start Password (blank to keep)' : 'Start Password *'} type="password" value={form.start_password} onChange={e => setForm(p => ({ ...p, start_password: e.target.value }))} />
          <Field label={editingId ? 'New End Password (blank to keep)' : 'End Password (optional)'} type="password" value={form.end_password} onChange={e => setForm(p => ({ ...p, end_password: e.target.value }))} />
          {!editingId && (
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

      {linksExam && <GenerateLinksPanel exam={linksExam} onClose={() => setLinksExam(null)} />}
    </div>
  );
}
