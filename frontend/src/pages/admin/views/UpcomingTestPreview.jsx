import React, { useState, useMemo, useEffect, useRef } from 'react';
import { 
  ArrowLeft, Edit3, MonitorPlay, Clock, Database, 
  CheckCircle, ChevronLeft, ChevronRight, Code2, 
  AlertTriangle, FileText, Lock
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { adminApi } from '../../../hooks/useAdminApi';
import QuestionRenderer from '../../../components/exam/QuestionRenderer';

// ── Simulated countdown timer component ─────────────────────────────────────
function SimTimer({ seconds, label, expired }) {
  const m = Math.floor(Math.max(0, seconds) / 60).toString().padStart(2, '0');
  const s = (Math.max(0, seconds) % 60).toString().padStart(2, '0');
  return (
    <div className={`flex items-center gap-2 text-sm font-bold px-3 py-1.5 rounded-lg border ${
      expired ? 'bg-red-50 border-red-200 text-red-600'
      : seconds < 120 ? 'bg-amber-50 border-amber-200 text-amber-700'
      : 'bg-white border-slate-200 text-slate-600'
    } shadow-sm`}>
      <Clock size={14} className={expired ? 'text-red-500' : 'text-blue-600'} />
      {expired ? `${label} Expired` : `${label}: ${m}:${s}`}
    </div>
  );
}

export default function UpcomingTestPreview({ test, onBack, onEdit }) {
  const [fullTestData, setFullTestData] = useState(null);
  const [loading, setLoading] = useState(true);

  // Section state
  const [activeSection, setActiveSection] = useState('mcq'); // 'mcq' | 'coding' | 'qna'
  const [lockedSections, setLockedSections] = useState({});
  const [currentQIndex, setCurrentQIndex] = useState(0);
  const [selectedAnswers, setSelectedAnswers] = useState({});
  const [textAnswers, setTextAnswers] = useState({});

  // Timer state (seconds remaining per section + total)
  const [totalSecs, setTotalSecs] = useState(null);
  const [mcqSecs, setMcqSecs] = useState(null);
  const [codingSecs, setCodingSecs] = useState(null);
  const [qnaSecs, setQnaSecs] = useState(null);
  const [timerRunning, setTimerRunning] = useState(false);
  const timerRef = useRef(null);

  useEffect(() => {
    const fetchFullExam = async () => {
      try {
        const res = await adminApi.get(`/admin/exams/${test.id}`);
        if (res.success) {
          setFullTestData(res.data);
          const d = res.data;
          setTotalSecs((d.duration_minutes || 120) * 60);
          setMcqSecs(d.mcq_duration_minutes ? d.mcq_duration_minutes * 60 : null);
          setCodingSecs(d.coding_duration_minutes ? d.coding_duration_minutes * 60 : null);
          setQnaSecs(d.qna_duration_minutes ? d.qna_duration_minutes * 60 : null);
        }
      } catch (err) {
        console.error('Failed to load exam details');
      } finally {
        setLoading(false);
      }
    };
    if (test?.id) fetchFullExam();
  }, [test.id]);

  // Derived sections from data
  const hasMcq = !!(fullTestData?.questions?.length > 0);
  const hasCoding = !!(fullTestData?.coding_problems?.length > 0);
  const hasQna = !!(fullTestData?.subjective_questions?.length > 0);

  // Set initial section on data load
  useEffect(() => {
    if (!fullTestData) return;
    if (hasMcq) setActiveSection('mcq');
    else if (hasCoding) setActiveSection('coding');
    else if (hasQna) setActiveSection('qna');
  }, [fullTestData, hasMcq, hasCoding, hasQna]);

  // Build question list for current section
  const mcqQuestions = useMemo(() => {
    if (!fullTestData?.questions) return [];
    return fullTestData.questions.map(q => ({
      id: q.id, type: 'mcq', section: q.section, text: q.text,
      content_format: q.content_format || 'plain',
      options: [
        { id: 'A', text: q.optA, content_format: q.content_format || 'plain' },
        { id: 'B', text: q.optB, content_format: q.content_format || 'plain' },
        { id: 'C', text: q.optC, content_format: q.content_format || 'plain' },
        { id: 'D', text: q.optD, content_format: q.content_format || 'plain' },
      ],
      correct: q.ans
    }));
  }, [fullTestData]);

  const codingQuestions = useMemo(() => {
    if (!fullTestData?.coding_problems) return [];
    return fullTestData.coding_problems.map(cp => ({
      id: cp.id, type: 'coding', title: cp.title, text: cp.description, constraints: cp.constraints,
    }));
  }, [fullTestData]);

  const qnaQuestions = useMemo(() => {
    if (!fullTestData?.subjective_questions) return [];
    return fullTestData.subjective_questions.map(sq => ({
      id: sq.id, type: 'qna', section: sq.section, text: sq.text,
      content_format: sq.content_format || 'plain', marks: sq.marks,
    }));
  }, [fullTestData]);

  const currentList =
    activeSection === 'mcq' ? mcqQuestions :
    activeSection === 'coding' ? codingQuestions : qnaQuestions;

  const activeQ = currentList[currentQIndex];

  // Timer countdown effect
  useEffect(() => {
    if (!timerRunning) { clearInterval(timerRef.current); return; }
    timerRef.current = setInterval(() => {
      setTotalSecs(prev => Math.max(0, (prev ?? 0) - 1));
      if (activeSection === 'mcq' && mcqSecs !== null && !lockedSections['mcq']) {
        setMcqSecs(prev => {
          if (prev === null) return null;
          const next = Math.max(0, prev - 1);
          if (next === 0 && prev > 0) {
            setLockedSections(l => ({ ...l, mcq: true }));
          }
          return next;
        });
      }
      if (activeSection === 'coding' && codingSecs !== null && !lockedSections['coding']) {
        setCodingSecs(prev => {
          if (prev === null) return null;
          const next = Math.max(0, prev - 1);
          if (next === 0 && prev > 0) {
            setLockedSections(l => ({ ...l, coding: true }));
          }
          return next;
        });
      }
      if (activeSection === 'qna' && qnaSecs !== null && !lockedSections['qna']) {
        setQnaSecs(prev => {
          if (prev === null) return null;
          const next = Math.max(0, prev - 1);
          if (next === 0 && prev > 0) {
            setLockedSections(l => ({ ...l, qna: true }));
          }
          return next;
        });
      }
    }, 1000);
    return () => clearInterval(timerRef.current);
  }, [timerRunning, activeSection, lockedSections, mcqSecs, codingSecs, qnaSecs]);

  // Reset question index when section changes
  const switchSection = (sec) => {
    if (lockedSections[sec]) return;
    setActiveSection(sec);
    setCurrentQIndex(0);
  };

  if (loading) return <div className="p-20 text-center font-bold animate-pulse text-slate-400">Loading Exam Manifest...</div>;

  // Current section timer
  const currentSecs = activeSection === 'mcq' ? mcqSecs : activeSection === 'coding' ? codingSecs : qnaSecs;
  const currentSectionLocked = !!lockedSections[activeSection];

  return (
    <div className="space-y-6">
      
      {/* HEADER */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm flex justify-between items-center flex-wrap gap-3">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="p-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg transition-colors">
            <ArrowLeft size={18} />
          </button>
          <div>
            <h1 className="text-xl font-black text-slate-900">Preview: {test?.title || 'Unknown Exam'}</h1>
            <p className="text-sm font-semibold text-slate-500">
              {mcqQuestions.length + codingQuestions.length + qnaQuestions.length} Questions
              {' · '}{fullTestData?.duration_minutes || 0} min total
            </p>
          </div>
        </div>
        <div className="flex gap-3 items-center flex-wrap">
          {/* Timer controls */}
          {totalSecs !== null && (
            <div className="flex items-center gap-2">
              <SimTimer
                seconds={currentSecs ?? totalSecs}
                label={currentSecs !== null ? `${activeSection.toUpperCase()} Timer` : 'Total'}
                expired={currentSectionLocked}
              />
              <button
                onClick={() => setTimerRunning(r => !r)}
                className={`px-3 py-1.5 text-xs font-bold rounded-lg border transition-all ${
                  timerRunning
                    ? 'bg-red-50 border-red-200 text-red-600 hover:bg-red-100'
                    : 'bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100'
                }`}
              >
                {timerRunning ? '⏸ Pause' : '▶ Start Timer'}
              </button>
            </div>
          )}
          {onEdit && (
            <button onClick={() => onEdit(test)} className="flex items-center gap-2 bg-slate-100 hover:bg-slate-200 text-slate-700 px-4 py-2 rounded-lg text-sm font-bold transition-all">
              <Edit3 size={16} /> Edit
            </button>
          )}
          <div className="flex items-center gap-2 bg-indigo-50 text-indigo-700 px-4 py-2 rounded-lg text-sm font-bold border border-indigo-100">
            <MonitorPlay size={16} /> Simulation
          </div>
        </div>
      </div>

      {/* No content fallback */}
      {!hasMcq && !hasCoding && !hasQna ? (
        <div className="text-center py-20 bg-white border border-dashed border-slate-300 rounded-2xl">
          <AlertTriangle size={40} className="mx-auto text-amber-400 mb-3" />
          <h3 className="text-slate-700 font-bold text-lg">No Content Found</h3>
          <p className="text-sm text-slate-500 mt-1">This exam has no questions configured yet.</p>
        </div>
      ) : (
        <>
          {/* Task 5: Section tabs — only show available sections */}
          <div className="flex gap-2 flex-wrap">
            {hasMcq && (
              <button
                onClick={() => switchSection('mcq')}
                disabled={!!lockedSections['mcq']}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold border transition-all ${
                  activeSection === 'mcq'
                    ? 'bg-blue-900 text-white border-blue-900 shadow'
                    : lockedSections['mcq']
                      ? 'bg-slate-50 text-slate-300 border-slate-200 cursor-not-allowed'
                      : 'bg-white text-slate-600 border-slate-200 hover:border-blue-300 hover:text-blue-700'
                }`}
              >
                <Database size={14} />
                MCQs ({mcqQuestions.length})
                {lockedSections['mcq'] && <Lock size={12} className="text-red-400" />}
                {fullTestData?.mcq_duration_minutes && (
                  <span className="text-[10px] opacity-70 ml-1">{fullTestData.mcq_duration_minutes}m</span>
                )}
              </button>
            )}
            {hasCoding && (
              <button
                onClick={() => switchSection('coding')}
                disabled={!!lockedSections['coding']}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold border transition-all ${
                  activeSection === 'coding'
                    ? 'bg-blue-900 text-white border-blue-900 shadow'
                    : lockedSections['coding']
                      ? 'bg-slate-50 text-slate-300 border-slate-200 cursor-not-allowed'
                      : 'bg-white text-slate-600 border-slate-200 hover:border-blue-300 hover:text-blue-700'
                }`}
              >
                <Code2 size={14} />
                Coding ({codingQuestions.length})
                {lockedSections['coding'] && <Lock size={12} className="text-red-400" />}
                {fullTestData?.coding_duration_minutes && (
                  <span className="text-[10px] opacity-70 ml-1">{fullTestData.coding_duration_minutes}m</span>
                )}
              </button>
            )}
            {hasQna && (
              <button
                onClick={() => switchSection('qna')}
                disabled={!!lockedSections['qna']}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold border transition-all ${
                  activeSection === 'qna'
                    ? 'bg-blue-900 text-white border-blue-900 shadow'
                    : lockedSections['qna']
                      ? 'bg-slate-50 text-slate-300 border-slate-200 cursor-not-allowed'
                      : 'bg-white text-slate-600 border-slate-200 hover:border-blue-300 hover:text-blue-700'
                }`}
              >
                <FileText size={14} />
                QnA ({qnaQuestions.length})
                {lockedSections['qna'] && <Lock size={12} className="text-red-400" />}
                {fullTestData?.qna_duration_minutes && (
                  <span className="text-[10px] opacity-70 ml-1">{fullTestData.qna_duration_minutes}m</span>
                )}
              </button>
            )}
          </div>

          {/* Section locked banner */}
          {currentSectionLocked && (
            <div className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-xl px-5 py-3">
              <Lock size={16} className="text-red-500 flex-shrink-0" />
              <div>
                <p className="font-bold text-red-700 text-sm">Section Timer Expired</p>
                <p className="text-xs text-red-500">In the actual exam, students would be automatically moved to the next section.</p>
              </div>
            </div>
          )}

          {currentList.length === 0 ? (
            <div className="text-center py-10 bg-white border border-dashed border-slate-200 rounded-xl">
              <p className="text-slate-400 font-bold">No questions in this section.</p>
            </div>
          ) : (
            <div className="flex flex-col md:flex-row gap-6">
              
              {/* LEFT PANEL: Question Display */}
              <div className="flex-1 bg-white border border-slate-200 rounded-2xl shadow-sm flex flex-col overflow-hidden min-h-[600px]">
                <div className="bg-slate-50 border-b border-slate-200 px-6 py-4 flex justify-between items-center">
                  <div className="flex items-center gap-3">
                    <span className="bg-blue-900 text-white font-black px-3 py-1 rounded-md text-sm">
                      {activeQ?.type === 'coding' ? <Code2 size={16} /> : `Q${currentQIndex + 1}`}
                    </span>
                    <span className="font-bold text-slate-700">
                      {activeQ?.section || (activeSection === 'qna' ? 'QnA' : activeSection === 'coding' ? 'Programming' : 'MCQ')}
                    </span>
                    {activeQ?.marks && (
                      <span className="text-xs font-bold text-emerald-600 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-md">
                        {activeQ.marks} marks
                      </span>
                    )}
                  </div>
                  {currentSecs !== null ? (
                    <SimTimer seconds={currentSecs} label="Section" expired={currentSectionLocked} />
                  ) : (
                    <div className="flex items-center gap-2 text-slate-500 font-bold text-sm bg-white px-3 py-1.5 rounded-lg border border-slate-200 shadow-sm">
                      <Clock size={16} className="text-blue-700" /> No Section Timer
                    </div>
                  )}
                </div>

                <div className="p-8 flex-1 overflow-y-auto">
                  {activeQ?.type === 'mcq' ? (
                    <div className="max-w-3xl">
                      <div className="text-lg font-semibold text-slate-900 mb-8 leading-relaxed">
                        <QuestionRenderer text={activeQ.text} format={activeQ.content_format} />
                      </div>
                      <div className="grid grid-cols-1 gap-4">
                        {activeQ.options.map(opt => (
                          <button
                            key={opt.id}
                            onClick={() => !currentSectionLocked && setSelectedAnswers(prev => ({ ...prev, [`${activeSection}-${currentQIndex}`]: opt.id }))}
                            disabled={currentSectionLocked}
                            className={`text-left p-4 rounded-xl border-2 transition-all flex items-center gap-4 ${
                              currentSectionLocked ? 'opacity-50 cursor-not-allowed' :
                              selectedAnswers[`${activeSection}-${currentQIndex}`] === opt.id
                                ? 'border-blue-600 bg-blue-50 text-blue-900 shadow-sm'
                                : 'border-slate-200 bg-white text-slate-600 hover:border-blue-300'
                            }`}
                          >
                            <span className={`w-8 h-8 flex items-center justify-center rounded-lg font-bold text-sm ${
                              selectedAnswers[`${activeSection}-${currentQIndex}`] === opt.id ? 'bg-blue-700 text-white' : 'bg-slate-100 text-slate-500'
                            }`}>{opt.id}</span>
                            <span className="font-semibold text-sm flex-1">
                              <QuestionRenderer text={opt.text} format={opt.content_format} />
                            </span>
                          </button>
                        ))}
                      </div>
                      {!currentSectionLocked && selectedAnswers[`${activeSection}-${currentQIndex}`] && (
                        <button
                          onClick={() => setSelectedAnswers(prev => { const n = {...prev}; delete n[`${activeSection}-${currentQIndex}`]; return n; })}
                          className="mt-4 text-sm text-slate-400 hover:text-red-500 transition-colors font-semibold"
                        >
                          Clear Selection
                        </button>
                      )}
                    </div>
                  ) : activeQ?.type === 'qna' ? (
                    <div className="max-w-3xl space-y-6">
                      <div className="text-lg font-semibold text-slate-900 leading-relaxed">
                        <QuestionRenderer text={activeQ.text} format={activeQ.content_format} />
                      </div>
                      <textarea
                        value={textAnswers[`qna-${currentQIndex}`] || ''}
                        onChange={e => !currentSectionLocked && setTextAnswers(prev => ({ ...prev, [`qna-${currentQIndex}`]: e.target.value }))}
                        disabled={currentSectionLocked}
                        placeholder={currentSectionLocked ? 'Section locked.' : 'Type your answer here… (simulation only — not saved)'}
                        rows={8}
                        className="w-full border-2 border-slate-200 rounded-xl p-4 text-sm font-medium text-slate-700 resize-none focus:outline-none focus:border-blue-400 disabled:bg-slate-50 disabled:opacity-60 disabled:cursor-not-allowed"
                      />
                      <p className="text-xs text-slate-400 italic">Note: In actual exam, a rich-text editor with math support is shown here.</p>
                    </div>
                  ) : (
                    /* coding */
                    <div className="max-w-4xl space-y-6">
                      <h2 className="text-2xl font-black text-slate-900">{activeQ?.title}</h2>
                      <div className="prose prose-slate max-w-none">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{activeQ?.text || ''}</ReactMarkdown>
                      </div>
                      {activeQ?.constraints && (
                        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 mt-6">
                          <h4 className="font-bold text-slate-700 text-sm mb-2 flex items-center gap-2"><Database size={16}/> Constraints</h4>
                          <code className="text-xs text-red-600 font-bold">{activeQ.constraints}</code>
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
                    onClick={() => setCurrentQIndex(Math.min(currentList.length - 1, currentQIndex + 1))}
                    disabled={currentQIndex === currentList.length - 1}
                    className="px-6 py-2.5 bg-blue-900 hover:bg-blue-800 text-white font-bold rounded-xl shadow-sm disabled:opacity-50 flex items-center gap-2 transition-colors"
                  >
                    Next <ChevronRight size={16}/>
                  </button>
                </div>
              </div>

              {/* RIGHT PANEL: Palette */}
              <div className="w-full md:w-80 bg-white border border-slate-200 rounded-2xl shadow-sm p-5 hidden md:flex flex-col h-[600px]">
                <h4 className="font-black text-slate-800 text-sm mb-4 border-b border-slate-100 pb-3 flex items-center gap-2">
                  <Database size={16} className="text-blue-700" /> Question Palette
                  <span className="ml-auto text-xs text-slate-400 font-semibold capitalize">{activeSection}</span>
                </h4>
                <div className="flex flex-wrap gap-2 content-start flex-1 overflow-y-auto pr-2 pb-4">
                  {currentList.map((q, idx) => {
                    const key = `${activeSection}-${idx}`;
                    const isAnswered = q.type === 'mcq'
                      ? !!selectedAnswers[key]
                      : q.type === 'qna'
                        ? !!textAnswers[`qna-${idx}`]
                        : false;
                    const isActive = currentQIndex === idx;
                    return (
                      <button
                        key={idx}
                        onClick={() => setCurrentQIndex(idx)}
                        className={`w-10 h-10 rounded-lg border-2 font-bold flex items-center justify-center text-sm transition-all ${
                          isActive
                            ? 'border-blue-700 bg-blue-50 text-blue-700 scale-110 shadow-sm'
                            : isAnswered
                              ? 'border-emerald-500 bg-emerald-500 text-white'
                              : 'border-slate-200 bg-white text-slate-500 hover:border-blue-300'
                        }`}
                      >
                        {q.type === 'coding' ? <Code2 size={16}/> : idx + 1}
                      </button>
                    );
                  })}
                </div>
                {/* Legend */}
                <div className="border-t border-slate-100 pt-3 mt-2 space-y-1.5">
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    <div className="w-4 h-4 rounded border-2 border-emerald-500 bg-emerald-500" />
                    Answered
                  </div>
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    <div className="w-4 h-4 rounded border-2 border-slate-200 bg-white" />
                    Not Answered
                  </div>
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    <div className="w-4 h-4 rounded border-2 border-blue-700 bg-blue-50" />
                    Current
                  </div>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}