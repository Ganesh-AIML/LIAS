import React, { useState, useMemo, useEffect } from 'react';
import { 
  ArrowLeft, Edit3, MonitorPlay, Clock, Database, 
  CheckCircle, ChevronLeft, ChevronRight, Code2, AlertTriangle
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { adminApi } from '../../../hooks/useAdminApi'; // Make sure this path is correct

export default function UpcomingTestPreview({ test, onBack, onEdit }) {
  const [currentQIndex, setCurrentQIndex] = useState(0);
  const [selectedAnswers, setSelectedAnswers] = useState({});
  const [fullTestData, setFullTestData] = useState(null);
  const [loading, setLoading] = useState(true);

  // 🚀 NEW: Fetch the deep data containing the questions
  useEffect(() => {
    const fetchFullExam = async () => {
      try {
        const res = await adminApi.get(`/admin/exams/${test.id}`);
        if (res.success) setFullTestData(res.data);
      } catch (err) {
        console.error("Failed to load exam details");
      } finally {
        setLoading(false);
      }
    };
    if (test?.id) fetchFullExam();
  }, [test.id]);

  const activeQuestions = useMemo(() => {
    const questions = [];
    if (fullTestData?.questions) {
      fullTestData.questions.forEach(q => {
        questions.push({
          id: q.id, type: 'mcq', section: q.section, text: q.text,
          options: [{ id: 'A', text: q.optA }, { id: 'B', text: q.optB }, { id: 'C', text: q.optC }, { id: 'D', text: q.optD }],
          correct: q.ans
        });
      });
    }
    if (fullTestData?.coding_problems) {
      fullTestData.coding_problems.forEach(cp => {
        questions.push({
          id: cp.id, type: 'coding', section: 'Programming', title: cp.title, text: cp.description, constraints: cp.constraints
        });
      });
    }
    return questions;
  }, [fullTestData]);

  const activeQ = activeQuestions[currentQIndex];

  if (loading) return <div className="p-20 text-center font-bold animate-pulse text-slate-400">Loading Exam Manifest...</div>;

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      
      {/* HEADER */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm flex justify-between items-center">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="p-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg transition-colors">
            <ArrowLeft size={18} />
          </button>
          <div>
            <h1 className="text-xl font-black text-slate-900">Preview: {test?.title || 'Unknown Exam'}</h1>
            <p className="text-sm font-semibold text-slate-500">
              {activeQuestions.length} Total Questions • {test?.duration_minutes || 0} Minutes
            </p>
          </div>
        </div>
        <div className="flex gap-3">
          {onEdit && (
            <button onClick={() => onEdit(test)} className="flex items-center gap-2 bg-slate-100 hover:bg-slate-200 text-slate-700 px-4 py-2 rounded-lg text-sm font-bold transition-all">
              <Edit3 size={16} /> Edit Exam
            </button>
          )}
          <div className="flex items-center gap-2 bg-indigo-50 text-indigo-700 px-4 py-2 rounded-lg text-sm font-bold border border-indigo-100">
            <MonitorPlay size={16} /> Simulation Mode
          </div>
        </div>
      </div>

      {activeQuestions.length === 0 ? (
        <div className="text-center py-20 bg-white border border-dashed border-slate-300 rounded-2xl">
          <AlertTriangle size={40} className="mx-auto text-amber-400 mb-3" />
          <h3 className="text-slate-700 font-bold text-lg">No Content Found</h3>
          <p className="text-sm text-slate-500 mt-1">This exam has no MCQs or Coding problems configured.</p>
        </div>
      ) : (
        <div className="flex flex-col md:flex-row gap-6">
          
          {/* LEFT PANEL: Question Display */}
          <div className="flex-1 bg-white border border-slate-200 rounded-2xl shadow-sm flex flex-col overflow-hidden min-h-[600px]">
            <div className="bg-slate-50 border-b border-slate-200 px-6 py-4 flex justify-between items-center">
              <div className="flex items-center gap-3">
                <span className="bg-cyan-600 text-white font-black px-3 py-1 rounded-md text-sm">
                  {activeQ.type === 'coding' ? <Code2 size={16} /> : `Q${currentQIndex + 1}`}
                </span>
                <span className="font-bold text-slate-700">{activeQ.section}</span>
              </div>
              <div className="flex items-center gap-2 text-slate-500 font-bold text-sm bg-white px-3 py-1.5 rounded-lg border border-slate-200 shadow-sm">
                <Clock size={16} className="text-cyan-600" /> --:-- (Simulated)
              </div>
            </div>

            <div className="p-8 flex-1 overflow-y-auto">
              {activeQ.type === 'mcq' ? (
                <div className="max-w-3xl">
                  <p className="text-lg font-semibold text-slate-900 mb-8 whitespace-pre-wrap leading-relaxed">{activeQ.text}</p>
                  <div className="grid grid-cols-1 gap-4">
                    {activeQ.options.map(opt => (
                      <button
                        key={opt.id}
                        onClick={() => setSelectedAnswers(prev => ({ ...prev, [currentQIndex]: opt.id }))}
                        className={`text-left p-4 rounded-xl border-2 transition-all flex items-center gap-4 ${
                          selectedAnswers[currentQIndex] === opt.id 
                            ? 'border-cyan-500 bg-cyan-50 text-cyan-900 shadow-sm' 
                            : 'border-slate-200 bg-white text-slate-600 hover:border-cyan-300'
                        }`}
                      >
                        <span className={`w-8 h-8 flex items-center justify-center rounded-lg font-bold text-sm ${
                          selectedAnswers[currentQIndex] === opt.id ? 'bg-cyan-500 text-white' : 'bg-slate-100 text-slate-500'
                        }`}>{opt.id}</span>
                        <span className="font-semibold text-sm">{opt.text}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="max-w-4xl space-y-6">
                  <h2 className="text-2xl font-black text-slate-900">{activeQ.title}</h2>
                  <div className="prose prose-slate max-w-none">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{activeQ.text}</ReactMarkdown>
                  </div>
                  {activeQ.constraints && (
                    <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 mt-6">
                      <h4 className="font-bold text-slate-700 text-sm mb-2 flex items-center gap-2"><Database size={16}/> Constraints</h4>
                      <code className="text-xs text-rose-600 font-bold">{activeQ.constraints}</code>
                    </div>
                  )}
                  <div className="bg-slate-900 rounded-xl p-6 flex items-center justify-center min-h-[300px]">
                    <p className="text-slate-500 font-mono text-sm">Monaco Editor renders here in actual exam.</p>
                  </div>
                </div>
              )}
            </div>

            <div className="bg-slate-50 border-t border-slate-200 p-4 flex justify-between items-center">
              <button 
                onClick={() => setCurrentQIndex(Math.max(0, currentQIndex - 1))}
                disabled={currentQIndex === 0}
                className="px-6 py-2.5 bg-white border border-slate-200 text-slate-700 font-bold rounded-lg shadow-sm disabled:opacity-50 flex items-center gap-2"
              >
                <ChevronLeft size={16}/> Previous
              </button>
              <button 
                onClick={() => setCurrentQIndex(Math.min(activeQuestions.length - 1, currentQIndex + 1))}
                disabled={currentQIndex === activeQuestions.length - 1}
                className="px-6 py-2.5 bg-cyan-600 hover:bg-cyan-700 text-white font-bold rounded-lg shadow-sm disabled:opacity-50 flex items-center gap-2 transition-colors"
              >
                Next <ChevronRight size={16}/>
              </button>
            </div>
          </div>

          {/* RIGHT PANEL: Palette */}
          <div className="w-full md:w-80 bg-white border border-slate-200 rounded-2xl shadow-sm p-5 hidden md:flex flex-col h-[600px]">
            <h4 className="font-black text-slate-800 text-sm mb-4 border-b border-slate-100 pb-3 flex items-center gap-2">
              <Database size={16} className="text-cyan-600" /> Question Palette
            </h4>
            <div className="flex flex-wrap gap-2 content-start flex-1 overflow-y-auto pr-2 pb-4">
              {activeQuestions.map((q, idx) => {
                const isAnswered = q.type === 'coding' ? false : !!selectedAnswers[idx];
                const isActive = currentQIndex === idx;
                return (
                  <button 
                    key={idx} 
                    onClick={() => setCurrentQIndex(idx)} 
                    className={`w-10 h-10 rounded-lg border-2 font-bold flex items-center justify-center text-sm transition-all ${
                      isActive 
                        ? 'border-cyan-600 bg-cyan-50 text-cyan-700 scale-110 shadow-sm' 
                        : isAnswered 
                          ? 'border-emerald-500 bg-emerald-500 text-white' 
                          : 'border-slate-200 bg-white text-slate-500 hover:border-cyan-300'
                    }`}
                  >
                    {q.type === 'coding' ? <Code2 size={16}/> : idx + 1}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}