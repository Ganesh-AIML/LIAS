import React, { useState } from 'react';
import { ArrowLeft, Save, Send, FileText, Code2, Settings, Plus, Trash2 } from 'lucide-react';
import CodingProblemBuilder from './CodingProblemBuilder';
import { adminApi } from '../../../hooks/useAdminApi'; // Make sure this path is correct based on your folder structure

const generateId = () => `mcq_${Math.random().toString(36).substr(2, 9)}`;

export default function ScheduleTest({ initialData, onBack }) {
  const [activeTab, setActiveTab] = useState('setup');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  // 1. Meta State
  const [testMeta, setTestMeta] = useState({
    title: initialData?.title || '',
    starts_at: initialData?.starts_at || '',
    duration_minutes: initialData?.duration_minutes || '120',
    start_password: initialData?.start_password || '',
    end_password: initialData?.end_password || '',
  });

  // 2. MCQ State
  const [questions, setQuestions] = useState(initialData?.questions || []);

  // 3. Coding State
  const [codingProblems, setCodingProblems] = useState(initialData?.codingProblems || []);

  // --- MCQ Helpers ---
  const addQuestion = () => {
    setQuestions([...questions, {
      id: generateId(),
      section: 'Aptitude',
      text: '',
      optA: '', optB: '', optC: '', optD: '',
      ans: 'A'
    }]);
  };

  const updateQuestion = (id, field, value) => {
    setQuestions(questions.map(q => q.id === id ? { ...q, [field]: value } : q));
  };

  const removeQuestion = (id) => setQuestions(questions.filter(q => q.id !== id));

  // --- Submit Handler ---
  const handlePublish = async (status) => {
    setError('');
    
    // Basic Validation
    if (!testMeta.title || !testMeta.starts_at || !testMeta.start_password) {
      setError("Title, Start Date, and Start Password are required.");
      setActiveTab('setup');
      return;
    }

    setIsSubmitting(true);
    try {
      const payload = {
        ...testMeta,
        duration_minutes: parseInt(testMeta.duration_minutes),
        starts_at: new Date(testMeta.starts_at).getTime(), // Convert to unix ms
        status: status, // "draft" or "upcoming"
        questions: questions,
        coding_problems: codingProblems
      };

      // TODO: In Task 3.5 we will update the backend to handle this nested payload
      const res = await adminApi.post('/admin/exams', payload);
      
      if (res.success) {
        onBack(); // Return to dashboard on success
      }
    } catch (err) {
      setError(err.message || 'Failed to save exam.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      
      {/* HEADER & TABS */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="p-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg transition-colors"><ArrowLeft size={18} /></button>
          <div>
            <h1 className="text-xl font-black text-slate-900">{testMeta.title || 'Untitled Assessment'}</h1>
            <p className="text-sm font-semibold text-slate-500">Exam Builder Mode</p>
          </div>
        </div>
        
        <div className="flex bg-slate-100 p-1 rounded-lg self-stretch sm:self-auto">
          <button onClick={() => setActiveTab('setup')} className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-bold transition-all ${activeTab === 'setup' ? 'bg-white text-cyan-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}><Settings size={16}/> Setup</button>
          <button onClick={() => setActiveTab('mcq')} className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-bold transition-all ${activeTab === 'mcq' ? 'bg-white text-cyan-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}><FileText size={16}/> MCQs <span className="bg-slate-200 text-slate-600 px-1.5 rounded-full text-[10px]">{questions.length}</span></button>
          <button onClick={() => setActiveTab('coding')} className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-bold transition-all ${activeTab === 'coding' ? 'bg-white text-cyan-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}><Code2 size={16}/> Coding <span className="bg-slate-200 text-slate-600 px-1.5 rounded-full text-[10px]">{codingProblems.length}</span></button>
        </div>
      </div>

      {error && <div className="bg-rose-50 border border-rose-200 text-rose-600 px-4 py-3 rounded-xl text-sm font-bold">{error}</div>}

      {/* TAB CONTENT */}
      <div className="pb-24">
        {activeTab === 'setup' && (
          <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm max-w-2xl mx-auto space-y-5">
            <div>
              <label className="block text-xs font-bold text-slate-600 uppercase mb-1.5">Exam Title *</label>
              <input type="text" value={testMeta.title} onChange={e => setTestMeta({...testMeta, title: e.target.value})} className="w-full border border-slate-200 rounded-lg px-4 py-3 focus:border-cyan-500 outline-none bg-slate-50 font-semibold" placeholder="e.g. Campus Drive 2026" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-600 uppercase mb-1.5">Start Date & Time *</label>
                <input type="datetime-local" value={testMeta.starts_at} onChange={e => setTestMeta({...testMeta, starts_at: e.target.value})} className="w-full border border-slate-200 rounded-lg px-4 py-3 focus:border-cyan-500 outline-none bg-slate-50 font-semibold" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-600 uppercase mb-1.5">Duration (Minutes) *</label>
                <input type="number" min="1" value={testMeta.duration_minutes} onChange={e => setTestMeta({...testMeta, duration_minutes: e.target.value})} className="w-full border border-slate-200 rounded-lg px-4 py-3 focus:border-cyan-500 outline-none bg-slate-50 font-semibold" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-600 uppercase mb-1.5">Start Password *</label>
                <input type="text" value={testMeta.start_password} onChange={e => setTestMeta({...testMeta, start_password: e.target.value})} className="w-full border border-slate-200 rounded-lg px-4 py-3 focus:border-cyan-500 outline-none bg-slate-50 font-semibold text-cyan-700" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-600 uppercase mb-1.5">End Password</label>
                <input type="text" value={testMeta.end_password} onChange={e => setTestMeta({...testMeta, end_password: e.target.value})} className="w-full border border-slate-200 rounded-lg px-4 py-3 focus:border-cyan-500 outline-none bg-slate-50 font-semibold text-rose-600" placeholder="Optional" />
              </div>
            </div>
          </div>
        )}

        {activeTab === 'mcq' && (
          <div className="space-y-4">
            <div className="flex justify-between items-center bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
              <div>
                <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2"><FileText size={20} className="text-cyan-600" /> Multiple Choice Questions</h2>
              </div>
              <button onClick={addQuestion} className="flex items-center gap-1.5 bg-cyan-600 hover:bg-cyan-700 text-white px-4 py-2 rounded-lg text-sm font-bold transition-all shadow-sm"><Plus size={16} /> Add MCQ</button>
            </div>
            
            {questions.length === 0 ? (
               <div className="text-center py-16 bg-white border border-dashed border-slate-300 rounded-2xl">
                 <FileText size={40} className="mx-auto text-slate-300 mb-3" />
                 <h3 className="text-slate-500 font-bold">No MCQs Added</h3>
               </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {questions.map((q, idx) => (
                  <div key={q.id} className="bg-white border border-slate-200 p-5 rounded-2xl shadow-sm relative group">
                    <button onClick={() => removeQuestion(q.id)} className="absolute top-3 right-3 text-slate-300 hover:text-red-500 transition-colors"><Trash2 size={16}/></button>
                    <div className="flex items-center gap-3 mb-4">
                      <span className="bg-slate-100 text-slate-500 font-black px-3 py-1 rounded-md text-xs">Q{idx + 1}</span>
                      <input type="text" value={q.section} onChange={e => updateQuestion(q.id, 'section', e.target.value)} className="bg-slate-50 border border-slate-200 rounded px-2 py-1 text-xs font-bold text-slate-600 outline-none" placeholder="Section Name" />
                    </div>
                    <textarea value={q.text} onChange={e => updateQuestion(q.id, 'text', e.target.value)} placeholder="Type question here..." rows="3" className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:border-cyan-500 outline-none resize-none mb-3 font-semibold" />
                    <div className="grid grid-cols-2 gap-2 mb-3">
                      {['A', 'B', 'C', 'D'].map(opt => (
                        <div key={opt} className="flex items-center gap-2">
                          <span className="text-xs font-bold text-slate-400">{opt}.</span>
                          <input type="text" value={q[`opt${opt}`]} onChange={e => updateQuestion(q.id, `opt${opt}`, e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded p-1.5 text-xs focus:border-cyan-500 outline-none" placeholder={`Option ${opt}`} />
                        </div>
                      ))}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-slate-600 uppercase">Correct Answer:</span>
                      <select value={q.ans} onChange={e => updateQuestion(q.id, 'ans', e.target.value)} className="bg-emerald-50 text-emerald-700 border border-emerald-200 font-bold text-xs rounded p-1 outline-none">
                        <option value="A">Option A</option>
                        <option value="B">Option B</option>
                        <option value="C">Option C</option>
                        <option value="D">Option D</option>
                      </select>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'coding' && (
          <CodingProblemBuilder problems={codingProblems} setProblems={setCodingProblems} />
        )}
      </div>

      {/* FIXED FOOTER CONTROLS */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 p-4 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)] z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex justify-end gap-3">
          <button onClick={() => handlePublish('draft')} disabled={isSubmitting} className="flex items-center gap-2 px-6 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-lg transition-colors">
            <Save size={18} /> Save as Draft
          </button>
          <button onClick={() => handlePublish('upcoming')} disabled={isSubmitting} className="flex items-center gap-2 px-8 py-2.5 bg-cyan-600 hover:bg-cyan-700 text-white font-bold rounded-lg shadow-md transition-all">
            <Send size={18} /> {isSubmitting ? 'Publishing...' : 'Publish Exam'}
          </button>
        </div>
      </div>
    </div>
  );
}