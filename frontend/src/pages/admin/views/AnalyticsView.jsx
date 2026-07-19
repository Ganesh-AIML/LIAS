import React, { useState, useEffect, useMemo, useCallback } from 'react';
import QuestionRenderer from '../../../components/exam/QuestionRenderer';
import AnswerRenderer from '../../../components/exam/AnswerRenderer';
import CodingEvaluator from '../../../components/admin/CodingEvaluator';
import SubjectiveEvaluator from '../../../components/admin/SubjectiveEvaluator';
import {
  ArrowLeft, Users, CheckCircle, Target, Trophy,
  BookOpen, Code2, BarChart2, Download,
  TrendingUp, Award, Search, X
} from 'lucide-react';
import { adminApi } from '../../../hooks/useAdminApi';

const exportToCsv = (students, testName) => {
  const headers = [
    "Student ID", "Department", "MCQ Score", "Coding Score",
    "Subjective Score", "Total Score", "Percentile", "Status"
  ];
  const rows = [headers.join(",")];
  for (const s of students) {
    const safe = (str) => `"${String(str || 'N/A').replace(/"/g, '""')}"`;
    rows.push([
      safe(s.student_id), safe(s.dept), s.mcqScore, s.codScore,
      s.subjectiveScore, s.total, s.percentile, safe(s.status)
    ].join(","));
  }
  const blob = new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${testName}_Results.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
};

