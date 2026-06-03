import React, { useState } from 'react';
import { Plus, Trash2, Code2, TerminalSquare, Lock, Unlock, CheckCircle } from 'lucide-react';

const generateId = () => `cp_${Math.random().toString(36).substr(2, 9)}`;
const generateTcId = () => `tc_${Math.random().toString(36).substr(2, 9)}`;

export default function CodingProblemBuilder({ problems, setProblems }) {
  const addProblem = () => {
    setProblems([...problems, {
      id: generateId(),
      title: '',
      description: '',
      constraints: '',
      languages: '71,54,62,50', // Default: Python, C++, Java, C
      testCases: []
    }]);
  };

  const updateProblem = (id, field, value) => {
    setProblems(problems.map(p => p.id === id ? { ...p, [field]: value } : p));
  };

  const removeProblem = (id) => setProblems(problems.filter(p => p.id !== id));

  const addTestCase = (probId) => {
    setProblems(problems.map(p => {
      if (p.id === probId) {
        return { ...p, testCases: [...p.testCases, { id: generateTcId(), input: '', output: '', isHidden: false }] };
      }
      return p;
    }));
  };

  const updateTestCase = (probId, tcId, field, value) => {
    setProblems(problems.map(p => {
      if (p.id === probId) {
        return {
          ...p,
          testCases: p.testCases.map(tc => tc.id === tcId ? { ...tc, [field]: value } : tc)
        };
      }
      return p;
    }));
  };

  const removeTestCase = (probId, tcId) => {
    setProblems(problems.map(p => {
      if (p.id === probId) {
        return { ...p, testCases: p.testCases.filter(tc => tc.id !== tcId) };
      }
      return p;
    }));
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
        <div>
          <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2"><Code2 size={20} className="text-cyan-600" /> Coding Challenges</h2>
          <p className="text-xs text-slate-500 font-semibold mt-1">Configure algorithmic problems and execution test cases.</p>
        </div>
        <button onClick={addProblem} className="flex items-center gap-1.5 bg-cyan-600 hover:bg-cyan-700 text-white px-4 py-2 rounded-lg text-sm font-bold transition-all shadow-sm">
          <Plus size={16} /> Add Problem
        </button>
      </div>

      {problems.length === 0 ? (
        <div className="text-center py-16 bg-white border border-dashed border-slate-300 rounded-2xl">
          <Code2 size={40} className="mx-auto text-slate-300 mb-3" />
          <h3 className="text-slate-500 font-bold">No Coding Problems Added</h3>
          <p className="text-xs text-slate-400 mt-1">Click "Add Problem" to start building your technical assessment.</p>
        </div>
      ) : (
        problems.map((prob, index) => (
          <div key={prob.id} className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
            <div className="bg-slate-50 border-b border-slate-200 p-4 flex justify-between items-center">
              <h3 className="font-black text-slate-800">Problem {index + 1}</h3>
              <button onClick={() => removeProblem(prob.id)} className="text-red-500 hover:bg-red-50 p-1.5 rounded-md transition-colors"><Trash2 size={16} /></button>
            </div>
            <div className="p-5 grid grid-cols-1 lg:grid-cols-2 gap-6">
              
              {/* Left Column: Problem Details */}
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-600 uppercase mb-1">Problem Title</label>
                  <input type="text" placeholder="e.g., Two Sum" value={prob.title} onChange={e => updateProblem(prob.id, 'title', e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-cyan-500 font-semibold" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-600 uppercase mb-1">Description (Markdown Supported)</label>
                  <textarea rows="5" placeholder="Describe the problem..." value={prob.description} onChange={e => updateProblem(prob.id, 'description', e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-cyan-500 font-mono resize-none" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-600 uppercase mb-1">Constraints</label>
                  <input type="text" placeholder="e.g., 1 <= N <= 10^5" value={prob.constraints} onChange={e => updateProblem(prob.id, 'constraints', e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-cyan-500 font-mono" />
                </div>
              </div>

              {/* Right Column: Test Cases */}
              <div className="border border-slate-200 rounded-xl bg-slate-50 flex flex-col">
                <div className="flex justify-between items-center p-3 border-b border-slate-200 bg-white rounded-t-xl">
                  <div className="flex items-center gap-2"><TerminalSquare size={16} className="text-slate-500"/> <span className="text-xs font-bold text-slate-700 uppercase">Test Cases</span></div>
                  <button onClick={() => addTestCase(prob.id)} className="text-xs font-bold bg-slate-200 hover:bg-slate-300 text-slate-700 px-3 py-1 rounded-md transition-colors">Add Case</button>
                </div>
                <div className="p-3 space-y-3 overflow-y-auto max-h-[350px]">
                  {prob.testCases.map((tc, tcIdx) => (
                    <div key={tc.id} className="bg-slate-800 rounded-lg p-3 relative group">
                      <div className="absolute top-2 right-2 flex gap-2">
                        <button onClick={() => updateTestCase(prob.id, tc.id, 'isHidden', !tc.isHidden)} className={`text-xs ${tc.isHidden ? 'text-amber-400' : 'text-emerald-400'}`}>
                          {tc.isHidden ? <Lock size={14}/> : <Unlock size={14}/>}
                        </button>
                        <button onClick={() => removeTestCase(prob.id, tc.id)} className="text-slate-500 hover:text-red-400"><XCircle size={14} /></button>
                      </div>
                      <p className="text-[10px] font-bold text-slate-400 mb-2 uppercase">Case {tcIdx + 1} {tc.isHidden && '(Hidden)'}</p>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-[9px] text-slate-500 uppercase mb-1">STDIN (Input)</label>
                          <textarea rows="2" value={tc.input} onChange={e => updateTestCase(prob.id, tc.id, 'input', e.target.value)} className="w-full bg-slate-900 text-cyan-400 border border-slate-700 rounded-md p-2 text-xs font-mono focus:outline-none focus:border-cyan-500 resize-none" />
                        </div>
                        <div>
                          <label className="block text-[9px] text-slate-500 uppercase mb-1">STDOUT (Expected)</label>
                          <textarea rows="2" value={tc.output} onChange={e => updateTestCase(prob.id, tc.id, 'output', e.target.value)} className="w-full bg-slate-900 text-emerald-400 border border-slate-700 rounded-md p-2 text-xs font-mono focus:outline-none focus:border-cyan-500 resize-none" />
                        </div>
                      </div>
                    </div>
                  ))}
                  {prob.testCases.length === 0 && <p className="text-xs text-center text-slate-400 font-semibold py-4">No test cases configured.</p>}
                </div>
              </div>

            </div>
          </div>
        ))
      )}
    </div>
  );
}

// Ensure XCircle is imported for the delete icon in test cases
import { XCircle } from 'lucide-react';