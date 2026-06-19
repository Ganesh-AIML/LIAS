import React, { useState, useEffect } from "react";
import MarkdownZipImporter, { parseMarkdownZip } from "../../../components/admin/MarkdownZipImporter";
import {
  ArrowLeft,
  Save,
  Send,
  FileText,
  Code2,
  Settings,
  Plus,
  Trash2,
  Upload,
  CheckCircle2,
  Circle,
  BookOpen,
  AlertCircle,
} from "lucide-react";
import CodingProblemBuilder from "./CodingProblemBuilder";
import { adminApi } from "../../../hooks/useAdminApi";

const generateId = () => `mcq_${Math.random().toString(36).substr(2, 9)}`;

// --- STEPPER CONFIG ---
const STEPS = [
  { id: "setup",      label: "Setup",      icon: Settings,  desc: "Title, schedule & passwords" },
  { id: "mcq",        label: "MCQs",       icon: FileText,  desc: "Multiple choice questions" },
  { id: "coding",     label: "Coding",     icon: Code2,     desc: "Programming challenges" },
  { id: "subjective", label: "Subjective", icon: BookOpen,  desc: "Open-ended questions" },
];

// --- STRIPE-STYLE STEPPER ---
const Stepper = ({ activeTab, setActiveTab, counts }) => (
  <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
    <div className="flex">
      {STEPS.map((step, idx) => {
        const Icon = step.icon;
        const isActive = activeTab === step.id;
        const isDone = STEPS.findIndex(s => s.id === activeTab) > idx;
        const count = counts[step.id];
        return (
          <button
            key={step.id}
            onClick={() => setActiveTab(step.id)}
            className={`flex-1 flex flex-col items-center gap-1.5 px-3 py-4 text-center transition-all relative border-b-2 ${
              isActive
                ? "border-blue-600 bg-blue-50/60 text-blue-700"
                : isDone
                ? "border-emerald-500 bg-emerald-50/30 text-emerald-700 hover:bg-emerald-50"
                : "border-transparent text-slate-400 hover:bg-slate-50 hover:text-slate-600"
            }`}
          >
            <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
              isActive ? "bg-blue-600 text-white" : isDone ? "bg-emerald-500 text-white" : "bg-slate-100 text-slate-400"
            }`}>
              {isDone ? <CheckCircle2 size={16} /> : <Icon size={15} />}
            </div>
            <span className="text-xs font-black tracking-wide hidden sm:block">{step.label}</span>
            {count !== undefined && (
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                isActive ? "bg-blue-100 text-blue-700" : isDone ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"
              }`}>
                {count}
              </span>
            )}
            {idx < STEPS.length - 1 && (
              <div className="absolute right-0 top-1/2 -translate-y-1/2 w-px h-8 bg-slate-100" />
            )}
          </button>
        );
      })}
    </div>
  </div>
);

