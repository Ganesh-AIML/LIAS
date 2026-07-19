import React from 'react';
import { Plus, Trash2, Code2, TerminalSquare } from 'lucide-react';

const generateId = () => `cp_${Math.random().toString(36).substr(2, 9)}`;

export default function CodingProblemBuilder({ problems, setProblems }) {
  const addProblem = () => setProblems([...problems, { id: generateId(), title: '', description: '', constraints: '', languages: '71,54,62,50', marks: 10, testCases: [] }]);
  const updateProblem = (id, field, value) => setProblems(problems.map(p => p.id === id ? { ...p, [field]: value } : p));
  const removeProblem = (id) => setProblems(problems.filter(p => p.id !== id));

  return (
    <div className="space-y-6">
      {problems.map((prob, index) => (
        <div key={prob.id} className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
          <div className="bg-slate-50 border-b p-4 flex justify-between items-center">
            <h3 className="font-black text-slate-800">Problem {index + 1}</h3>
            <button onClick={() => removeProblem(prob.id)} className="text-red-500 hover:bg-red-50 p-1.5 rounded-md transition-colors"><Trash2 size={16} /></button>
          </div>
          <div className="p-5 space-y-4">
            <div><label className="block text-xs font-bold text-slate-600 uppercase mb-1">Problem Title</label><input type="text" value={prob.title} onChange={e => updateProblem(prob.id, 'title', e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm font-semibold focus:outline-none focus:border-blue-600" /></div>
            <div><label className="block text-xs font-bold text-slate-600 uppercase mb-1">Description (MD)</label><textarea rows="5" value={prob.description} onChange={e => updateProblem(prob.id, 'description', e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-blue-600 resize-none" /></div>
            <div className="grid grid-cols-2 gap-4">
              <div><label className="block text-xs font-bold text-slate-600 uppercase mb-1">Constraints <span className="text-slate-300 normal-case font-medium">optional</span></label><textarea rows="3" value={prob.constraints} onChange={e => updateProblem(prob.id, 'constraints', e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-blue-600 resize-none" /></div>
              <div><label className="block text-xs font-bold text-slate-600 uppercase mb-1">Maximum Marks</label><input type="number" min="1" value={prob.marks} onChange={e => updateProblem(prob.id, 'marks', parseInt(e.target.value) || 0)} className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm font-semibold focus:outline-none focus:border-blue-600" /></div>
            </div>
          </div>
        </div>
      ))}
      <button onClick={addProblem} className="w-full flex items-center justify-center gap-2 py-4 border-2 border-dashed border-slate-200 rounded-2xl text-slate-500 hover:border-blue-400 hover:text-blue-600 font-bold text-sm transition-all bg-white">
        <Plus size={18} /> Add Problem
      </button>
    </div>
  );
}
