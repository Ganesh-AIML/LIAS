import React, { useState, useEffect, useMemo } from 'react';
import {
  ArrowLeft, Users, CheckCircle, Target, Trophy,
  BookOpen, Code2, BrainCircuit, BarChart2, Download,
  TrendingUp, Award, Database, Search, X, XCircle
} from 'lucide-react';

import { adminApi } from '../../../hooks/useAdminApi'; // Adjust path if necessary

// --- HELPER: CSV EXPORT ENGINE ---
const exportToExcel = (students, testName, questions = [], codingProbs = []) => {
  const aptQuestions = questions.filter(q => q.section.toLowerCase() === 'aptitude');
  const techQuestions = questions.filter(q => q.section.toLowerCase() === 'technical');

  const headers = [
    "Student ID", "Department", "Test Name", "Exam Status"
  ];

  if (aptQuestions.length > 0) headers.push("Total Aptitude Score");
  if (techQuestions.length > 0) headers.push("Total Technical Score");
  
  codingProbs.forEach(prob => headers.push(`Coding: ${prob.title}`));
  if (codingProbs.length > 0) headers.push("Total Coding Score");

  headers.push("Overall Total Score", "Percentile", "Submission Time");
  
  const csvRows = [headers.join(",")];

  for (const s of students) {
    const safeStr = (str) => `"${String(str || 'N/A').replace(/"/g, '""')}"`;
    const safeTime = `"${new Date(s.submitTime).toLocaleString().replace(/,/g, '')}"`;
    
    let row = [
      safeStr(s.student_id), safeStr(s.dept), safeStr(testName), safeStr(s.status)
    ];

    if (aptQuestions.length > 0) row.push(s.aptScore);
    if (techQuestions.length > 0) row.push(s.techScore);

    codingProbs.forEach(prob => row.push(s.sectionScores?.[prob.id] || 0));
    if (codingProbs.length > 0) row.push(s.codScore);

    row.push(s.total, s.percentile, safeTime);
    csvRows.push(row.join(","));
  }

  const csvString = csvRows.join("\n");
  const blob = new Blob([csvString], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${testName}_Results.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
};

// --- SUB-COMPONENT: STUDENT DETAIL MODAL ---
const StudentDetailModal = ({ student, onClose }) => {
  const [activeCodeTab, setActiveCodeTab] = useState(0);

  if (!student) return null;

  const codingSubs = student.codingSubmissions || [];
  const activeSub = codingSubs[activeCodeTab];

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col animate-in zoom-in duration-200">
        
        <div className="p-6 border-b flex justify-between items-center bg-slate-50">
          <div>
            <h2 className="text-xl font-black text-slate-900">{student.student_id}</h2>
            <p className="text-sm text-slate-500 font-mono">{student.dept}</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-200 rounded-full transition-colors"><X size={20} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-8">
          
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-cyan-50 p-4 rounded-xl border border-cyan-100">
              <p className="text-[10px] font-bold text-cyan-600 uppercase">Total Score</p>
              <p className="text-2xl font-black text-cyan-900">{student.total}</p>
            </div>
            <div className="bg-indigo-50 p-4 rounded-xl border border-indigo-100">
              <p className="text-[10px] font-bold text-indigo-600 uppercase">Aptitude</p>
              <p className="text-2xl font-black text-indigo-900">{student.aptScore}</p>
            </div>
            <div className="bg-emerald-50 p-4 rounded-xl border border-emerald-100">
              <p className="text-[10px] font-bold text-emerald-600 uppercase">Technical</p>
              <p className="text-2xl font-black text-emerald-900">{student.techScore}</p>
            </div>
            <div className="bg-purple-50 p-4 rounded-xl border border-purple-100">
              <p className="text-[10px] font-bold text-purple-600 uppercase">Overall Percentile</p>
              <p className="text-2xl font-black text-purple-900">{student.percentile}th</p>
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Code2 size={18} className="text-cyan-600"/>
              <h3 className="font-bold text-slate-900">Coding Submissions</h3>
            </div>
            
            {codingSubs.length > 0 ? (
              <div className="flex flex-col gap-4">
                <div className="flex gap-2 overflow-x-auto bg-slate-100 p-2 rounded-xl border border-slate-200">
                  {codingSubs.map((sub, idx) => (
                    <button 
                      key={idx}
                      onClick={() => setActiveCodeTab(idx)}
                      className={`px-5 py-2.5 text-sm font-bold rounded-lg transition-all whitespace-nowrap ${
                        activeCodeTab === idx 
                          ? 'bg-cyan-600 text-white shadow-md' 
                          : 'bg-white text-slate-600 hover:bg-slate-50 shadow-sm border border-slate-200'
                      }`}
                    >
                      {sub.problemTitle} 
                      {!sub.isAttempted && <span className="text-red-400 ml-1.5 text-[10px] uppercase">Unattempted</span>}
                    </button>
                  ))}
                </div>

                {activeSub && (
                  <div className="animate-in fade-in duration-300">
                    {activeSub.isAttempted ? (
                      <>
                        <div className="border border-slate-200 rounded-xl overflow-hidden">
                          <div className="bg-slate-800 p-4 flex justify-between items-center">
                            <span className="text-xs font-bold text-slate-400 uppercase">Submission Details</span>
                            <div className="flex gap-4">
                              <span className="text-xs font-bold text-emerald-400">Avg Time: {activeSub.runtime || '0.000'}s</span>
                              <span className="text-xs font-bold text-cyan-400">Peak Memory: {activeSub.memory || '0'} KB</span>
                            </div>
                          </div>
                          <pre className="p-6 bg-slate-900 text-emerald-500 font-mono text-sm overflow-x-auto max-h-[400px]">
                            <code>{activeSub.submittedCode || "// Code unavailable"}</code>
                          </pre>
                        </div>

                        {activeSub.testResults && (
                          <div className="mt-6 space-y-4 animate-in fade-in slide-in-from-bottom-4">
                            <h4 className="text-sm font-bold text-slate-700 uppercase tracking-wider mb-2 flex items-center gap-2">
                              <CheckCircle size={16} className="text-emerald-500" />
                              Detailed Test Case Breakdown
                            </h4>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              {activeSub.testResults.map((tc, idx) => (
                                <div key={idx} className={`p-4 rounded-xl border transition-all ${
                                  tc.status === 'Passed'
                                    ? 'bg-emerald-50/50 border-emerald-200 shadow-sm'
                                    : 'bg-red-50/50 border-red-200 shadow-sm'
                                }`}>
                                  
                                  <div className="flex justify-between items-center mb-3 border-b border-slate-200/50 pb-2">
                                    <span className="font-bold text-sm text-slate-800 flex items-center gap-2">
                                      Case {tc.testCase}
                                      {tc.isHidden && <span className="bg-slate-800 text-white text-[10px] px-2.5 py-0.5 rounded-full tracking-wide">Hidden</span>}
                                    </span>
                                    <span className={`text-xs font-bold px-2.5 py-1 rounded-md ${
                                      tc.status === 'Passed' ? 'text-emerald-700 bg-emerald-100' : 'text-red-700 bg-red-100'
                                    }`}>
                                      {tc.status}
                                    </span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="p-10 text-center border border-slate-200 rounded-xl bg-slate-50">
                        <Code2 size={32} className="text-slate-300 mx-auto mb-3" />
                        <p className="text-slate-600 font-bold">Unattempted Problem</p>
                        <p className="text-slate-500 text-sm mt-1">The student did not submit code for this specific challenge.</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="p-8 text-center border-2 border-dashed border-slate-200 rounded-xl">
                <Code2 size={32} className="text-slate-300 mx-auto mb-3" />
                <p className="text-slate-500 font-medium">No coding submissions found for this student.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

// --- LEADERBOARD TABLE ---
const LeaderboardTable = ({ students, scoreKey, scoreLabel, showSections = false, onStudentClick }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const medals = ['🥇', '🥈', '🥉'];
  
  const filteredList = useMemo(() => {
    if (!searchTerm) return students;
    const lower = searchTerm.toLowerCase();
    return students.filter(s => s.student_id.toLowerCase().includes(lower) || s.dept.toLowerCase().includes(lower));
  }, [students, searchTerm]);

  return (
    <div className="flex flex-col">
      <div className="p-4 border-b border-slate-100 bg-white">
        <div className="relative w-full max-w-md">
          <Search size={16} className="absolute left-3 top-2.5 text-slate-400" />
          <input type="text" placeholder="Search student ID..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-cyan-500" />
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200 text-xs uppercase font-bold text-slate-400 tracking-wider">
              <th className="px-4 py-3">Rank</th><th className="px-4 py-3">Student</th><th className="px-4 py-3">Dept</th>
              <th className="px-4 py-3 text-center">Status</th>
              {showSections && <><th className="px-4 py-3 text-center">Apt</th><th className="px-4 py-3 text-center">Tech</th><th className="px-4 py-3 text-center">Cod</th></>}
              <th className="px-4 py-3 text-center">{scoreLabel}</th><th className="px-4 py-3 text-center">Pct</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredList.map((s, idx) => (
              <tr key={s.id} onClick={() => onStudentClick(s)} className="hover:bg-cyan-50/50 cursor-pointer transition-colors group">
                <td className="px-4 py-3"><span className="font-black text-slate-500">{idx < 3 ? medals[idx] : `#${idx + 1}`}</span></td>
                <td className="px-4 py-3">
                  <p className="font-bold text-slate-900 group-hover:text-cyan-700">{s.student_id}</p>
                </td>
                <td className="px-4 py-3 text-xs font-bold text-slate-600">{s.dept}</td>
                <td className="px-4 py-3 text-center">
                  <span className={`text-[10px] font-bold px-2 py-1 rounded-md uppercase tracking-wider ${s.status === 'Finished' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                    {s.status}
                  </span>
                </td>
                {showSections && <><td className="px-4 py-3 text-center font-bold text-indigo-700 text-xs">{s.aptScore}</td><td className="px-4 py-3 text-center font-bold text-emerald-700 text-xs">{s.techScore}</td><td className="px-4 py-3 text-center font-bold text-cyan-700 text-xs">{s.codScore}</td></>}
                <td className="px-4 py-3 text-center"><span className="font-black text-slate-900">{s[scoreKey]}</span></td>
                <td className="px-4 py-3 text-center"><span className="font-black text-sm text-cyan-600">{s.currentViewPercentile ?? s.percentile}th</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// --- MAIN ANALYTICS VIEW ---
export default function AnalyticsView({ test, onBack }) {
  const [activeSection, setActiveSection] = useState('overview');
  const [loading, setLoading] = useState(true);
  const [analyticsData, setAnalyticsData] = useState(null);
  const [selectedStudentDetail, setSelectedStudentDetail] = useState(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await adminApi.get(`/admin/exams/${test.id}/analytics`);
        if (res.success) setAnalyticsData(res.data);
      } catch (err) { console.error(err); }
      finally { setLoading(false); }
    };
    if (test?.id) fetchData();
  }, [test]);

  const { allStudents, questions, codingProbs } = useMemo(() => {
    if (!analyticsData) return { allStudents: [], questions: [], codingProbs: [] };
    
    // In Task 5.5, the backend will return actual submission data.
    // For now, we safely map whatever is available or default to 0.
    const students = (analyticsData.students || []).map(r => {
      return {
        id: r.student_id, 
        student_id: r.student_id,
        dept: r.department || 'General',
        aptScore: r.apt_score || 0, 
        techScore: r.tech_score || 0, 
        codScore: r.cod_score || 0, 
        total: (r.apt_score || 0) + (r.tech_score || 0) + (r.cod_score || 0), 
        submitTime: r.joined_at ? r.joined_at * 1000 : Date.now(), 
        status: r.submitted ? 'Finished' : 'In Progress',
        percentile: 0,
        sectionScores: {},
        codingSubmissions: r.coding_submissions || []
      };
    });

    students.sort((a, b) => b.total - a.total);
    students.forEach((s, idx) => { 
      s.percentile = students.length > 1 ? Math.round(((students.length - 1 - idx) / (students.length - 1)) * 100) : 100; 
    });

    return { 
      allStudents: students, 
      questions: analyticsData.questions || [], 
      codingProbs: analyticsData.coding_problems || [] 
    };
  }, [analyticsData]);

  const sortedLeaderboard = useMemo(() => {
    let key = 'total';
    if (activeSection === 'aptitude') key = 'aptScore';
    if (activeSection === 'technical') key = 'techScore';
    if (activeSection === 'coding') key = 'codScore';

    const sorted = [...allStudents].sort((a, b) => b[key] - a[key]);
    return sorted.map((s, idx) => ({
      ...s,
      currentViewPercentile: sorted.length > 1 ? Math.round(((sorted.length - 1 - idx) / (sorted.length - 1)) * 100) : 100
    }));
  }, [allStudents, activeSection]);

  if (loading) return <div className="p-20 text-center text-slate-400 font-bold animate-pulse">Aggregating Global Analytics...</div>;

  const topScore = allStudents[0]?.total ?? 0;
  const avgTotal = allStudents.length ? Math.round(allStudents.reduce((a, s) => a + s.total, 0) / allStudents.length) : 0;

  const SECTIONS = [
    { id: 'overview',  label: 'Overview', icon: BarChart2, color: 'bg-cyan-50 text-cyan-700 border-cyan-200' },
    { id: 'aptitude', label: 'Aptitude', icon: BrainCircuit, color: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
    { id: 'technical', label: 'Technical', icon: Database, color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
    { id: 'coding', label: 'Coding', icon: Code2, color: 'bg-blue-50 text-blue-700 border-blue-200' },
    { id: 'overall',   label: 'Leaderboard', icon: Trophy, color: 'bg-amber-50 text-amber-700 border-amber-200' }
  ];

  return (
    <div className="space-y-5 pb-16 animate-in fade-in duration-300">
      
      <StudentDetailModal student={selectedStudentDetail} onClose={() => setSelectedStudentDetail(null)} />

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
        <button 
          onClick={() => exportToExcel(allStudents, test?.title || "Analytics", questions, codingProbs)} 
          className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-4 py-2 rounded-xl transition-all text-sm shadow-sm"
        >
          <Download size={16} /> Export CSV
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm flex flex-col gap-3">
          <div className="flex items-center justify-between"><span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Appeared</span><span className="p-2 rounded-lg bg-cyan-50 text-cyan-600"><Users size={15} /></span></div>
          <p className="text-3xl font-black text-cyan-600">{allStudents.length}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm flex flex-col gap-3">
          <div className="flex items-center justify-between"><span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Top Score</span><span className="p-2 rounded-lg bg-amber-50 text-amber-600"><Award size={15} /></span></div>
          <p className="text-3xl font-black text-amber-600">{topScore}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm flex flex-col gap-3">
          <div className="flex items-center justify-between"><span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Avg Score</span><span className="p-2 rounded-lg bg-indigo-50 text-indigo-600"><BrainCircuit size={15} /></span></div>
          <p className="text-3xl font-black text-indigo-600">{avgTotal}</p>
        </div>
      </div>

      <div className="bg-white p-1.5 rounded-xl border border-slate-200 shadow-sm flex gap-1 overflow-x-auto">
        {SECTIONS.map(({ id, label, icon: SectionIcon, color }) => (
          <button key={id} onClick={() => setActiveSection(id)} className={`flex-1 whitespace-nowrap flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-bold rounded-lg transition-all border ${activeSection === id ? color + ' shadow-sm' : 'text-slate-500 hover:bg-slate-50 border-transparent'}`}>
            <SectionIcon size={14} /> {label}
          </button>
        ))}
      </div>

      {activeSection === 'overview' && (
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
          <h3 className="font-black text-slate-900 mb-1">Percentile Band Distribution</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-5">
            {[
              { label: 'Top 10% (90–100)', min: 90, color: 'bg-emerald-50 border-emerald-200 text-emerald-800' },
              { label: 'Good (75–89)', min: 75, max: 89, color: 'bg-cyan-50 border-cyan-200 text-cyan-800' },
              { label: 'Average (50–74)', min: 50, max: 74, color: 'bg-amber-50 border-amber-200 text-amber-800' },
              { label: 'Below avg (<50)', max: 49, color: 'bg-red-50 border-red-200 text-red-700' },
            ].map(band => {
              const count = allStudents.filter(s => {
                const p = s.percentile ?? 0;
                if (band.min !== undefined && p < band.min) return false;
                if (band.max !== undefined && p > band.max) return false;
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

      {activeSection !== 'overview' && (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
             <h3 className="font-black text-slate-900 capitalize">{activeSection} Performance</h3>
             <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Click student row for detail</span>
          </div>
          <LeaderboardTable 
            students={sortedLeaderboard} 
            scoreKey={activeSection === 'overall' ? 'total' : (activeSection === 'aptitude' ? 'aptScore' : activeSection === 'coding' ? 'codScore' : 'techScore')} 
            scoreLabel="Score" 
            showSections={activeSection === 'overall'} 
            onStudentClick={setSelectedStudentDetail}
          />
        </div>
      )}

    </div>
  );
}