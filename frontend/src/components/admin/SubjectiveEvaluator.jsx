import React, { useState, useEffect, useCallback, useRef } from 'react';
import { evaluateApi } from '../../hooks/useEvaluateApi';
import QuestionRenderer from '../exam/QuestionRenderer';
import AnswerRenderer from '../exam/AnswerRenderer';
import { Search, ChevronRight, Save, RotateCcw, Flag, Loader, AlertCircle } from 'lucide-react';

export default function SubjectiveEvaluator({ examId, onSave }) {
  const [students, setStudents] = useState([]);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [marks, setMarks] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [error, setError] = useState(null);
  const selectedRef = useRef(null);

  const fetchStudents = useCallback(async () => {
    try {
      setLoading(true);
      const res = await evaluateApi.listStudents(examId);
      if (res.success) setStudents(res.data || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [examId]);

  useEffect(() => { fetchStudents(); }, [fetchStudents]);

  const selectStudent = async (sessionId) => {
    selectedRef.current = sessionId;
    try {
      setLoading(true);
      setSelected(sessionId);
      const res = await evaluateApi.getDetail(examId, sessionId);
      if (selectedRef.current !== sessionId) return;
      if (res.success) {
        setDetail(res.data);
        const initial = {};
        const subjQuestions = res.data.subjective_details || [];
        for (const sq of subjQuestions) {
          initial[sq.question_id] = res.data.current_subjective_marks?.[sq.question_id] ?? '';
        }
        setMarks(initial);
      }
    } catch (err) {
      if (selectedRef.current !== sessionId) return;
      setError(err.message);
    } finally {
      if (selectedRef.current === sessionId) setLoading(false);
    }
  };

  const handleMarksChange = (qId, value) => {
    setMarks(prev => ({ ...prev, [qId]: value }));
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      const subjMarks = {};
      for (const [id, val] of Object.entries(marks)) {
        if (val !== '' && val !== null) {
          const num = parseFloat(val);
          if (!isNaN(num)) subjMarks[id] = num;
        }
      }
      await evaluateApi.saveMarks(examId, selected, { subjective_marks: subjMarks, review_status: 'reviewed' });
      await fetchStudents();
      if (onSave) onSave();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    try {
      setSaving(true);
      await evaluateApi.clearMarks(examId, selected);
      setMarks({});
      await fetchStudents();
      if (onSave) onSave();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleReviewFlag = async (status) => {
    try {
      await evaluateApi.setReviewStatus(examId, selected, status);
      await fetchStudents();
    } catch (err) {
      setError(err.message);
    }
  };

  const filteredStudents = students.filter(s =>
    !search || s.student_id.toLowerCase().includes(search.toLowerCase())
  );

  if (loading && !students.length) {
    return <div className="p-20 text-center text-slate-400 animate-pulse font-bold">Loading evaluator...</div>;
  }

  return (
    <div className="flex gap-0 bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden min-h-[500px]">
      {/* Left panel */}
      <div className="w-72 shrink-0 border-r border-slate-200 flex flex-col bg-slate-50">
        <div className="p-3 border-b border-slate-200 bg-white">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-2.5 text-slate-400" />
            <input
              type="text"
              placeholder="Search student..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
          {filteredStudents.map(s => (
            <button
              key={s.session_id}
              onClick={() => selectStudent(s.session_id)}
              className={`w-full text-left p-3 hover:bg-blue-50 transition-colors flex items-center justify-between ${
                selected === s.session_id ? 'bg-blue-50 border-l-2 border-l-blue-600' : ''
              }`}
            >
              <div className="min-w-0">
                <p className="text-sm font-bold text-slate-900 truncate">{s.student_id}</p>
                <p className="text-[10px] text-slate-400 font-mono">{s.department}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {s.review_status && (
                  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
                    s.review_status === 'reviewed' ? 'bg-emerald-100 text-emerald-700' :
                    s.review_status === 'flagged' ? 'bg-red-100 text-red-700' :
                    'bg-amber-100 text-amber-700'
                  }`}>
                    {s.review_status}
                  </span>
                )}
                <ChevronRight size={14} className="text-slate-300" />
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Right panel */}
      <div className="flex-1 overflow-y-auto">
        {!detail ? (
          <div className="p-20 text-center">
            <p className="text-slate-400 font-bold">Select a student to begin evaluating</p>
          </div>
        ) : loading ? (
          <div className="p-20 text-center">
            <Loader className="animate-spin mx-auto mb-2" size={24} />
            <p className="text-slate-400 text-sm">Loading submission...</p>
          </div>
        ) : (
          <div className="p-6 space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-black text-slate-900">{detail.student_id}</h3>
                <p className="text-xs text-slate-400">Subjective Answers</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-slate-500">MCQ: {detail.mcq_score}</span>
                <span className="text-xs font-bold text-blue-600">| Total: {detail.total_score ?? detail.mcq_score}</span>
              </div>
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-3 flex items-center gap-2 text-sm text-red-700">
                <AlertCircle size={16} /> {error}
              </div>
            )}

            {(detail.subjective_details || []).length === 0 ? (
              <div className="p-8 text-center border-2 border-dashed border-slate-200 rounded-xl">
                <p className="text-slate-400 font-medium">No subjective questions found.</p>
              </div>
            ) : (detail.subjective_details || []).map(sq => (
              <div key={sq.question_id} className="border border-slate-200 rounded-xl p-4 space-y-3">
                <div className="text-sm font-bold text-slate-800">
                  <QuestionRenderer text={sq.text} format={sq.content_format || 'plain'} />
                </div>

                {/* Student answer */}
                <div>
                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Student Answer</p>
                  {sq.student_answer ? (
                    <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                      <AnswerRenderer markdown={sq.student_answer} />
                    </div>
                  ) : (
                    <p className="text-sm text-slate-400 italic">No answer provided.</p>
                  )}
                </div>

                {/* Marks */}
                <div className="flex items-center gap-3">
                  <label className="text-sm font-bold text-slate-700">Marks:</label>
                  <input
                    type="number"
                    min="0"
                    max={sq.max_marks || 100}
                    step="0.5"
                    value={marks[sq.question_id] ?? ''}
                    onChange={e => handleMarksChange(sq.question_id, e.target.value)}
                    className="w-24 px-3 py-1.5 border border-slate-300 rounded-lg text-sm font-bold text-center focus:outline-none focus:border-blue-500"
                    placeholder="0"
                  />
                  <span className="text-xs text-slate-400">/ {sq.max_marks || 10}</span>
                </div>
              </div>
            ))}

            {/* Action buttons */}
            <div className="flex items-center gap-3 pt-4 border-t border-slate-200">
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-bold px-5 py-2 rounded-xl text-sm transition-colors"
              >
                {saving ? <Loader size={14} className="animate-spin" /> : <Save size={14} />}
                Save Changes
              </button>
              <button
                onClick={handleClear}
                disabled={saving}
                className="flex items-center gap-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold px-4 py-2 rounded-xl text-sm transition-colors border border-slate-200"
              >
                <RotateCcw size={14} /> Clear Marks
              </button>
              <button
                onClick={() => handleReviewFlag('flagged')}
                className="flex items-center gap-1.5 bg-red-50 hover:bg-red-100 text-red-700 font-bold px-4 py-2 rounded-xl text-sm transition-colors border border-red-200"
              >
                <Flag size={14} /> Flag for Review
              </button>
              <button
                onClick={() => handleReviewFlag('reviewed')}
                className="flex items-center gap-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-bold px-4 py-2 rounded-xl text-sm transition-colors border border-emerald-200"
              >
                Mark Reviewed
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
