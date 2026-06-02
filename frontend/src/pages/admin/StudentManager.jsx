import { useState, useEffect, useCallback, useMemo } from 'react';
import { PlusCircle, RefreshCw, Edit3, Trash2, Search, CheckCircle } from 'lucide-react';
import { adminApi } from '../../hooks/useAdminApi';
import Modal from '../../components/ui/Modal';
import Field from '../../components/ui/Field';

export default function StudentManager() {
  const [students, setStudents]       = useState([]);
  const [exams, setExams]             = useState([]);
  const [isLoading, setIsLoading]     = useState(true);
  const [search, setSearch]           = useState('');
  const [filterExam, setFilterExam]   = useState('');
  const [showAdd, setShowAdd]         = useState(false);
  const [editingToken, setEditingToken] = useState(null);
  const [formError, setFormError]     = useState('');
  const [addForm, setAddForm] = useState({ student_id: '', exam_id: '', token: '', password: '' });
  const [editForm, setEditForm] = useState({ student_id: '', password: '', is_active: true });

  const fetchAll = useCallback(async () => {
    try {
      const [sRes, eRes] = await Promise.all([
        adminApi.get(`/admin/students${filterExam ? `?exam_id=${filterExam}` : ''}`),
        adminApi.get('/admin/exams'),
      ]);
      if (sRes.success) setStudents(sRes.data);
      if (eRes.success) setExams(eRes.data);
    } catch (err) {
      console.warn('Student fetch failed:', err.message);
    } finally {
      setIsLoading(false);
    }
  }, [filterExam]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const filtered = useMemo(() =>
    students.filter(s =>
      s.student_id.toLowerCase().includes(search.toLowerCase()) ||
      s.token.toLowerCase().includes(search.toLowerCase())
    ),
    [students, search]
  );

  const handleAdd = useCallback(async () => {
    setFormError('');
    if (!addForm.student_id || !addForm.exam_id || !addForm.token || !addForm.password) {
      setFormError('All fields are required.');
      return;
    }
    try {
      await adminApi.post('/admin/students', addForm);
      setShowAdd(false);
      setAddForm({ student_id: '', exam_id: '', token: '', password: '' });
      fetchAll();
    } catch (err) {
      setFormError(err.message);
    }
  }, [addForm, fetchAll]);

  const openEdit = useCallback((s) => {
    setEditingToken(s.token);
    setEditForm({ student_id: s.student_id, password: '', is_active: s.is_active });
    setFormError('');
  }, []);

  const handleUpdate = useCallback(async () => {
    setFormError('');
    const payload = { ...editForm };
    if (!payload.password) delete payload.password;
    try {
      await adminApi.put(`/admin/students/${editingToken}`, payload);
      setEditingToken(null);
      fetchAll();
    } catch (err) {
      setFormError(err.message);
    }
  }, [editForm, editingToken, fetchAll]);

  const handleRemove = useCallback(async (token, studentId) => {
    if (!window.confirm(`Remove student "${studentId}"? Their active session will be revoked.`)) return;
    try {
      await adminApi.delete(`/admin/students/${token}`);
      fetchAll();
    } catch (err) {
      alert(`Remove failed: ${err.message}`);
    }
  }, [fetchAll]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h2 className="text-xl font-bold text-slate-900">Student Management</h2>
        <div className="flex gap-3">
          <select
            value={filterExam}
            onChange={e => setFilterExam(e.target.value)}
            className="border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none bg-white"
          >
            <option value="">All Exams</option>
            {exams.map(e => <option key={e.id} value={e.id}>{e.title}</option>)}
          </select>
          <button onClick={fetchAll} className="p-2 border border-slate-200 rounded-lg hover:bg-slate-50 text-slate-500" title="Refresh">
            <RefreshCw size={16} />
          </button>
          <button onClick={() => { setShowAdd(true); setFormError(''); }} className="flex items-center gap-2 bg-cyan-600 hover:bg-cyan-700 text-white font-bold px-4 py-2 rounded-lg text-sm">
            <PlusCircle size={16} /> Add Student
          </button>
        </div>
      </div>

      <div className="relative">
        <Search size={16} className="absolute left-3 top-3 text-slate-400" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by student ID or token..."
          className="w-full pl-9 pr-4 py-2.5 border border-slate-200 rounded-lg text-sm outline-none focus:border-cyan-500 bg-white"
        />
      </div>

      {isLoading ? (
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
                  <td className="px-6 py-4 text-slate-600 text-xs">{s.exam_id}</td>
                  <td className="px-6 py-4 text-center">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold border ${s.is_active ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-100 text-slate-500 border-slate-200'}`}>
                      {s.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-center">
                    {s.submitted
                      ? <CheckCircle size={16} className="text-emerald-500 mx-auto" />
                      : <span className="text-slate-300 text-xs font-bold">—</span>}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex justify-end gap-1">
                      <button onClick={() => openEdit(s)} className="p-1.5 hover:bg-amber-50 hover:text-amber-600 text-slate-400 rounded-lg transition-colors" title="Edit student">
                        <Edit3 size={15} />
                      </button>
                      <button onClick={() => handleRemove(s.token, s.student_id)} className="p-1.5 hover:bg-red-50 hover:text-red-600 text-slate-400 rounded-lg transition-colors" title="Remove student">
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

      {showAdd && (
        <Modal
          title="Add Student"
          onClose={() => setShowAdd(false)}
          footer={
            <>
              <button onClick={() => setShowAdd(false)} className="px-4 py-2 text-slate-600 font-bold hover:bg-slate-100 rounded-lg">Cancel</button>
              <button onClick={handleAdd} className="px-6 py-2 bg-cyan-600 text-white font-bold rounded-lg">Add Student</button>
            </>
          }
        >
          {formError && <p className="text-sm text-red-500 font-bold bg-red-50 p-3 rounded-lg">{formError}</p>}
          <div>
            <label className="block text-xs font-bold text-slate-600 uppercase mb-1.5">Exam *</label>
            <select
              value={addForm.exam_id}
              onChange={e => setAddForm(p => ({ ...p, exam_id: e.target.value }))}
              className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm outline-none bg-slate-50"
            >
              <option value="">Select exam...</option>
              {exams.map(e => <option key={e.id} value={e.id}>{e.title}</option>)}
            </select>
          </div>
          <Field label="Student ID *" value={addForm.student_id} onChange={e => setAddForm(p => ({ ...p, student_id: e.target.value }))} placeholder="e.g. Ganesh" />
          <Field label="Exam Token *" value={addForm.token} onChange={e => setAddForm(p => ({ ...p, token: e.target.value }))} placeholder="e.g. LIAS_Ganesh" />
          <Field label="Password *" type="password" value={addForm.password} onChange={e => setAddForm(p => ({ ...p, password: e.target.value }))} />
        </Modal>
      )}

      {editingToken && (
        <Modal
          title="Edit Student"
          onClose={() => setEditingToken(null)}
          footer={
            <>
              <button onClick={() => setEditingToken(null)} className="px-4 py-2 text-slate-600 font-bold hover:bg-slate-100 rounded-lg">Cancel</button>
              <button onClick={handleUpdate} className="px-6 py-2 bg-cyan-600 text-white font-bold rounded-lg">Save Changes</button>
            </>
          }
        >
          {formError && <p className="text-sm text-red-500 font-bold bg-red-50 p-3 rounded-lg">{formError}</p>}
          <Field label="Student ID" value={editForm.student_id} onChange={e => setEditForm(p => ({ ...p, student_id: e.target.value }))} />
          <Field label="New Password (leave blank to keep)" type="password" value={editForm.password} onChange={e => setEditForm(p => ({ ...p, password: e.target.value }))} />
          <div className="flex items-center gap-3 pt-1">
            <input
              type="checkbox"
              id="isActive"
              checked={editForm.is_active}
              onChange={e => setEditForm(p => ({ ...p, is_active: e.target.checked }))}
              className="w-4 h-4 accent-cyan-600"
            />
            <label htmlFor="isActive" className="text-sm font-bold text-slate-700">Active (can log in)</label>
          </div>
        </Modal>
      )}
    </div>
  );
}
