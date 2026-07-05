import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Users, Search, Plus, Edit3, Key, Trash2,
  CheckCircle, Shield, Copy, RefreshCw,
  BookOpen, X, AlertCircle, UserCheck, ChevronRight,
  ArrowLeft, Clock, Zap, Upload
} from 'lucide-react';
import { adminApi } from '../../../hooks/useAdminApi';

// ── HELPERS ────────────────────────────────────────────────────────────────────

const getDept = (id) => {
  if (id && id.includes('-')) return id.split('-')[1].substring(0, 4).toUpperCase();
  return 'GEN';
};

const avatarColor = (id) => {
  const dept = getDept(id);
  const colors = [
    'bg-blue-100 text-blue-700',
    'bg-indigo-100 text-indigo-700',
    'bg-emerald-100 text-emerald-700',
    'bg-amber-100 text-amber-700',
    'bg-slate-100 text-slate-600',
  ];
  return colors[dept.charCodeAt(0) % colors.length];
};

// ── CREDENTIAL MODAL (click exam badge → show token) ──────────────────────────

function CredentialModal({ enrollment, examTitle, onClose }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(enrollment.token);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center">
          <h2 className="text-base font-black text-slate-900 flex items-center gap-2">
            <Key size={15} className="text-blue-600" /> Exam Credential
          </h2>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition-colors">
            <X size={18} />
          </button>
        </div>
        <div className="p-6 space-y-4">
          <div className="bg-slate-50 rounded-xl p-4 border border-slate-200">
            <p className="text-xs font-bold text-slate-400 uppercase mb-1">Exam</p>
            <p className="font-black text-slate-900">{examTitle}</p>
          </div>
          <div className="bg-blue-50 rounded-xl p-4 border border-blue-100">
            <p className="text-xs font-bold text-blue-400 uppercase mb-2">Secure Token</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 font-mono text-sm text-blue-900 bg-white px-3 py-2 rounded-lg border border-blue-100 break-all">
                {enrollment.token}
              </code>
              <button
                onClick={handleCopy}
                className="shrink-0 p-2 text-blue-400 hover:text-blue-700 hover:bg-blue-100 rounded-lg transition-colors"
                title="Copy token"
              >
                <Copy size={15} />
              </button>
            </div>
            {copied && <p className="text-xs text-emerald-600 font-bold mt-1.5">Copied!</p>}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── MAIN COMPONENT ─────────────────────────────────────────────────────────────

export default function StudentDirectory() {
  const [activeTab, setActiveTab] = useState('directory');

  // Master Directory state
  const [masterStudents, setMasterStudents] = useState([]);
  const [exams, setExams] = useState([]);           // all exams (for title lookup)
  const [loading, setLoading] = useState(true);

  // Search / bulk
  const [searchQuery, setSearchQuery] = useState('');
  const [isBulkMode, setIsBulkMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);

  // Add student modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [addForm, setAddForm] = useState({ id: '', name: '', password: '' });
  const [addError, setAddError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Edit student modal
  const [editingStudent, setEditingStudent] = useState(null);
  const [editForm, setEditForm] = useState({ name: '', password: '', is_active: true });
  const [editError, setEditError] = useState('');

  // Reset & Resync (one-click fix for placeholder-hash lockout)
  const [resyncingId, setResyncingId] = useState(null); // student.id currently mid-resync
  const fileInputRef = React.useRef(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState(null); // {created, updated}
  const [uploadError, setUploadError] = useState('');

  // Credential modal (click exam badge)
  const [credModal, setCredModal] = useState(null); // { enrollment, examTitle }

  // ── FETCH ────────────────────────────────────────────────────────────────────

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [msRes, eRes] = await Promise.allSettled([
        adminApi.get('/admin/master-students'),
        adminApi.get('/admin/exams'),
      ]);
      if (msRes.status === 'fulfilled' && msRes.value.success) setMasterStudents(msRes.value.data);
      if (eRes.status  === 'fulfilled' && eRes.value.success)  setExams(eRes.value.data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const getExamTitle = (id) => exams.find(e => e.id === id)?.title || id;

  // ── FILTERED LIST ─────────────────────────────────────────────────────────────

  const filteredStudents = useMemo(() => {
    if (!searchQuery) return masterStudents;
    const lower = searchQuery.toLowerCase();
    return masterStudents.filter(s =>
      s.id.toLowerCase().includes(lower) ||
      (s.name || '').toLowerCase().includes(lower)
    );
  }, [masterStudents, searchQuery]);

  // ── BULK SELECT ───────────────────────────────────────────────────────────────

  const toggleSelectAll = () => {
    const allIds = filteredStudents.map(s => s.id);
    const allSelected = allIds.every(id => selectedIds.includes(id));
    setSelectedIds(allSelected ? [] : allIds);
  };

  const toggleSelect = (id) => {
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  // ── HANDLERS ─────────────────────────────────────────────────────────────────

  const handleBulkDelete = async () => {
    if (!selectedIds.length) return;
    if (!window.confirm(`Remove ${selectedIds.length} student(s) from Master Directory?`)) return;
    setIsBulkDeleting(true);
    try {
      await Promise.all(selectedIds.map(id => adminApi.delete(`/admin/master-students/${encodeURIComponent(id)}`)));
      setIsBulkMode(false);
      setSelectedIds([]);
      fetchData();
    } catch (err) { alert(err.message); }
    finally { setIsBulkDeleting(false); }
  };

  const handleAddSubmit = async (e) => {
    e.preventDefault();
    setAddError('');
    if (!addForm.id.trim() || !addForm.password.trim()) { setAddError('Student ID and password are required.'); return; }
    setIsSubmitting(true);
    try {
      const res = await adminApi.post('/admin/master-students', addForm);
      if (res.success) { setShowAddModal(false); setAddForm({ id: '', name: '', password: '' }); fetchData(); }
    } catch (err) { setAddError(err.message); }
    finally { setIsSubmitting(false); }
  };

  const handleEditSubmit = async (e) => {
    e.preventDefault();
    setEditError('');
    setIsSubmitting(true);
    try {
      const payload = { is_active: editForm.is_active, name: editForm.name || null };
      if (editForm.password) payload.password = editForm.password;
      const res = await adminApi.put(`/admin/master-students/${encodeURIComponent(editingStudent.id)}`, payload);
      if (res.success) { setEditingStudent(null); fetchData(); }
    } catch (err) { setEditError(err.message); }
    finally { setIsSubmitting(false); }
  };

  const handleDeleteOne = async (student) => {
    if (!window.confirm(`Remove "${student.id}" from Master Directory?\n\nEnrollment history is preserved.`)) return;
    try {
      await adminApi.delete(`/admin/master-students/${encodeURIComponent(student.id)}`);
      fetchData();
    } catch (err) { alert(err.message); }
  };

  // One-click fix: set a real password + push it into every TokenRegistry
  // row for this student, in a single call. Fixes the "assigned before a
  // real password existed" lockout without a manual re-assign step.
  const handleResetAndResync = async (student) => {
    const pwd = window.prompt(
      `Set a new password for ${student.id}.\n\nThis will also resync the password into every exam this student is already assigned to, so they can log in immediately.`
    );
    if (!pwd) return;
    setResyncingId(student.id);
    try {
      const res = await adminApi.post(`/admin/master-students/${encodeURIComponent(student.id)}/reset-and-resync`, { password: pwd });
      if (res.success) {
        alert(`Done — password reset and synced to ${res.resynced_tokens} exam token(s).`);
        fetchData();
      }
    } catch (err) { alert(err.message); }
    finally { setResyncingId(null); }
  };

  // ── BULK CSV UPLOAD ──────────────────────────────────────────────────────────
  // Expected columns: id,name,password (header row required, name optional).
  const parseStudentsCsv = (text) => {
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (lines.length === 0) return [];
    const header = lines[0].split(',').map(h => h.trim().toLowerCase());
    const idIdx = header.indexOf('id');
    const nameIdx = header.indexOf('name');
    const pwIdx = header.indexOf('password');
    if (idIdx === -1 || pwIdx === -1) {
      throw new Error('CSV must have "id" and "password" columns (header row required).');
    }
    const startRow = 1; // skip header
    const rows = [];
    for (let i = startRow; i < lines.length; i++) {
      const cols = lines[i].split(',').map(c => c.trim());
      const id = cols[idIdx];
      const password = cols[pwIdx];
      if (!id || !password) continue; // skip incomplete rows rather than failing the whole batch
      rows.push({
        id,
        name: nameIdx !== -1 ? (cols[nameIdx] || null) : null,
        password,
        is_active: true,
      });
    }
    return rows;
  };

  const handleCsvFileSelected = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file later
    if (!file) return;

    setUploadError('');
    setUploadResult(null);

    let students;
    try {
      const text = await file.text();
      students = parseStudentsCsv(text);
    } catch (err) {
      setUploadError(err.message);
      return;
    }
    if (students.length === 0) {
      setUploadError('No valid rows found (need at least "id" and "password" per row).');
      return;
    }

    setIsUploading(true);
    try {
      const res = await adminApi.post('/admin/master-students/bulk', { students });
      if (res.success) {
        setUploadResult({ created: res.created, updated: res.updated });
        fetchData();
      }
    } catch (err) {
      setUploadError(err.message);
    } finally {
      setIsUploading(false);
    }
  };

  // ── RENDER ────────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">

      {/* HEADER */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm flex flex-col md:flex-row gap-4 justify-between md:items-center">
        <div>
          <h1 className="text-xl font-black text-slate-900 flex items-center gap-2">
            <Users size={20} className="text-blue-600" /> Student Directory
          </h1>
          <p className="text-sm text-slate-400 mt-0.5">
            {masterStudents.length} students · {masterStudents.filter(s => s.is_active).length} active
          </p>
        </div>
        {activeTab === 'directory' && (
          <div className="flex flex-wrap items-center gap-3">
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              onChange={handleCsvFileSelected}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
              className="flex items-center gap-2 bg-slate-100 hover:bg-slate-200 text-slate-700 px-4 py-2 rounded-xl text-sm font-bold transition-all disabled:opacity-50 disabled:cursor-wait"
              title="CSV columns: id, name (optional), password"
            >
              <Upload size={15} /> {isUploading ? 'Uploading...' : 'Upload CSV'}
            </button>
            <button
              onClick={() => { setAddForm({ id: '', name: '', password: '' }); setAddError(''); setShowAddModal(true); }}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-xl text-sm font-bold transition-all shadow-sm"
            >
              <Plus size={15} /> Add Student
            </button>
          </div>
        )}
      </div>

      {/* CSV UPLOAD RESULT / ERROR */}
      {uploadResult && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 text-sm font-bold text-emerald-700 flex items-center gap-2">
          <CheckCircle size={15} />
          CSV processed — {uploadResult.created} new · {uploadResult.updated} updated
        </div>
      )}
      {uploadError && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm font-bold text-red-600 flex items-center gap-2">
          <AlertCircle size={15} /> {uploadError}
        </div>
      )}

      {/* TABLE CARD */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden flex flex-col">

        {/* Tabs + controls */}
        <div className="border-b border-slate-200 bg-slate-50/60 flex flex-col sm:flex-row justify-between sm:items-center p-2 pr-4 gap-3">
          <div className="flex gap-1">
            <button
              onClick={() => { setActiveTab('directory'); setIsBulkMode(false); setSelectedIds([]); setSearchQuery(''); }}
              className={`px-4 py-2 text-sm font-bold rounded-xl transition-all flex items-center gap-2 ${activeTab === 'directory' ? 'bg-white text-blue-700 shadow-sm border border-slate-200' : 'text-slate-500 hover:text-slate-700 hover:bg-white/60'}`}
            >
              <Shield size={14} /> Master Directory
            </button>
            <button
              onClick={() => { setActiveTab('credentials'); setIsBulkMode(false); setSelectedIds([]); setSearchQuery(''); }}
              className={`px-4 py-2 text-sm font-bold rounded-xl transition-all flex items-center gap-2 ${activeTab === 'credentials' ? 'bg-white text-blue-700 shadow-sm border border-slate-200' : 'text-slate-500 hover:text-slate-700 hover:bg-white/60'}`}
            >
              <Key size={14} /> Test Credentials
            </button>
          </div>

          {activeTab === 'directory' && (
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <button
                onClick={() => {
                  if (isBulkMode && selectedIds.length > 0) handleBulkDelete();
                  else { setIsBulkMode(!isBulkMode); setSelectedIds([]); }
                }}
                disabled={isBulkDeleting}
                className={`flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all ${
                  isBulkMode
                    ? (selectedIds.length > 0 ? 'bg-red-600 hover:bg-red-700 text-white shadow-sm' : 'bg-slate-200 hover:bg-slate-300 text-slate-700')
                    : 'bg-slate-100 hover:bg-slate-200 text-slate-600'
                } ${isBulkDeleting ? 'opacity-50 cursor-wait' : ''}`}
              >
                <Trash2 size={14} />
                {isBulkDeleting ? 'Deleting...' : isBulkMode ? (selectedIds.length > 0 ? `Delete (${selectedIds.length})` : 'Cancel') : 'Bulk Delete'}
              </button>
              <div className="relative w-full sm:w-64">
                <Search size={14} className="absolute left-3 top-2.5 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search by ID or name..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/20"
                />
              </div>
            </div>
          )}
        </div>

        {/* ── MASTER DIRECTORY TAB ── */}
        {activeTab === 'directory' && (
          <div className="overflow-x-auto min-h-[400px]">
            {loading ? (
              <div className="flex items-center justify-center h-[300px] text-slate-400 font-bold">
                <RefreshCw size={20} className="animate-spin mr-2" /> Loading...
              </div>
            ) : filteredStudents.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-[300px] text-slate-300">
                <Users size={40} className="mb-3" />
                <p className="font-bold text-slate-400">
                  {searchQuery ? 'No students match your search.' : 'No students in Master Directory yet.'}
                </p>
                {!searchQuery && (
                  <button
                    onClick={() => { setAddForm({ id: '', name: '', password: '' }); setAddError(''); setShowAddModal(true); }}
                    className="mt-4 flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-xl text-sm font-bold"
                  >
                    <Plus size={14} /> Add First Student
                  </button>
                )}
              </div>
            ) : (
              <table className="w-full text-left text-sm">
                <thead className="bg-white border-b border-slate-100 text-xs uppercase font-bold text-slate-400 tracking-wider">
                  <tr>
                    {isBulkMode && (
                      <th className="px-6 py-4 w-12 text-center">
                        <input
                          type="checkbox"
                          checked={filteredStudents.length > 0 && filteredStudents.every(s => selectedIds.includes(s.id))}
                          onChange={toggleSelectAll}
                          className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                        />
                      </th>
                    )}
                    <th className="px-6 py-4">Student</th>
                    <th className="px-6 py-4">Assigned Exams</th>
                    <th className="px-6 py-4 text-center">Status</th>
                    <th className="px-6 py-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredStudents.map(s => (
                    <tr key={s.id} className="hover:bg-blue-50/30 transition-colors group">
                      {isBulkMode && (
                        <td className="px-6 py-4 text-center">
                          <input
                            type="checkbox"
                            checked={selectedIds.includes(s.id)}
                            onChange={() => toggleSelect(s.id)}
                            className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                          />
                        </td>
                      )}

                      {/* Student ID + name */}
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center font-black text-xs shrink-0 ${avatarColor(s.id)}`}>
                            {getDept(s.id)}
                          </div>
                          <div>
                            <p className="font-bold text-slate-900 group-hover:text-blue-700 transition-colors">{s.id}</p>
                            {s.name && <p className="text-xs text-slate-400">{s.name}</p>}
                          </div>
                        </div>
                      </td>

                      {/* Exam badges — clickable to reveal token */}
                      <td className="px-6 py-4">
                        <div className="flex flex-wrap gap-1.5">
                          {s.enrollments.length === 0 ? (
                            <span className="text-xs text-slate-300 font-bold">Not assigned</span>
                          ) : s.enrollments.map(enr => (
                            <button
                              key={enr.token}
                              onClick={() => setCredModal({ enrollment: enr, examTitle: getExamTitle(enr.exam_id) })}
                              className="flex items-center gap-1 text-xs font-bold text-indigo-700 bg-indigo-50 border border-indigo-100 px-2.5 py-1 rounded-md hover:bg-indigo-100 hover:border-indigo-300 transition-colors w-max"
                              title="Click to view token"
                            >
                              <BookOpen size={11} /> {getExamTitle(enr.exam_id)}
                            </button>
                          ))}
                        </div>
                      </td>

                      {/* Active status */}
                      <td className="px-6 py-4 text-center">
                        {s.is_active
                          ? <span className="text-[10px] bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-md font-bold uppercase border border-emerald-200">Active</span>
                          : <span className="text-[10px] bg-red-50 text-red-700 px-2 py-0.5 rounded-md font-bold uppercase border border-red-200">Suspended</span>}
                        {s.needs_password_reset && (
                          <div className="mt-1">
                            <span
                              className="text-[10px] bg-amber-50 text-amber-700 px-2 py-0.5 rounded-md font-bold uppercase border border-amber-200"
                              title="Backfilled with a placeholder password — student can't log in until reset."
                            >
                              Needs Reset
                            </span>
                          </div>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="px-6 py-4 text-right">
                        {!isBulkMode && (
                          <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            {s.needs_password_reset && (
                              <button
                                onClick={() => handleResetAndResync(s)}
                                disabled={resyncingId === s.id}
                                className="p-1.5 text-amber-500 hover:text-amber-700 hover:bg-amber-50 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-wait"
                                title="Reset password & resync to all assigned exams"
                              >
                                <RefreshCw size={15} className={resyncingId === s.id ? 'animate-spin' : ''} />
                              </button>
                            )}
                            <button
                              onClick={() => { setEditForm({ name: s.name || '', password: '', is_active: s.is_active }); setEditError(''); setEditingStudent(s); }}
                              className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                              title="Edit student"
                            >
                              <Edit3 size={15} />
                            </button>
                            <button
                              onClick={() => handleDeleteOne(s)}
                              className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                              title="Remove from directory"
                            >
                              <Trash2 size={15} />
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* ── TEST CREDENTIALS TAB — rendered by separate component ── */}
        {activeTab === 'credentials' && (
          <TestCredentialsTab
            masterStudents={masterStudents}
            exams={exams}
            onRefresh={fetchData}
          />
        )}

        {/* Footer */}
        {!loading && activeTab === 'directory' && filteredStudents.length > 0 && (
          <div className="px-6 py-3 border-t border-slate-100 bg-slate-50/50">
            <p className="text-xs font-bold text-slate-400">
              Showing {filteredStudents.length} student{filteredStudents.length !== 1 ? 's' : ''}
              {searchQuery && ` matching "${searchQuery}"`}
            </p>
          </div>
        )}
      </div>

      {/* ── ADD STUDENT MODAL ── */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center">
              <h2 className="text-base font-black text-slate-900">Add Student to Directory</h2>
              <button onClick={() => setShowAddModal(false)} className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition-colors"><X size={18} /></button>
            </div>
            <form onSubmit={handleAddSubmit}>
              <div className="p-6 space-y-4">
                {addError && (
                  <div className="bg-red-50 text-red-600 p-3 rounded-xl text-sm font-bold flex items-center gap-2">
                    <AlertCircle size={14} /> {addError}
                  </div>
                )}
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5">Student ID <span className="text-red-400">*</span></label>
                  <input
                    required type="text"
                    value={addForm.id}
                    onChange={e => setAddForm(p => ({ ...p, id: e.target.value }))}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-bold focus:outline-none focus:border-blue-500"
                    placeholder="e.g. 23-AIML-101"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5">Display Name <span className="text-slate-300">(optional)</span></label>
                  <input
                    type="text"
                    value={addForm.name}
                    onChange={e => setAddForm(p => ({ ...p, name: e.target.value }))}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-bold focus:outline-none focus:border-blue-500"
                    placeholder="Full name"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5">Password <span className="text-red-400">*</span></label>
                  <input
                    required type="text"
                    value={addForm.password}
                    onChange={e => setAddForm(p => ({ ...p, password: e.target.value }))}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-bold focus:outline-none focus:border-blue-500"
                    placeholder="Master password"
                  />
                  <p className="text-[10px] text-slate-400 mt-1">Used as login credential when assigned to exams.</p>
                </div>
              </div>
              <div className="px-6 py-4 border-t border-slate-100 bg-slate-50/50 flex justify-end gap-3">
                <button type="button" onClick={() => setShowAddModal(false)} className="px-4 py-2 text-slate-600 font-bold hover:bg-slate-200 rounded-xl text-sm">Cancel</button>
                <button type="submit" disabled={isSubmitting} className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-sm shadow-sm disabled:opacity-50">
                  {isSubmitting ? 'Adding...' : 'Add Student'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── EDIT STUDENT MODAL ── */}
      {editingStudent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center">
              <h2 className="text-base font-black text-slate-900">Edit Student</h2>
              <button onClick={() => setEditingStudent(null)} className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition-colors"><X size={18} /></button>
            </div>
            <form onSubmit={handleEditSubmit}>
              <div className="p-6 space-y-4">
                {editError && (
                  <div className="bg-red-50 text-red-600 p-3 rounded-xl text-sm font-bold flex items-center gap-2">
                    <AlertCircle size={14} /> {editError}
                  </div>
                )}
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                  <p className="text-xs text-slate-400 font-bold uppercase mb-0.5">Editing</p>
                  <p className="text-lg font-black text-slate-900">{editingStudent.id}</p>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5">Display Name</label>
                  <input
                    type="text"
                    value={editForm.name}
                    onChange={e => setEditForm(p => ({ ...p, name: e.target.value }))}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-bold focus:outline-none focus:border-blue-500"
                    placeholder="Full name (optional)"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5 flex items-center gap-1.5">
                    <Key size={12} /> Reset Master Password
                  </label>
                  <input
                    type="text"
                    value={editForm.password}
                    onChange={e => setEditForm(p => ({ ...p, password: e.target.value }))}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-bold focus:outline-none focus:border-blue-500"
                    placeholder="Leave blank to keep current"
                  />
                </div>
                <label className="flex items-center gap-3 p-3 border border-slate-200 rounded-xl cursor-pointer hover:bg-slate-50 transition-colors">
                  <input
                    type="checkbox"
                    checked={editForm.is_active}
                    onChange={e => setEditForm(p => ({ ...p, is_active: e.target.checked }))}
                    className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                  />
                  <span className="text-sm font-bold text-slate-700">Account is Active</span>
                </label>
              </div>
              <div className="px-6 py-4 border-t border-slate-100 bg-slate-50/50 flex justify-end gap-3">
                <button type="button" onClick={() => setEditingStudent(null)} className="px-4 py-2 text-slate-600 font-bold hover:bg-slate-200 rounded-xl text-sm">Cancel</button>
                <button type="submit" disabled={isSubmitting} className="px-6 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-sm shadow-sm disabled:opacity-50">
                  {isSubmitting ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── CREDENTIAL MODAL ── */}
      {credModal && (
        <CredentialModal
          enrollment={credModal.enrollment}
          examTitle={credModal.examTitle}
          onClose={() => setCredModal(null)}
        />
      )}

    </div>
  );
}

// ── TEST CREDENTIALS TAB COMPONENT ────────────────────────────────────────────

function TestCredentialsTab({ masterStudents, exams, onRefresh }) {
  const [activeExams, setActiveExams]       = useState([]);
  const [loadingExams, setLoadingExams]     = useState(true);

  // Assignment panel state
  const [selectedExam, setSelectedExam]     = useState(null); // exam object
  const [assignSearch, setAssignSearch]     = useState('');
  const [checkedIds, setCheckedIds]         = useState(new Set());
  const [isAssigning, setIsAssigning]       = useState(false);
  const [assignResult, setAssignResult]     = useState(null); // {created, updated, skipped}

  // ── fetch active exams on mount ───────────────────────────────────────────

  const fetchActiveExams = useCallback(async () => {
    setLoadingExams(true);
    try {
      const res = await adminApi.get('/admin/exams/active');
      if (res.success) setActiveExams(res.data);
    } catch (err) { console.warn('Active exams fetch failed:', err.message); }
    finally { setLoadingExams(false); }
  }, []);

  useEffect(() => { fetchActiveExams(); }, [fetchActiveExams]);

  // ── pre-check already-enrolled students when exam selected ───────────────

  useEffect(() => {
    if (!selectedExam) { setCheckedIds(new Set()); setAssignSearch(''); setAssignResult(null); return; }
    // Find students already enrolled in this exam via their enrollments array
    const alreadyEnrolled = new Set(
      masterStudents
        .filter(s => s.enrollments.some(e => e.exam_id === selectedExam.id))
        .map(s => s.id)
    );
    setCheckedIds(alreadyEnrolled);
    setAssignSearch('');
    setAssignResult(null);
  }, [selectedExam, masterStudents]);

  // ── filtered master list for assignment panel ─────────────────────────────

  const filteredMaster = useMemo(() => {
    if (!assignSearch) return masterStudents;
    const lower = assignSearch.toLowerCase();
    return masterStudents.filter(s =>
      s.id.toLowerCase().includes(lower) ||
      (s.name || '').toLowerCase().includes(lower)
    );
  }, [masterStudents, assignSearch]);

  // ── select helpers ────────────────────────────────────────────────────────

  const toggleCheck = (id) => {
    setCheckedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    const visibleIds = filteredMaster.map(s => s.id);
    const allChecked = visibleIds.every(id => checkedIds.has(id));
    setCheckedIds(prev => {
      const next = new Set(prev);
      if (allChecked) visibleIds.forEach(id => next.delete(id));
      else            visibleIds.forEach(id => next.add(id));
      return next;
    });
  };

  // ── save assignment ───────────────────────────────────────────────────────

  const handleAssign = async () => {
    if (!selectedExam || checkedIds.size === 0) return;
    setIsAssigning(true);
    setAssignResult(null);
    try {
      const res = await adminApi.post(`/admin/exams/${selectedExam.id}/assign`, {
        student_ids: Array.from(checkedIds),
      });
      if (res.success) {
        setAssignResult(res);
        onRefresh(); // refresh master directory enrollments
      }
    } catch (err) { alert(err.message); }
    finally { setIsAssigning(false); }
  };

  // ── status badge helpers ──────────────────────────────────────────────────

  const statusBadge = (status) => status === 'live'
    ? <span className="flex items-center gap-1 text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded-md uppercase"><Zap size={9}/> Live</span>
    : <span className="flex items-center gap-1 text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-md uppercase"><Clock size={9}/> Upcoming</span>;

  const fmtDate = (ms) => new Date(ms).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

  // ── RENDER: assignment panel ──────────────────────────────────────────────

  if (selectedExam) {
    const visibleIds = filteredMaster.map(s => s.id);
    const allVisible = visibleIds.length > 0 && visibleIds.every(id => checkedIds.has(id));

    return (
      <div className="flex flex-col min-h-[500px]">

        {/* Panel header */}
        <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-100 bg-slate-50/60">
          <button
            onClick={() => setSelectedExam(null)}
            className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-200 rounded-lg transition-colors"
            title="Back to exam list"
          >
            <ArrowLeft size={16} />
          </button>
          <div className="flex-1">
            <p className="text-xs font-bold text-slate-400 uppercase">Assigning students to</p>
            <p className="font-black text-slate-900">{selectedExam.title}</p>
          </div>
          {statusBadge(selectedExam.status)}
        </div>

        {/* Search + select-all */}
        <div className="flex items-center gap-3 px-6 py-3 border-b border-slate-100">
          <input
            type="checkbox"
            checked={allVisible}
            onChange={toggleAll}
            className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
            title="Select / deselect all visible"
          />
          <div className="relative flex-1 max-w-xs">
            <Search size={13} className="absolute left-3 top-2.5 text-slate-400" />
            <input
              type="text"
              placeholder="Search students..."
              value={assignSearch}
              onChange={e => setAssignSearch(e.target.value)}
              className="w-full pl-8 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-blue-500"
            />
          </div>
          <p className="text-xs font-bold text-slate-400 ml-auto">
            {checkedIds.size} selected · {masterStudents.length} total
          </p>
        </div>

        {/* Student list */}
        <div className="flex-1 overflow-y-auto max-h-[340px] divide-y divide-slate-100">
          {filteredMaster.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-slate-300 font-bold text-sm">
              No students match.
            </div>
          ) : filteredMaster.map(s => {
            const enrolled = s.enrollments.some(e => e.exam_id === selectedExam.id);
            const checked  = checkedIds.has(s.id);
            return (
              <label
                key={s.id}
                className="flex items-center gap-4 px-6 py-3 hover:bg-blue-50/40 cursor-pointer transition-colors"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleCheck(s.id)}
                  className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer shrink-0"
                />
                <div className={`w-7 h-7 rounded-full flex items-center justify-center font-black text-xs shrink-0 ${avatarColor(s.id)}`}>
                  {getDept(s.id)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-slate-900 text-sm truncate">{s.id}</p>
                  {s.name && <p className="text-xs text-slate-400 truncate">{s.name}</p>}
                </div>
                {enrolled && (
                  <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-md uppercase shrink-0">
                    <CheckCircle size={9} /> Enrolled
                  </span>
                )}
              </label>
            );
          })}
        </div>

        {/* Result banner */}
        {assignResult && (
          <div className="mx-6 mt-3 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 text-sm font-bold text-emerald-700 flex flex-col gap-1">
            <span className="flex items-center gap-2">
              <CheckCircle size={15} />
              Done — {assignResult.created} new · {assignResult.updated} updated
              {assignResult.skipped?.length > 0 && ` · ${assignResult.skipped.length} skipped`}
            </span>
            {assignResult.needs_reset?.length > 0 && (
              <span className="text-amber-700 font-bold">
                {assignResult.needs_reset.length} student(s) skipped — password never set (see "Needs Reset" in Master Directory).
              </span>
            )}
          </div>
        )}

        {/* Save button */}
        <div className="px-6 py-4 border-t border-slate-100 bg-slate-50/60 flex justify-between items-center">
          <p className="text-xs text-slate-400 font-bold">
            Students use their master password to log in.
          </p>
          <button
            onClick={handleAssign}
            disabled={isAssigning || checkedIds.size === 0}
            className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-sm shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <UserCheck size={15} />
            {isAssigning ? 'Saving...' : `Save Assignments (${checkedIds.size})`}
          </button>
        </div>
      </div>
    );
  }

  // ── RENDER: exam grid ─────────────────────────────────────────────────────

  return (
    <div className="p-6 min-h-[400px]">
      {loadingExams ? (
        <div className="flex items-center justify-center h-[300px] text-slate-400 font-bold">
          <RefreshCw size={20} className="animate-spin mr-2" /> Loading exams...
        </div>
      ) : activeExams.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-[300px] text-slate-300">
          <Key size={40} className="mb-3" />
          <p className="font-bold text-slate-400">No upcoming or live exams.</p>
          <p className="text-sm text-slate-300 mt-1">Schedule an exam first, then assign students here.</p>
        </div>
      ) : (
        <>
          <p className="text-xs font-bold text-slate-400 uppercase mb-4">
            Select an exam to assign students
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {activeExams.map(exam => {
              const enrolledCount = masterStudents.filter(s =>
                s.enrollments.some(e => e.exam_id === exam.id)
              ).length;

              return (
                <button
                  key={exam.id}
                  onClick={() => setSelectedExam(exam)}
                  className="text-left bg-white border border-slate-200 hover:border-blue-400 hover:shadow-md rounded-2xl p-5 transition-all group"
                >
                  <div className="flex items-start justify-between mb-3">
                    {statusBadge(exam.status)}
                    <ChevronRight size={16} className="text-slate-300 group-hover:text-blue-500 transition-colors mt-0.5" />
                  </div>
                  <p className="font-black text-slate-900 text-base mb-1 group-hover:text-blue-700 transition-colors">
                    {exam.title}
                  </p>
                  <p className="text-xs text-slate-400 font-bold mb-3">
                    {exam.duration_minutes} min · {fmtDate(exam.starts_at_ms)}
                  </p>
                  <div className="flex items-center gap-1.5 text-xs font-bold text-slate-500">
                    <Users size={12} />
                    {enrolledCount} student{enrolledCount !== 1 ? 's' : ''} assigned
                  </div>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}