const StudentDetailModal = ({ student, subjectiveQuestions = [], onClose }) => {
  const [activeCodeTab, setActiveCodeTab] = useState(0);
  if (!student) return null;

  const codingSubs = student.codingSubmissions || [];
  const activeSub = codingSubs[activeCodeTab];

  return (
    <div className="fixed inset-0 z-[60] flex justify-end bg-slate-900/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white w-full max-w-2xl h-full shadow-2xl flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-white shrink-0">
          <div>
            <h2 className="text-xl font-black text-slate-900">{student.student_id}</h2>
            <p className="text-sm text-slate-400 font-mono">{student.dept}</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-xl transition-colors text-slate-500"><X size={18} /></button>
        </div>
        <div className="grid grid-cols-4 gap-3 p-6 border-b border-slate-100 shrink-0">
          <div className="bg-blue-50 p-3 rounded-xl border border-blue-100 text-center">
            <p className="text-[10px] font-bold text-blue-600 uppercase">Total</p>
            <p className="text-xl font-black text-blue-900">{student.total}</p>
          </div>
          <div className="bg-indigo-50 p-3 rounded-xl border border-indigo-100 text-center">
            <p className="text-[10px] font-bold text-indigo-600 uppercase">MCQ</p>
            <p className="text-xl font-black text-indigo-900">{student.mcqScore}</p>
          </div>
          <div className="bg-emerald-50 p-3 rounded-xl border border-emerald-100 text-center">
            <p className="text-[10px] font-bold text-emerald-600 uppercase">Coding</p>
            <p className="text-xl font-black text-emerald-900">{student.codScore}</p>
          </div>
          <div className="bg-amber-50 p-3 rounded-xl border border-amber-100 text-center">
            <p className="text-[10px] font-bold text-amber-600 uppercase">Subj</p>
            <p className="text-xl font-black text-amber-900">{student.subjectiveScore}</p>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-6 space-y-8">
          {codingSubs.length > 0 && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Code2 size={16} className="text-blue-600"/>
                <h3 className="font-bold text-slate-900 text-sm uppercase tracking-wider">Coding Submissions</h3>
              </div>
              {codingSubs.length > 0 ? (
                <div className="flex flex-col gap-4">
                  <div className="flex gap-2 overflow-x-auto bg-slate-100 p-1.5 rounded-xl border border-slate-200">
                    {codingSubs.map((sub, idx) => (
                      <button key={idx} onClick={() => setActiveCodeTab(idx)}
                        className={`px-4 py-2 text-sm font-bold rounded-lg transition-all whitespace-nowrap ${
                          activeCodeTab === idx
                            ? 'bg-blue-600 text-white shadow-sm'
                            : 'bg-white text-slate-600 hover:bg-slate-50 shadow-sm border border-slate-200'
                        }`}>
                        {sub.problemTitle}
                        {!sub.isAttempted && <span className="text-red-400 ml-1.5 text-[10px] uppercase">Unattempted</span>}
                      </button>
                    ))}
                  </div>
                  {activeSub && (
                    <div>
                      {activeSub.isAttempted ? (
                        <div className="border border-slate-200 rounded-xl overflow-hidden">
                          <div className="bg-slate-800 p-4">
                            <span className="text-xs font-bold text-slate-400 uppercase">Submission</span>
                          </div>
                          <pre className="p-6 bg-slate-900 text-emerald-500 font-mono text-sm overflow-x-auto max-h-[300px]">
                            <code>{activeSub.submittedCode || "// Code unavailable"}</code>
                          </pre>
                        </div>
                      ) : (
                        <div className="p-8 text-center border border-slate-200 rounded-xl bg-slate-50">
                          <Code2 size={28} className="text-slate-300 mx-auto mb-2" />
                          <p className="text-slate-600 font-bold text-sm">Unattempted Problem</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div className="p-8 text-center border-2 border-dashed border-slate-200 rounded-xl">
                  <Code2 size={28} className="text-slate-300 mx-auto mb-2" />
                  <p className="text-slate-400 text-sm font-medium">No coding submissions found.</p>
                </div>
              )}
            </div>
          )}
          {subjectiveQuestions.length > 0 && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <BookOpen size={16} className="text-blue-600"/>
                <h3 className="font-bold text-slate-900 text-sm uppercase tracking-wider">Subjective Answers</h3>
              </div>
              {subjectiveQuestions.map((sq) => {
                const answer = student.subjectiveAnswers?.[sq.id];
                return (
                  <div key={sq.id} className="border border-slate-200 rounded-xl p-4 space-y-2">
                    <div className="text-sm font-bold text-slate-700">
                      <QuestionRenderer text={sq.text} format={sq.content_format || 'plain'} />
                    </div>
                    {answer ? <AnswerRenderer markdown={answer} /> : <p className="text-slate-400 text-sm italic">No answer provided.</p>}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const SearchableTable = ({ students, columns, onStudentClick, defaultSortKey }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [sortKey, setSortKey] = useState(defaultSortKey || 'total');
  const [sortAsc, setSortAsc] = useState(false);

  const filtered = useMemo(() => {
    if (!searchTerm) return students;
    const lower = searchTerm.toLowerCase();
    return students.filter(s =>
      s.student_id.toLowerCase().includes(lower) ||
      s.dept.toLowerCase().includes(lower)
    );
  }, [students, searchTerm]);

  const sorted = useMemo(() => {
    const list = [...filtered];
    list.sort((a, b) => {
      const va = a[sortKey] ?? 0;
      const vb = b[sortKey] ?? 0;
      if (typeof va === 'string') return sortAsc ? va.localeCompare(vb) : vb.localeCompare(va);
      return sortAsc ? va - vb : vb - va;
    });
    return list.map((s, idx) => ({ ...s, rank: idx + 1 }));
  }, [filtered, sortKey, sortAsc]);

  const toggleSort = (key) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(false); }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
      <div className="p-4 border-b border-slate-100">
        <div className="relative w-full max-w-md">
          <Search size={16} className="absolute left-3 top-2.5 text-slate-400" />
          <input type="text" placeholder="Search student ID or department..." value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/20" />
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200 text-xs uppercase font-bold text-slate-400 tracking-wider">
              {columns.map(col => (
                <th key={col.key} className={`px-4 py-3 ${col.sortable ? 'cursor-pointer hover:text-slate-700 select-none' : ''} ${col.align || ''}`}
                  onClick={() => col.sortable && toggleSort(col.key)}>
                  {col.label}
                  {sortKey === col.key && (sortAsc ? ' ▲' : ' ▼')}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {sorted.length === 0 ? (
              <tr><td colSpan={columns.length} className="px-4 py-16 text-center text-slate-400 font-bold">No students match your search.</td></tr>
            ) : sorted.map(s => (
              <tr key={s.id || s.student_id} onClick={() => onStudentClick?.(s)}
                className="hover:bg-blue-50/40 cursor-pointer transition-colors group">
                {columns.map(col => (
                  <td key={col.key} className={`px-4 py-3 ${col.align || ''}`}>
                    {col.render ? col.render(s) : <span className="font-bold text-slate-900">{s[col.key]}</span>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default function AnalyticsView({ test, onBack }) {
  const [activeSection, setActiveSection] = useState('overview');
  const [loading, setLoading] = useState(true);
  const [analyticsData, setAnalyticsData] = useState(null);
  const [selectedStudentDetail, setSelectedStudentDetail] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const res = await adminApi.get(`/admin/exams/${test.id}/analytics`);
      if (res.success) setAnalyticsData(res.data);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }, [test.id]);

  useEffect(() => { if (test?.id) fetchData(); }, [test.id, fetchData, refreshKey]);

  const handleSave = () => {
    setRefreshKey(k => k + 1);
  };

  const { allStudents, questions, codingProbs, subjectiveQuestions } = useMemo(() => {
    if (!analyticsData) return { allStudents: [], questions: [], codingProbs: [], subjectiveQuestions: [] };
    const students = (analyticsData.students || []).map(r => ({
      id: r.student_id,
      student_id: r.student_id,
      dept: r.department || 'General',
      mcqScore: r.mcq_score || 0,
      codScore: r.cod_score || 0,
      subjectiveScore: r.subjective_score || 0,
      total: r.total_score ?? ((r.mcq_score || 0) + (r.cod_score || 0) + (r.subjective_score || 0)),
      submitTime: r.joined_at ? r.joined_at * 1000 : Date.now(),
      status: r.submitted ? 'Finished' : 'In Progress',
      percentile: 0,
      codingSubmissions: r.coding_submissions || [],
      subjectiveAnswers: r.subjective_answers || {},
      reviewStatus: r.review_status,
    }));

    students.sort((a, b) => b.total - a.total);
    students.forEach((s, idx) => {
      s.percentile = students.length > 1 ? Math.round(((students.length - 1 - idx) / (students.length - 1)) * 100) : 100;
    });

    return {
      allStudents: students,
      questions: analyticsData.questions || [],
      codingProbs: analyticsData.coding_problems || [],
      subjectiveQuestions: analyticsData.subjective_questions || []
    };
  }, [analyticsData]);

  const mcqLeaderboard = useMemo(() => {
    const sorted = [...allStudents].sort((a, b) => b.mcqScore - a.mcqScore);
    return sorted.map((s, idx) => ({ ...s, rank: idx + 1 }));
  }, [allStudents]);

  if (loading && !allStudents.length) {
    return <div className="p-20 text-center text-slate-400 font-bold animate-pulse">Aggregating Global Analytics...</div>;
  }

  const topScore = allStudents[0]?.total ?? 0;
  const avgTotal = allStudents.length ? Math.round(allStudents.reduce((a, s) => a + s.total, 0) / allStudents.length) : 0;
  const finishedCount = allStudents.filter(s => s.status === 'Finished').length;
  const completionRate = allStudents.length ? Math.round((finishedCount / allStudents.length) * 100) : 0;
  const passThreshold = allStudents.length ? Math.round(Math.max(...allStudents.map(s => s.total)) * 0.4) : 0;
  const passCount = allStudents.filter(s => s.total >= passThreshold).length;
  const failCount = allStudents.length - passCount;

  const SECTIONS = [
    { id: 'overview',   label: 'Overview',    icon: BarChart2, color: 'bg-blue-50 text-blue-800 border-blue-200' },
    { id: 'mcqs',       label: 'MCQs',         icon: CheckCircle, color: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
    { id: 'coding',     label: 'Coding',       icon: Code2, color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
    { id: 'subjective', label: 'Subjective',   icon: BookOpen, color: 'bg-amber-50 text-amber-700 border-amber-200' },
    { id: 'leaderboard', label: 'Leaderboard', icon: Trophy, color: 'bg-amber-50 text-amber-700 border-amber-200' }
  ];

  const mcqColumns = [
    { key: 'rank', label: 'Rank', align: 'text-center', sortable: true, render: (s) => <span className="font-black text-slate-500">#{s.rank}</span> },
    { key: 'student_id', label: 'Student', sortable: true },
    { key: 'dept', label: 'Dept', sortable: true },
    { key: 'mcqScore', label: 'MCQ Marks', align: 'text-center', sortable: true, render: (s) => <span className="font-black text-indigo-700">{s.mcqScore}</span> },
    { key: 'status', label: 'Status', align: 'text-center', sortable: true, render: (s) => (
      <span className={`text-[10px] font-bold px-2 py-1 rounded-md uppercase tracking-wider ${s.status === 'Finished' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{s.status}</span>
    )},
  ];

  const leaderboardColumns = [
    { key: 'rank', label: 'Rank', align: 'text-center', sortable: true, render: (s) => <span className="font-black text-slate-500">#{s.rank}</span> },
    { key: 'student_id', label: 'Student', sortable: true },
    { key: 'dept', label: 'Dept', sortable: true },
    { key: 'mcqScore', label: 'MCQ', align: 'text-center', sortable: true, render: (s) => <span className="font-bold text-indigo-700">{s.mcqScore}</span> },
    { key: 'codScore', label: 'Coding', align: 'text-center', sortable: true, render: (s) => <span className="font-bold text-emerald-700">{s.codScore}</span> },
    { key: 'subjectiveScore', label: 'Subj', align: 'text-center', sortable: true, render: (s) => <span className="font-bold text-amber-700">{s.subjectiveScore}</span> },
    { key: 'total', label: 'Total', align: 'text-center', sortable: true, render: (s) => <span className="font-black text-slate-900">{s.total}</span> },
    { key: 'percentile', label: 'Pct', align: 'text-center', sortable: true, render: (s) => <span className="font-black text-sm text-blue-600">{s.percentile}th</span> },
    { key: 'status', label: 'Status', align: 'text-center', render: (s) => (
      <span className={`text-[10px] font-bold px-2 py-1 rounded-md uppercase tracking-wider ${s.status === 'Finished' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{s.status}</span>
    )},
  ];

  return (
    <div className="space-y-5 pb-16">
      <StudentDetailModal student={selectedStudentDetail} subjectiveQuestions={subjectiveQuestions} onClose={() => setSelectedStudentDetail(null)} />

      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="p-2 bg-slate-50 border border-slate-200 rounded-xl hover:bg-slate-100 transition-colors text-slate-600 shrink-0"><ArrowLeft size={20} /></button>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-lg font-black text-slate-900 tracking-tight">{test?.title || "Test Analytics"}</h2>
              <span className="bg-slate-100 text-slate-600 border border-slate-200 px-2.5 py-0.5 rounded-md text-xs font-bold">Completed</span>
            </div>
            <p className="text-xs text-slate-400 mt-1">{allStudents.length} students appeared</p>
          </div>
        </div>
        <button onClick={() => exportToCsv(allStudents, test?.title || "Analytics")}
          className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-4 py-2 rounded-xl transition-all text-sm shadow-sm">
          <Download size={16} /> Export CSV
        </button>
      </div>

      {/* Overview stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm flex flex-col gap-3">
          <div className="flex items-center justify-between"><span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Appeared</span><span className="p-2 rounded-lg bg-blue-50 text-blue-600"><Users size={15} /></span></div>
          <p className="text-3xl font-black text-blue-600">{allStudents.length}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm flex flex-col gap-3">
          <div className="flex items-center justify-between"><span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Highest Score</span><span className="p-2 rounded-lg bg-amber-50 text-amber-600"><Award size={15} /></span></div>
          <p className="text-3xl font-black text-amber-600">{topScore}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm flex flex-col gap-3">
          <div className="flex items-center justify-between"><span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Average Score</span><span className="p-2 rounded-lg bg-indigo-50 text-indigo-600"><TrendingUp size={15} /></span></div>
          <p className="text-3xl font-black text-indigo-600">{avgTotal}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm flex flex-col gap-3">
          <div className="flex items-center justify-between"><span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Completion</span><span className="p-2 rounded-lg bg-emerald-50 text-emerald-600"><CheckCircle size={15} /></span></div>
          <p className="text-3xl font-black text-emerald-600">{completionRate}<span className="text-base font-bold text-slate-400">%</span></p>
          <p className="text-xs text-slate-400">{finishedCount} of {allStudents.length} submitted</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm flex flex-col gap-3">
          <div className="flex items-center justify-between"><span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Pass / Fail</span><span className="p-2 rounded-lg bg-slate-50 text-slate-600"><Target size={15} /></span></div>
          <p className="text-3xl font-black text-slate-900">{passCount}<span className="text-base font-bold text-slate-300"> / {failCount}</span></p>
          <p className="text-xs text-slate-400">≥40% of highest = pass</p>
        </div>
      </div>

      {/* Tab bar */}
      <div className="bg-white p-1.5 rounded-xl border border-slate-200 shadow-sm flex gap-1 overflow-x-auto">
        {SECTIONS.map(({ id, label, icon: Icon, color }) => (
          <button key={id} onClick={() => setActiveSection(id)}
            className={`flex-1 whitespace-nowrap flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-bold rounded-lg transition-all border ${
              activeSection === id ? color + ' shadow-sm' : 'text-slate-500 hover:bg-slate-50 border-transparent'
            }`}>
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      {/* Overview tab */}
      {activeSection === 'overview' && (
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
          <h3 className="font-black text-slate-900 mb-1">Score Distribution</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-5">
            {[
              { label: 'Excellent (76–100%)', min: 0.76, color: 'bg-emerald-50 border-emerald-200 text-emerald-800' },
              { label: 'Good (51–75%)', min: 0.51, max: 0.75, color: 'bg-blue-50 border-blue-200 text-blue-800' },
              { label: 'Average (26–50%)', min: 0.26, max: 0.50, color: 'bg-amber-50 border-amber-200 text-amber-800' },
              { label: 'Below avg (0–25%)', max: 0.25, color: 'bg-red-50 border-red-200 text-red-700' },
            ].map(band => {
              const maxScore = Math.max(...allStudents.map(s => s.total), 1);
              const count = allStudents.filter(s => {
                const pct = s.total / maxScore;
                if (band.min !== undefined && pct < band.min) return false;
                if (band.max !== undefined && pct > band.max) return false;
                return true;
              }).length;
              return (
                <div key={band.label} className={`rounded-xl border p-4 ${band.color}`}>
                  <p className="text-2xl font-black">{count}</p>
                  <p className="text-xs font-bold mt-0.5 opacity-80">{band.label}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* MCQs tab */}
      {activeSection === 'mcqs' && (
        <SearchableTable
          students={mcqLeaderboard}
          columns={mcqColumns}
          defaultSortKey="mcqScore"
          onStudentClick={setSelectedStudentDetail}
        />
      )}

      {/* Coding tab */}
      {activeSection === 'coding' && (
        <CodingEvaluator examId={test.id} onSave={handleSave} />
      )}

      {/* Subjective tab */}
      {activeSection === 'subjective' && (
        <SubjectiveEvaluator examId={test.id} onSave={handleSave} />
      )}

      {/* Leaderboard tab */}
      {activeSection === 'leaderboard' && (
        <SearchableTable
          students={allStudents}
          columns={leaderboardColumns}
          defaultSortKey="total"
          onStudentClick={setSelectedStudentDetail}
        />
      )}
    </div>
  );
}
