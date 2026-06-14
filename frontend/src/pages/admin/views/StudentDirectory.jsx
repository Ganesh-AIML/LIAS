import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { 
  Users, Search, Plus, Edit3, Key, Trash2, 
  CheckCircle, Shield, Copy, RefreshCw, 
  Filter, BookOpen, UploadCloud, X, AlertCircle
} from 'lucide-react';
import { adminApi } from '../../../hooks/useAdminApi'; 

export default function StudentDirectory() {
  const [activeTab, setActiveTab] = useState('directory'); 
  const [students, setStudents] = useState([]);
  const [exams, setExams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  
  const [searchQuery, setSearchQuery] = useState('');
  const [filterExam, setFilterExam] = useState('');

  const [showAddModal, setShowAddModal] = useState(false);
  const [editingStudent, setEditingStudent] = useState(null);
  
  const [addForm, setAddForm] = useState({ student_id: '', exam_id: '', password: '' });
  const [editForm, setEditForm] = useState({ password: '', is_active: true });
  const [formError, setFormError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [isBulkMode, setIsBulkMode] = useState(false);
  const [selectedTokens, setSelectedTokens] = useState([]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      try {
        const eRes = await adminApi.get('/admin/exams');
        if (eRes.success) setExams(eRes.data);
      } catch (err) { console.warn('Exams fetch failed:', err.message); }
      try {
        const sRes = await adminApi.get(`/admin/students${filterExam ? `?exam_id=${filterExam}` : ''}`);
        if (sRes.success) setStudents(sRes.data);
      } catch (err) { console.warn('Students fetch failed:', err.message); }
    } finally {
      setLoading(false);
    }
  }, [filterExam]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const filteredStudents = useMemo(() => {
    if (!searchQuery) return students;
    const lower = searchQuery.toLowerCase();
    return students.filter(s => s.student_id.toLowerCase().includes(lower) || s.token.toLowerCase().includes(lower));
  }, [students, searchQuery]);

  const displayData = useMemo(() => {
    if (activeTab === 'credentials') return filteredStudents;
    const map = {};
    filteredStudents.forEach(s => {
      if (!map[s.student_id]) {
        map[s.student_id] = { ...s, exams: [s.exam_id], tokens: [s.token] };
      } else {
        if (!map[s.student_id].exams.includes(s.exam_id)) map[s.student_id].exams.push(s.exam_id);
        map[s.student_id].tokens.push(s.token);
        map[s.student_id].is_active = map[s.student_id].is_active || s.is_active;
        map[s.student_id].submitted = map[s.student_id].submitted || s.submitted;
      }
    });
    return Object.values(map);
  }, [filteredStudents, activeTab]);

  const toggleSelectAll = () => {
    const allTokensInView = activeTab === 'directory' 
      ? displayData.flatMap(s => s.tokens) 
      : displayData.map(s => s.token);
    const allSelected = allTokensInView.every(t => selectedTokens.includes(t));
    if (allSelected && allTokensInView.length > 0) setSelectedTokens([]);
    else setSelectedTokens(allTokensInView);
  };

  const toggleStudentSelection = (tokensArray) => {
    const allSelected = tokensArray.every(t => selectedTokens.includes(t));
    if (allSelected) setSelectedTokens(prev => prev.filter(t => !tokensArray.includes(t)));
    else setSelectedTokens(prev => Array.from(new Set([...prev, ...tokensArray])));
  };

  const handleBulkDelete = async () => {
    if (selectedTokens.length === 0) return;
    if (!window.confirm(`Permanently delete ${selectedTokens.length} student records?`)) return;
    setIsBulkDeleting(true);
    try {
      const res = await adminApi.post('/admin/students/bulk-delete', { tokens: selectedTokens });
      if (res.success) { setIsBulkMode(false); setSelectedTokens([]); fetchData(); }
    } catch (err) { alert(err.message); } 
    finally { setIsBulkDeleting(false); }
  };

  const handleCopy = (text) => { navigator.clipboard.writeText(text); };

  const handleAddSubmit = async (e) => {
    e.preventDefault();
    setFormError('');
    if (!addForm.student_id || !addForm.exam_id || !addForm.password) { setFormError('All fields are required.'); return; }
    setIsSubmitting(true);
    try {
      const res = await adminApi.post('/admin/students', { students: [addForm] });
      if (res.success) { setShowAddModal(false); setAddForm({ student_id: '', exam_id: '', password: '' }); fetchData(); }
    } catch (err) { setFormError(err.message); } finally { setIsSubmitting(false); }
  };

  const handleEditSubmit = async (e) => {
    e.preventDefault();
    setFormError('');
    setIsSubmitting(true);
    try {
      const payload = { is_active: editForm.is_active };
      if (editForm.password) payload.password = editForm.password;
      const res = await adminApi.put(`/admin/students/${editingStudent.token}`, payload);
      if (res.success) { setEditingStudent(null); fetchData(); }
    } catch (err) { setFormError(err.message); } finally { setIsSubmitting(false); }
  };

  const handleDeleteGroup = async (tokensArray) => {
    if (!window.confirm("Permanently delete this student from all assigned exams?")) return;
    try {
      const res = await adminApi.post('/admin/students/bulk-delete', { tokens: tokensArray });
      if (res.success) fetchData();
    } catch (err) { alert(err.message); }
  };

  const getDept = (id) => {
    if (id.includes('-')) return id.split('-')[1].substring(0, 4).toUpperCase();
    return 'GEN';
  };
  const getExamTitle = (id) => exams.find(e => e.id === id)?.title || id;

  // Avatar color by dept string
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

  return (
    <div className="space-y-6">

      {/* HEADER */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm flex flex-col md:flex-row gap-4 justify-between md:items-center">
        <div>
          <h1 className="text-xl font-black text-slate-900 flex items-center gap-2">
            <Users size={20} className="text-blue-600" /> Student Directory
          </h1>
          <p className="text-sm text-slate-400 mt-0.5">
            {students.length} enrolled · {students.filter(s => s.is_active).length} active
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <Filter size={14} className="absolute left-3 top-2.5 text-slate-400" />
            <select
              value={filterExam}
              onChange={e => setFilterExam(e.target.value)}
              className="pl-9 pr-8 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-600 focus:outline-none focus:border-blue-500 appearance-none"
            >
              <option value="">All Exams</option>
              {exams.map(e => <option key={e.id} value={e.id}>{e.title}</option>)}
            </select>
          </div>
          <button
            onClick={() => { setAddForm(p => ({ ...p, exam_id: filterExam || exams[0]?.id || '' })); setShowAddModal(true); }}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-xl text-sm font-bold transition-all shadow-sm"
          >
            <Plus size={15} /> Enroll Student
          </button>
        </div>
      </div>

      {/* TABLE CARD */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden flex flex-col">

        {/* Tabs + controls */}
        <div className="border-b border-slate-200 bg-slate-50/60 flex flex-col sm:flex-row justify-between sm:items-center p-2 pr-4 gap-3">
          <div className="flex gap-1">
            <button
              onClick={() => { setActiveTab('directory'); setIsBulkMode(false); setSelectedTokens([]); }}
              className={`px-4 py-2 text-sm font-bold rounded-xl transition-all flex items-center gap-2 ${activeTab === 'directory' ? 'bg-white text-blue-700 shadow-sm border border-slate-200' : 'text-slate-500 hover:text-slate-700 hover:bg-white/60'}`}
            >
              <Shield size={14}/> Master Directory
            </button>
            <button
              onClick={() => { setActiveTab('credentials'); setIsBulkMode(false); setSelectedTokens([]); }}
              className={`px-4 py-2 text-sm font-bold rounded-xl transition-all flex items-center gap-2 ${activeTab === 'credentials' ? 'bg-white text-blue-700 shadow-sm border border-slate-200' : 'text-slate-500 hover:text-slate-700 hover:bg-white/60'}`}
            >
              <Key size={14}/> Test Credentials
            </button>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            {activeTab === 'directory' && (
              <button
                onClick={() => {
                  if (isBulkMode && selectedTokens.length > 0) handleBulkDelete();
                  else { setIsBulkMode(!isBulkMode); setSelectedTokens([]); }
                }}
                disabled={isBulkDeleting}
                className={`flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all ${
                  isBulkMode
                    ? (selectedTokens.length > 0 ? 'bg-red-600 hover:bg-red-700 text-white shadow-sm' : 'bg-slate-200 hover:bg-slate-300 text-slate-700')
                    : 'bg-slate-100 hover:bg-slate-200 text-slate-600'
                } ${isBulkDeleting ? 'opacity-50 cursor-wait' : ''}`}
              >
                <Trash2 size={14}/>
                {isBulkDeleting ? 'Deleting...' : isBulkMode ? (selectedTokens.length > 0 ? `Delete (${selectedTokens.length})` : 'Cancel') : 'Bulk Delete'}
              </button>
            )}
            <div className="relative w-full sm:w-64">
              <Search size={14} className="absolute left-3 top-2.5 text-slate-400" />
              <input
                type="text"
                placeholder="Search ID or token..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/20"
              />
            </div>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto min-h-[400px]">
          {loading ? (
            <div className="flex items-center justify-center h-[300px] text-slate-400 font-bold">
              <RefreshCw size={20} className="animate-spin mr-2" /> Loading records...
            </div>
          ) : displayData.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-[300px] text-slate-300">
              <Users size={40} className="mb-3" />
              <p className="font-bold text-slate-400">
                {searchQuery ? 'No students match your search.' : 'No students enrolled yet.'}
              </p>
              {searchQuery && <p className="text-sm text-slate-300 mt-1">Try a different ID or token.</p>}
            </div>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="bg-white border-b border-slate-100 text-xs uppercase font-bold text-slate-400 tracking-wider">
                <tr>
                  {isBulkMode && activeTab === 'directory' && (
                    <th className="px-6 py-4 w-12 text-center">
                      <input
                        type="checkbox"
                        checked={selectedTokens.length > 0 && selectedTokens.length === (activeTab === 'directory' ? displayData.flatMap(s => s.tokens).length : displayData.length)}
                        onChange={toggleSelectAll}
                        className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                      />
                    </th>
                  )}
                  <th className="px-6 py-4">Student ID</th>
                  <th className="px-6 py-4">Assigned Exam(s)</th>
                  {activeTab === 'directory' && <th className="px-6 py-4 text-center">Status</th>}
                  {activeTab === 'directory' && <th className="px-6 py-4 text-center">Submitted</th>}
                  {activeTab === 'credentials' && <th className="px-6 py-4">Secure Token</th>}
                  <th className="px-6 py-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {displayData.map(s => {
                  const rowTokens = activeTab === 'directory' ? s.tokens : [s.token];
                  const isRowSelected = rowTokens.every(t => selectedTokens.includes(t));
                  return (
                    <tr
                      key={activeTab === 'directory' ? s.student_id : s.token}
                      className="hover:bg-blue-50/30 transition-colors group"
                    >
                      {isBulkMode && activeTab === 'directory' && (
                        <td className="px-6 py-4 text-center">
                          <input
                            type="checkbox"
                            checked={isRowSelected}
                            onChange={() => toggleStudentSelection(rowTokens)}
                            className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                          />
                        </td>
                      )}

                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center font-black text-xs shrink-0 ${avatarColor(s.student_id)}`}>
                            {getDept(s.student_id)}
                          </div>
                          <span className="font-bold text-slate-900 group-hover:text-blue-700 transition-colors">{s.student_id}</span>
                        </div>
                      </td>

                      <td className="px-6 py-4">
                        <div className="flex flex-wrap gap-1.5">
                          {(activeTab === 'directory' ? s.exams : [s.exam_id]).map(eid => (
                            <span key={eid} className="flex items-center gap-1 text-xs font-bold text-indigo-700 bg-indigo-50 border border-indigo-100 px-2.5 py-1 rounded-md w-max">
                              <BookOpen size={11} /> {getExamTitle(eid)}
                            </span>
                          ))}
                        </div>
                      </td>

                      {activeTab === 'directory' && (
                        <>
                          <td className="px-6 py-4 text-center">
                            {s.is_active
                              ? <span className="text-[10px] bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-md font-bold uppercase border border-emerald-200">Active</span>
                              : <span className="text-[10px] bg-red-50 text-red-700 px-2 py-0.5 rounded-md font-bold uppercase border border-red-200">Suspended</span>}
                          </td>
                          <td className="px-6 py-4 text-center">
                            {s.submitted
                              ? <CheckCircle size={15} className="text-emerald-500 mx-auto" />
                              : <span className="text-slate-300 font-bold">—</span>}
                          </td>
                        </>
                      )}

                      {activeTab === 'credentials' && (
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2">
                            <code className="bg-slate-100 text-slate-700 font-mono text-xs px-2 py-1 rounded-lg border border-slate-200">{s.token}</code>
                            <button
                              onClick={() => handleCopy(s.token)}
                              className="p-1.5 text-slate-300 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                              title="Copy Token"
                            >
                              <Copy size={13}/>
                            </button>
                          </div>
                        </td>
                      )}

                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          {!isBulkMode && (
                            <>
                              <button
                                onClick={() => { setEditForm({ password: '', is_active: s.is_active }); setEditingStudent(s); }}
                                className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                                title="Edit / Reset Password"
                              >
                                <Edit3 size={15} />
                              </button>
                              {activeTab === 'directory' && (
                                <button
                                  onClick={() => handleDeleteGroup(rowTokens)}
                                  className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                  title="Delete Student"
                                >
                                  <Trash2 size={15} />
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer count */}
        {!loading && displayData.length > 0 && (
          <div className="px-6 py-3 border-t border-slate-100 bg-slate-50/50">
            <p className="text-xs font-bold text-slate-400">
              Showing {displayData.length} {activeTab === 'directory' ? 'students' : 'credentials'}
              {searchQuery && ` matching "${searchQuery}"`}
            </p>
          </div>
        )}
      </div>

      {/* ── ADD MODAL ── */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center">
              <h2 className="text-base font-black text-slate-900">Enroll Students</h2>
              <button onClick={() => setShowAddModal(false)} className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition-colors"><X size={18}/></button>
            </div>
            <div className="p-6 space-y-4">
              {formError && (
                <div className="bg-red-50 text-red-600 p-3 rounded-xl text-sm font-bold flex items-center gap-2">
                  <AlertCircle size={14}/> {formError}
                </div>
              )}
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5">Assign to Exam</label>
                <select
                  required
                  value={addForm.exam_id}
                  onChange={e => setAddForm(p => ({ ...p, exam_id: e.target.value }))}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-bold focus:outline-none focus:border-blue-500 appearance-none"
                >
                  <option value="" disabled>Select Exam...</option>
                  {exams.map(e => <option key={e.id} value={e.id}>{e.title}</option>)}
                </select>
              </div>

              <div className="border-t border-b border-slate-100 py-4 space-y-2">
                <p className="text-xs font-bold text-slate-500 uppercase">Method 1: Bulk CSV Upload</p>
                <label className={`w-full flex items-center justify-center gap-2 text-sm font-bold transition-all rounded-xl px-4 py-2.5 ${
                  isSubmitting
                    ? 'bg-indigo-50 text-indigo-300 cursor-wait'
                    : 'bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 cursor-pointer'
                }`}>
                  <UploadCloud size={15} />
                  {isSubmitting ? 'Uploading & Enrolling...' : 'Upload CSV (ID, Password)'}
                  <input
                    type="file"
                    accept=".csv"
                    className="hidden"
                    disabled={isSubmitting}
                    onChange={(e) => {
                      const file = e.target.files[0];
                      if (!file || !addForm.exam_id) { setFormError("Please select an exam first."); return; }
                      const reader = new FileReader();
                      reader.onload = async (ev) => {
                        try {
                          const rows = ev.target.result.split('\n').map(r => r.trim()).filter(r => r);
                          const bulkPayload = rows.map(row => {
                            const [id, pw] = row.split(',');
                            return { student_id: id?.trim(), password: (pw||'').trim(), exam_id: addForm.exam_id };
                          }).filter(s => s.student_id && s.password);
                          setIsSubmitting(true);
                          const res = await adminApi.post('/admin/students', { students: bulkPayload });
                          if (res.success) { setShowAddModal(false); fetchData(); alert(`Successfully enrolled ${bulkPayload.length} students via CSV.`); }
                        } catch (err) { setFormError("Failed to parse CSV."); }
                        finally { setIsSubmitting(false); }
                      };
                      reader.readAsText(file);
                    }}
                  />
                </label>
                <p className="text-[10px] text-slate-400 text-center">Format: student_id,password (one per line)</p>
              </div>

              <form onSubmit={handleAddSubmit} className="space-y-3">
                <p className="text-xs font-bold text-slate-500 uppercase">Method 2: Manual Entry</p>
                <input
                  required type="text"
                  value={addForm.student_id}
                  onChange={e => setAddForm(p => ({ ...p, student_id: e.target.value }))}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-bold focus:outline-none focus:border-blue-500"
                  placeholder="Student ID (e.g. 23-AIML-101)"
                />
                <input
                  required type="text"
                  value={addForm.password}
                  onChange={e => setAddForm(p => ({ ...p, password: e.target.value }))}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-bold focus:outline-none focus:border-blue-500"
                  placeholder="Set Initial Password"
                />
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-sm shadow-sm transition-all disabled:opacity-50"
                >
                  {isSubmitting ? 'Enrolling...' : 'Enroll Single Student'}
                </button>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* ── EDIT MODAL ── */}
      {editingStudent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center">
              <h2 className="text-base font-black text-slate-900">Manage Student</h2>
              <button onClick={() => setEditingStudent(null)} className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition-colors"><X size={18}/></button>
            </div>
            <form onSubmit={handleEditSubmit}>
              <div className="p-6 space-y-5">
                {formError && (
                  <div className="bg-red-50 text-red-600 p-3 rounded-xl text-sm font-bold flex items-center gap-2">
                    <AlertCircle size={14}/> {formError}
                  </div>
                )}
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                  <p className="text-xs text-slate-400 font-bold uppercase mb-0.5">Editing Profile</p>
                  <p className="text-lg font-black text-slate-900">{editingStudent.student_id}</p>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5 flex items-center gap-1.5">
                    <Key size={12}/> Force Password Reset
                  </label>
                  <input
                    type="text"
                    value={editForm.password}
                    onChange={e => setEditForm(p => ({ ...p, password: e.target.value }))}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-bold focus:outline-none focus:border-blue-500"
                    placeholder="Leave blank to keep current password"
                  />
                </div>
                <label className="flex items-center gap-3 p-3 border border-slate-200 rounded-xl cursor-pointer hover:bg-slate-50 transition-colors">
                  <input
                    type="checkbox"
                    checked={editForm.is_active}
                    onChange={e => setEditForm(p => ({ ...p, is_active: e.target.checked }))}
                    className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                  />
                  <span className="text-sm font-bold text-slate-700">Account is Active (Allow Login)</span>
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

    </div>
  );
}