export default function ScheduleTest({ initialData, onBack }) {
  const [activeTab, setActiveTab] = useState("setup");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  const formatTimeForInput = (ms) =>
    ms
      ? new Date(ms - new Date().getTimezoneOffset() * 60000)
          .toISOString()
          .slice(0, 16)
      : "";

  const [testMeta, setTestMeta] = useState({
    title: initialData?.title || "",
    starts_at: initialData?.starts_at_ms
      ? formatTimeForInput(initialData.starts_at_ms)
      : "",
    duration_minutes: initialData?.duration_minutes || "120",
    coding_duration_minutes: initialData?.coding_duration_minutes || "60",
    start_password: initialData?.start_password_hash || "",
    end_password: initialData?.end_password_hash || "",
  });

  const [subjectiveQuestions, setSubjectiveQuestions] = useState(initialData?.subjective_questions || []);
  const [questions, setQuestions] = useState(initialData?.questions || []);
  const [codingProblems, setCodingProblems] = useState(initialData?.coding_problems || []);

  const addQuestion = () =>
    setQuestions([...questions, { id: generateId(), section: "Aptitude", text: "", optA: "", optB: "", optC: "", optD: "", ans: "A" }]);
  const removeQuestion = (id) => setQuestions(questions.filter((q) => q.id !== id));
  const updateQuestion = (id, field, value) =>
    setQuestions(questions.map((q) => (q.id === id ? { ...q, [field]: value } : q)));

  const generateSqId = () => `sq_${Math.random().toString(36).substr(2, 9)}`;
  const addSubjectiveQ = () => setSubjectiveQuestions(prev => [...prev, { id: generateSqId(), section: "Theory", text: "", marks: 10 }]);
  const removeSubjectiveQ = (id) => setSubjectiveQuestions(prev => prev.filter(q => q.id !== id));
  const updateSubjectiveQ = (id, field, value) => setSubjectiveQuestions(prev => prev.map(q => q.id === id ? { ...q, [field]: value } : q));

  const handleAikenImport = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const text = ev.target.result;
        const blocks = text.split(/\n\s*\n/).map((b) => b.trim()).filter((b) => b);
        const importedQuestions = blocks.map((block) => {
          const lines = block.split("\n").map((l) => l.trim()).filter((l) => l);
          if (lines.length < 6) return null;
          const text = lines[0];
          const opts = { A: "", B: "", C: "", D: "" };
          let ans = "A";
          for (let i = 1; i < lines.length; i++) {
            const line = lines[i];
            if (line.match(/^A[).]/i)) opts.A = line.substring(2).trim();
            else if (line.match(/^B[).]/i)) opts.B = line.substring(2).trim();
            else if (line.match(/^C[).]/i)) opts.C = line.substring(2).trim();
            else if (line.match(/^D[).]/i)) opts.D = line.substring(2).trim();
            else if (line.match(/^ANSWER:/i)) ans = line.replace(/^ANSWER:/i, "").trim().toUpperCase();
          }
          return { id: generateId(), section: "Aptitude", text, optA: opts.A, optB: opts.B, optC: opts.C, optD: opts.D, ans };
        }).filter((q) => q !== null);
        setQuestions((prev) => [...prev, ...importedQuestions]);
        alert(`Successfully imported ${importedQuestions.length} questions.`);
      } catch (err) {
        alert("Failed to parse Aiken file. Please check formatting.");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  // Markdown/ZIP bulk import — merges parsed sections into existing question arrays
  const handleMarkdownImport = ({ sections, errors }) => {
    const newMcq  = [];
    const newSubj = [];

    for (const { meta, questions: qs } of sections) {
      for (const q of qs) {
        if (meta.type === 'subjective') {
          newSubj.push({
            id:             generateSqId(),
            section:        q.section || meta.section || 'Theory',
            text:           q.text || '',
            marks:          q.marks ?? meta.marks_per_question ?? 10,
            content_format: q.content_format || 'markdown',
          });
        } else {
          newMcq.push({
            id:             generateId(),
            section:        q.section || meta.section || 'Aptitude',
            text:           q.text   || '',
            optA:           q.optA   || '',
            optB:           q.optB   || '',
            optC:           q.optC   || '',
            optD:           q.optD   || '',
            ans:            q.ans    || 'A',
            content_format: q.content_format || 'markdown',
          });
        }
      }
    }

    if (newMcq.length)  setQuestions(prev        => [...prev, ...newMcq]);
    if (newSubj.length) setSubjectiveQuestions(prev => [...prev, ...newSubj]);
  };

  const handlePublish = async (status) => {
    setError("");
    if (!testMeta.title || !testMeta.starts_at) {
      setError("Title and Start Date are required.");
      setActiveTab("setup");
      return;
    }
    setIsSubmitting(true);
    try {
      const payload = {
        ...testMeta,
        duration_minutes: parseInt(testMeta.duration_minutes),
        coding_duration_minutes: parseInt(testMeta.coding_duration_minutes) || 60,
        starts_at: new Date(testMeta.starts_at).getTime(),
        status: status,
        questions: questions,
        coding_problems: codingProblems,
        subjective_questions: subjectiveQuestions,
      };
      let res;
      if (initialData?.id) {
        res = await adminApi.put(`/admin/exams/${initialData.id}`, payload);
      } else {
        if (!testMeta.start_password) throw new Error("Start Password required for new exams.");
        res = await adminApi.post("/admin/exams", payload);
      }
      if (res.success) onBack();
    } catch (err) {
      setError(err.message || "Failed to save exam.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const stepCounts = {
    mcq: questions.length,
    coding: codingProblems.length,
    subjective: subjectiveQuestions.length,
  };

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="p-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl transition-colors">
            <ArrowLeft size={18} />
          </button>
          <div>
            <h1 className="text-xl font-black text-slate-900">{testMeta.title || "Untitled Assessment"}</h1>
            <p className="text-sm font-semibold text-slate-400">{initialData?.id ? "Editing Draft" : "Exam Builder"}</p>
          </div>
        </div>
        {/* Progress summary */}
        <div className="flex items-center gap-3 text-xs font-bold text-slate-400">
          <span>{questions.length} MCQ</span>
          <span className="text-slate-200">·</span>
          <span>{codingProblems.length} Coding</span>
          <span className="text-slate-200">·</span>
          <span>{subjectiveQuestions.length} Subjective</span>
        </div>
      </div>

      {/* Stepper */}
      <Stepper activeTab={activeTab} setActiveTab={setActiveTab} counts={stepCounts} />

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-xl text-sm font-bold flex items-center gap-2">
          <AlertCircle size={16} /> {error}
        </div>
      )}

      {/* Step panels */}
      <div className="pb-24">

        {/* SETUP */}
        {activeTab === "setup" && (
          <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm max-w-2xl mx-auto space-y-5">
            <div className="flex items-center gap-2 mb-1">
              <Settings size={16} className="text-blue-600" />
              <h2 className="text-sm font-black text-slate-700 uppercase tracking-wider">Exam Details</h2>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5">Exam Title *</label>
              <input
                type="text"
                value={testMeta.title}
                onChange={(e) => setTestMeta({ ...testMeta, title: e.target.value })}
                className="w-full border border-slate-200 rounded-xl px-4 py-3 focus:border-blue-500 focus:ring-1 focus:ring-blue-500/20 outline-none bg-slate-50 font-semibold text-slate-900"
                placeholder="e.g. Campus Recruitment Drive 2025"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5">Start Date & Time *</label>
                <input
                  type="datetime-local"
                  value={testMeta.starts_at}
                  onChange={(e) => setTestMeta({ ...testMeta, starts_at: e.target.value })}
                  className="w-full border border-slate-200 rounded-xl px-4 py-3 focus:border-blue-500 focus:ring-1 focus:ring-blue-500/20 outline-none bg-slate-50 font-semibold"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5">Duration (Minutes) *</label>
                <input
                  type="number"
                  min="1"
                  value={testMeta.duration_minutes}
                  onChange={(e) => setTestMeta({ ...testMeta, duration_minutes: e.target.value })}
                  className="w-full border border-slate-200 rounded-xl px-4 py-3 focus:border-blue-500 focus:ring-1 focus:ring-blue-500/20 outline-none bg-slate-50 font-semibold"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5">Coding Duration (Minutes)</label>
                <input
                  type="number"
                  min="1"
                  value={testMeta.coding_duration_minutes}
                  onChange={(e) => setTestMeta({ ...testMeta, coding_duration_minutes: e.target.value })}
                  className="w-full border border-slate-200 rounded-xl px-4 py-3 focus:border-blue-500 focus:ring-1 focus:ring-blue-500/20 outline-none bg-slate-50 font-semibold"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5">
                  {initialData?.id ? "Update Start Password" : "Start Password *"}
                </label>
                <input
                  type="text"
                  value={initialData?.id ? (testMeta.start_password.startsWith("$2b$") ? "" : testMeta.start_password) : testMeta.start_password}
                  onChange={(e) => setTestMeta({ ...testMeta, start_password: e.target.value })}
                  className="w-full border border-slate-200 rounded-xl px-4 py-3 focus:border-blue-500 focus:ring-1 focus:ring-blue-500/20 outline-none bg-slate-50 font-semibold text-slate-700"
                  placeholder={initialData?.id ? "Leave blank to keep existing" : ""}
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5">End Password (Optional)</label>
                <input
                  type="text"
                  placeholder="Leave blank for no end password"
                  value={testMeta.end_password || ""}
                  onChange={(e) => setTestMeta({ ...testMeta, end_password: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-semibold focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/20"
                />
              </div>
            </div>
            <div className="pt-2">
              <button
                onClick={() => setActiveTab("mcq")}
                className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-sm transition-all shadow-sm"
              >
                Continue to MCQs →
              </button>
            </div>
          </div>
        )}

        {/* MCQ */}
        {activeTab === "mcq" && (
          <div className="space-y-4">
            <div className="flex justify-between items-center bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
              <h2 className="text-base font-black text-slate-800 flex items-center gap-2">
                <FileText size={18} className="text-blue-600" /> Multiple Choice Questions
                <span className="text-xs font-bold bg-blue-50 text-blue-600 border border-blue-100 px-2 py-0.5 rounded-full">{questions.length}</span>
              </h2>
              <div className="flex gap-2">
                <label className="flex items-center gap-1.5 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 px-4 py-2 rounded-xl text-sm font-bold transition-all cursor-pointer shadow-sm">
                  <Upload size={15} /> Import Aiken
                  <input type="file" accept=".txt" className="hidden" onChange={handleAikenImport} />
                </label>
                <MarkdownZipImporter
                  onImport={handleMarkdownImport}
                  className="inline-flex"
                />
                <button
                  onClick={addQuestion}
                  className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-xl text-sm font-bold transition-all shadow-sm"
                >
                  <Plus size={15} /> Add MCQ
                </button>
              </div>
            </div>

            {questions.length === 0 && (
              <div className="bg-white border-2 border-dashed border-slate-200 rounded-2xl p-16 text-center">
                <FileText size={32} className="text-slate-200 mx-auto mb-3" />
                <p className="text-slate-500 font-bold">No questions yet.</p>
                <p className="text-slate-400 text-sm mt-1">Add manually or import an Aiken-format file.</p>
              </div>
            )}

            {questions.map((q, idx) => (
              <div key={q.id} className="bg-white border border-slate-200 p-5 rounded-2xl shadow-sm relative group hover:border-slate-300 transition-colors">
                <button onClick={() => removeQuestion(q.id)} className="absolute top-3 right-3 text-slate-300 hover:text-red-500 transition-colors">
                  <Trash2 size={16} />
                </button>
                <div className="flex items-center gap-3 mb-4">
                  <span className="bg-blue-50 text-blue-600 border border-blue-100 font-black px-3 py-1 rounded-lg text-xs">Q{idx + 1}</span>
                  <input
                    type="text"
                    value={q.section}
                    onChange={(e) => updateQuestion(q.id, "section", e.target.value)}
                    className="bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 text-xs font-bold text-slate-600 outline-none focus:border-blue-400"
                    placeholder="Section Name"
                  />
                </div>
                <textarea
                  value={q.text}
                  onChange={(e) => updateQuestion(q.id, "text", e.target.value)}
                  placeholder="Type question here..."
                  rows="3"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm focus:border-blue-400 outline-none resize-none mb-3 font-semibold"
                />
                <div className="grid grid-cols-2 gap-2 mb-3">
                  {["A", "B", "C", "D"].map((opt) => (
                    <div key={opt} className="flex items-center gap-2">
                      <span className="text-xs font-black text-slate-400 w-4">{opt}.</span>
                      <input
                        type="text"
                        value={q[`opt${opt}`]}
                        onChange={(e) => updateQuestion(q.id, `opt${opt}`, e.target.value)}
                        className="w-full bg-slate-50 border border-slate-200 rounded-lg p-1.5 text-xs focus:border-blue-400 outline-none"
                      />
                    </div>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-slate-500 uppercase">Correct Answer:</span>
                  <select
                    value={q.ans}
                    onChange={(e) => updateQuestion(q.id, "ans", e.target.value)}
                    className="bg-emerald-50 text-emerald-700 border border-emerald-200 font-bold text-xs rounded-lg p-1 outline-none"
                  >
                    <option value="A">A</option>
                    <option value="B">B</option>
                    <option value="C">C</option>
                    <option value="D">D</option>
                  </select>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* CODING */}
        {activeTab === "coding" && (
          <CodingProblemBuilder problems={codingProblems} setProblems={setCodingProblems} />
        )}

        {/* SUBJECTIVE */}
        {activeTab === "subjective" && (
          <div className="space-y-4">
            <div className="flex justify-between items-center bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
              <h2 className="text-base font-black text-slate-800 flex items-center gap-2">
                <BookOpen size={18} className="text-blue-600" /> Subjective Questions
                <span className="text-xs font-bold bg-blue-50 text-blue-600 border border-blue-100 px-2 py-0.5 rounded-full">{subjectiveQuestions.length}</span>
              </h2>
              <div className="flex gap-2 items-center">
                <MarkdownZipImporter
                  onImport={handleMarkdownImport}
                  className="inline-flex"
                />
                <button
                  onClick={addSubjectiveQ}
                  className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-xl text-sm font-bold transition-all shadow-sm"
                >
                  <Plus size={15} /> Add Question
                </button>
              </div>
            </div>

            {subjectiveQuestions.length === 0 && (
              <div className="bg-white border-2 border-dashed border-slate-200 rounded-2xl p-16 text-center">
                <BookOpen size={32} className="text-slate-200 mx-auto mb-3" />
                <p className="text-slate-500 font-bold">No subjective questions yet.</p>
                <p className="text-slate-400 text-sm mt-1">Add open-ended questions for theory or written responses.</p>
              </div>
            )}

            {subjectiveQuestions.map((sq, idx) => (
              <div key={sq.id} className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-4 hover:border-slate-300 transition-colors">
                <div className="flex items-center justify-between">
                  <span className="bg-blue-50 text-blue-600 border border-blue-100 font-black px-3 py-1 rounded-lg text-xs">Q{idx + 1}</span>
                  <button onClick={() => removeSubjectiveQ(sq.id)} className="text-slate-300 hover:text-red-500 transition-colors text-sm font-bold flex items-center gap-1">
                    <Trash2 size={14} /> Remove
                  </button>
                </div>
                <div className="grid grid-cols-4 gap-4">
                  <div className="col-span-3">
                    <label className="text-xs font-bold text-slate-500 uppercase">Section</label>
                    <input
                      type="text"
                      value={sq.section}
                      onChange={(e) => updateSubjectiveQ(sq.id, "section", e.target.value)}
                      className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm mt-1 focus:border-blue-400 focus:ring-1 focus:ring-blue-400/20 outline-none bg-slate-50"
                      placeholder="e.g. Theory"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-slate-500 uppercase">Marks</label>
                    <input
                      type="number"
                      value={sq.marks}
                      onChange={(e) => updateSubjectiveQ(sq.id, "marks", parseInt(e.target.value) || 0)}
                      className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm mt-1 focus:border-blue-400 outline-none bg-slate-50 font-bold"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-500 uppercase">Question Text</label>
                  <textarea
                    value={sq.text}
                    onChange={(e) => updateSubjectiveQ(sq.id, "text", e.target.value)}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm mt-1 min-h-[100px] focus:border-blue-400 outline-none bg-slate-50 resize-none"
                    placeholder="Enter the subjective question text"
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Fixed bottom action bar */}
      <div className="fixed bottom-0 left-0 right-0 bg-white/90 backdrop-blur-md border-t border-slate-200 p-4 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex justify-between items-center">
          <p className="text-xs text-slate-400 font-bold hidden sm:block">
            {questions.length} MCQ · {codingProblems.length} Coding · {subjectiveQuestions.length} Subjective
          </p>
          <div className="flex gap-3 ml-auto">
            <button
              onClick={() => handlePublish("draft")}
              disabled={isSubmitting}
              className="flex items-center gap-2 px-6 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl transition-colors disabled:opacity-50"
            >
              <Save size={16} /> {initialData?.id ? "Update Draft" : "Save as Draft"}
            </button>
            <button
              onClick={() => handlePublish("upcoming")}
              disabled={isSubmitting}
              className="flex items-center gap-2 px-8 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl shadow-md transition-all disabled:opacity-50"
            >
              <Send size={16} /> Publish Exam
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}