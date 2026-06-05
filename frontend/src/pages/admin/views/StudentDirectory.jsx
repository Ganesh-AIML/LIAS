import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { 
  Users, Search, Plus, Edit3, Key, Trash2, 
  CheckCircle, XCircle, Shield, Copy, RefreshCw, 
  Filter, BookOpen, Lock, UploadCloud, X 
} from 'lucide-react';
import { adminApi } from '../../../hooks/useAdminApi'; 

export default function StudentDirectory() {
  const [activeTab, setActiveTab] = useState('directory'); 
  const [students, setStudents] = useState([]);
  const [exams, setExams] = useState([]);
  const [loading, setLoading] = useState(true);
  
  const [searchQuery, setSearchQuery] = useState('');
  const [filterExam, setFilterExam] = useState('');

  const [showAddModal, setShowAddModal] = useState(false);
  const [editingStudent, setEditingStudent] = useState(null);
  
  const [addForm, setAddForm] = useState({ student_id: '', exam_id: '', password: '' });
  const [editForm, setEditForm] = useState({ password: '', is_active: true });
  const [formError, setFormError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // 🚀 FIX: Decoupled Fetching Architecture. 
  // If Students fail to load, Exams will still populate the dropdown perfectly.
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      // 1. Fetch Exams Independently
      try {
        const eRes = await adminApi.get('/admin/exams');
        if (eRes.success) setExams(eRes.data);
      } catch (err) {
        console.warn('Exams fetch failed:', err.message);
      }

      // 2. Fetch Students Independently
      try {
        const sRes = await adminApi.get(`/admin/students${filterExam ? `?exam_id=${filterExam}` : ''}`);
        if (sRes.success) setStudents(sRes.data);
      } catch (err) {
        console.warn('Students fetch failed:', err.message);
      }
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

  const handleCopy = (text) => { navigator.clipboard.writeText(text); };

  const handleAddSubmit = async (e) => {
    e.preventDefault();
    setFormError('');
    if (!addForm.student_id || !addForm.exam_id || !addForm.password) {
      setFormError('All fields are required.'); return;
    }
    setIsSubmitting(true);
    try {
      const res = await adminApi.post('/admin/students', { students: [addForm] });
      if (res.success) {
        setShowAddModal(false);
        setAddForm({ student_id: '', exam_id: '', password: '' });
        fetchData();
      }
    } catch (err) { setFormError(err.message); }
    finally { setIsSubmitting(false); }
  };

  const handleEditSubmit = async (e) => {
    e.preventDefault();
    setFormError('');
    setIsSubmitting(true);
    try {
      const payload = { is_active: editForm.is_active };
      if (editForm.password) payload.password = editForm.password;
      
      const res = await adminApi.put(`/admin/students/${editingStudent.token}`, payload);
      if (res.success) {
        setEditingStudent(null);
        fetchData();
      }
    } catch (err) { setFormError(err.message); }
    finally { setIsSubmitting(false); }
  };

  const handleDelete = async (token) => {
    if (!window.confirm("Are you sure you want to permanently delete this student record?")) return;
    try {
      const res = await adminApi.delete(`/admin/students/${token}`);
      if (res.success) fetchData();
    } catch (err) { alert(err.message); }
  };

  const getDept = (id) => {
    if (id.includes('-')) return id.split('-')[1].substring(0, 4).toUpperCase();
    return 'GEN';
  };

  const getExamTitle = (id) => exams.find(e => e.id === id)?.title || id;

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      
      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm flex flex-col md:flex-row gap-4 justify-between md:items-center">
        <div>
          <h1 className="text-xl font-black text-slate-900 flex items-center gap-2">
            <Users size={22} className="text-cyan-600" /> Student Directory
          </h1>
          <p className="text-sm font-semibold text-slate-500 mt-1">Manage enrollments, active status, and credentials.</p>
        </div>
        
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <Filter size={16} className="absolute left-3 top-2.5 text-slate-400" />
            <select 
              value={filterExam} 
              onChange={e => setFilterExam(e.target.value)}
              className="pl-9 pr-8 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-bold text-slate-600 focus:outline-none focus:border-cyan-500 appearance-none"
            >
              <option value="">All Exams</option>
              {exams.map(e => <option key={e.id} value={e.id}>{e.title}</option>)}
            </select>
          </div>
          <button onClick={() => { setAddForm(p => ({ ...p, exam_id: filterExam || exams[0]?.id || '' })); setShowAddModal(true); }} className="flex items-center gap-2 bg-cyan-600 hover:bg-cyan-700 text-white px-4 py-2 rounded-lg text-sm font-bold transition-all shadow-sm">
            <Plus size={16} /> Enroll Student
          </button>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden flex flex-col">
        <div className="border-b border-slate-200 bg-slate-50 flex flex-col sm:flex-row justify-between sm:items-center p-2 pr-4 gap-4">
          <div className="flex gap-1">
            <button onClick={() => setActiveTab('directory')} className={`px-5 py-2.5 text-sm font-bold rounded-lg transition-all flex items-center gap-2 ${activeTab === 'directory' ? 'bg-white text-cyan-700 shadow-sm border border-slate-200' : 'text-slate-500 hover:text-slate-700'}`}>
              <Shield size={16}/> Master Directory
            </button>
            <button onClick={() => setActiveTab('credentials')} className={`px-5 py-2.5 text-sm font-bold rounded-lg transition-all flex items-center gap-2 ${activeTab === 'credentials' ? 'bg-white text-cyan-700 shadow-sm border border-slate-200' : 'text-slate-500 hover:text-slate-700'}`}>
              <Key size={16}/> Test Credentials
            </button>
          </div>
          <div className="relative w-full sm:w-64">
            <Search size={16} className="absolute left-3 top-2.5 text-slate-400" />
            <input 
              type="text" 
              placeholder="Search ID or Token..." 
              value={searchQuery} 
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-cyan-500" 
            />
          </div>
        </div>

        <div className="overflow-x-auto min-h-[400px]">
          {loading ? (
            <div className="flex items-center justify-center h-[300px] text-slate-400 font-bold animate-pulse">
              <RefreshCw size={24} className="animate-spin mr-2" /> Loading records...
            </div>
          ) : filteredStudents.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-[300px] text-slate-400">
              <Users size={48} className="mb-3 opacity-50" />
              <p className="font-bold">No students found.</p>
            </div>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="bg-white border-b border-slate-100 text-xs uppercase font-bold text-slate-400">
                <tr>
                  <th className="px-6 py-4">Student ID</th>
                  <th className="px-6 py-4">Assigned Exam</th>
                  {activeTab === 'directory' && <th className="px-6 py-4 text-center">Status</th>}
                  {activeTab === 'directory' && <th className="px-6 py-4 text-center">Submitted</th>}
                  {activeTab === 'credentials' && <th className="px-6 py-4">Secure Token (Login ID)</th>}
                  <th className="px-6 py-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredStudents.map(s => (
                  <tr key={s.token} className="hover:bg-slate-50 transition-colors group">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-cyan-100 text-cyan-700 flex items-center justify-center font-black text-xs">
                          {getDept(s.student_id)}
                        </div>
                        <span className="font-bold text-slate-900 group-hover:text-cyan-700 transition-colors">{s.student_id}</span>
                      </div>
                    </td>
                    
                    <td className="px-6 py-4">
                      <span className="flex items-center gap-1.5 text-xs font-bold text-indigo-700 bg-indigo-50 border border-indigo-100 px-2.5 py-1 rounded-md w-max">
                        <BookOpen size={12} /> {getExamTitle(s.exam_id)}
                      </span>
                    </td>

                    {activeTab === 'directory' && (
                      <>
                        <td className="px-6 py-4 text-center">
                          {s.is_active 
                            ? <span className="text-[10px] bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded font-bold uppercase border border-emerald-200">Active</span>
                            : <span className="text-[10px] bg-red-50 text-red-700 px-2 py-0.5 rounded font-bold uppercase border border-red-200">Suspended</span>}
                        </td>
                        <td className="px-6 py-4 text-center">
                          {s.submitted ? <CheckCircle size={16} className="text-emerald-500 mx-auto" /> : <span className="text-slate-300 font-bold">—</span>}
                        </td>
                      </>
                    )}

                    {activeTab === 'credentials' && (
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <code className="bg-slate-100 text-slate-800 font-mono text-xs px-2 py-1 rounded border border-slate-200">{s.token}</code>
                          <button onClick={() => handleCopy(s.token)} className="text-slate-400 hover:text-cyan-600 transition-colors" title="Copy Token"><Copy size={14}/></button>
                        </div>
                      </td>
                    )}

                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button onClick={() => { setEditForm({ password: '', is_active: s.is_active }); setEditingStudent(s); }} className="p-1.5 text-slate-400 hover:text-cyan-600 hover:bg-cyan-50 rounded transition-colors" title="Edit / Reset Password">
                          <Edit3 size={16} />
                        </button>
                        {activeTab === 'directory' && (
                          <button onClick={() => handleDelete(s.token)} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors" title="Delete Student">
                            <Trash2 size={16} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* ── MODALS ── */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in duration-200">
            <div className="px-6 py-4 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
              <h2 className="text-lg font-black text-slate-900">Enroll Students</h2>
              <button onClick={() => setShowAddModal(false)} className="text-slate-400 hover:text-slate-700"><X size={20}/></button>
            </div>
            
            <div className="p-6 space-y-4">
              {formError && <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm font-bold">{formError}</div>}
              
              <div>
                <label className="block text-xs font-bold text-slate-600 uppercase mb-1.5">Assign to Exam</label>
                <select required value={addForm.exam_id} onChange={e => setAddForm(p => ({ ...p, exam_id: e.target.value }))} className="w-full bg-slate-50 border border-slate-200 rounded-lg px-4 py-2.5 text-sm font-bold focus:outline-none focus:border-cyan-500 appearance-none">
                  <option value="" disabled>Select Exam...</option>
                  {exams.map(e => <option key={e.id} value={e.id}>{e.title}</option>)}
                </select>
              </div>

              <div className="border-t border-b border-slate-100 py-4 my-2">
                 <p className="text-xs font-bold text-slate-500 uppercase mb-2">Method 1: Bulk CSV Upload</p>
                 <label className="w-full flex items-center justify-center gap-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-lg px-4 py-2 text-sm font-bold transition-all cursor-pointer">
                    <UploadCloud size={16} /> Upload CSV (ID, Password)
                    <input type="file" accept=".csv" className="hidden" onChange={(e) => {
                       const file = e.target.files[0];
                       if (!file || !addForm.exam_id) {
                           setFormError("Please select an exam first.");
                           return;
                       }
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
                             if (res.success) {
                                setShowAddModal(false);
                                fetchData();
                                alert(`Successfully enrolled ${bulkPayload.length} students via CSV.`);
                             }
                          } catch (err) { setFormError("Failed to parse or upload CSV."); }
                          finally { setIsSubmitting(false); }
                       };
                       reader.readAsText(file);
                    }}/>
                 </label>
                 <p className="text-[10px] text-slate-400 text-center mt-1">Format expected: student_id,password</p>
              </div>

              <form onSubmit={handleAddSubmit}>
                <p className="text-xs font-bold text-slate-500 uppercase mb-2">Method 2: Manual Entry</p>
                <div className="space-y-3">
                  <input required type="text" value={addForm.student_id} onChange={e => setAddForm(p => ({ ...p, student_id: e.target.value }))} className="w-full bg-slate-50 border border-slate-200 rounded-lg px-4 py-2.5 text-sm font-bold focus:outline-none focus:border-cyan-500" placeholder="Student ID (e.g. 23-AIML-101)" />
                  <input required type="text" value={addForm.password} onChange={e => setAddForm(p => ({ ...p, password: e.target.value }))} className="w-full bg-slate-50 border border-slate-200 rounded-lg px-4 py-2.5 text-sm font-bold focus:outline-none focus:border-cyan-500" placeholder="Set Initial Password" />
                  <button type="submit" disabled={isSubmitting} className="w-full py-2.5 bg-cyan-600 hover:bg-cyan-700 text-white font-bold rounded-lg text-sm shadow-sm">{isSubmitting ? 'Enrolling...' : 'Enroll Single Student'}</button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {editingStudent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in duration-200">
            <div className="px-6 py-4 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
              <h2 className="text-lg font-black text-slate-900">Manage Student</h2>
              <button onClick={() => setEditingStudent(null)} className="text-slate-400 hover:text-slate-700"><X size={20}/></button>
            </div>
            <form onSubmit={handleEditSubmit}>
              <div className="p-6 space-y-5">
                {formError && <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm font-bold">{formError}</div>}
                
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                  <p className="text-xs text-slate-500 font-bold uppercase mb-1">Editing Profile</p>
                  <p className="text-lg font-black text-slate-900">{editingStudent.student_id}</p>
                </div>
                
                <div>
                  <label className="block text-xs font-bold text-slate-600 uppercase mb-1.5 flex items-center gap-1.5"><Key size={14}/> Force Password Reset</label>
                  <input type="text" value={editForm.password} onChange={e => setEditForm(p => ({ ...p, password: e.target.value }))} className="w-full bg-slate-50 border border-slate-200 rounded-lg px-4 py-2.5 text-sm font-bold focus:outline-none focus:border-cyan-500" placeholder="Leave blank to keep current password" />
                </div>

                <label className="flex items-center gap-3 p-3 border border-slate-200 rounded-lg cursor-pointer hover:bg-slate-50 transition-colors">
                  <input type="checkbox" checked={editForm.is_active} onChange={e => setEditForm(p => ({ ...p, is_active: e.target.checked }))} className="w-4 h-4 text-cyan-600 rounded focus:ring-cyan-500" />
                  <span className="text-sm font-bold text-slate-700">Account is Active (Allow Login)</span>
                </label>
              </div>
              <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex justify-end gap-3">
                <button type="button" onClick={() => setEditingStudent(null)} className="px-4 py-2 text-slate-600 font-bold hover:bg-slate-200 rounded-lg text-sm">Cancel</button>
                <button type="submit" disabled={isSubmitting} className="px-6 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg text-sm shadow-sm">{isSubmitting ? 'Saving...' : 'Save Changes'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}