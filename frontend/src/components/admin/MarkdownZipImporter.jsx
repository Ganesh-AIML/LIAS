/**
 * MarkdownZipImporter
 * Parses a .zip or single .md file into LIAS section/question objects.
 *
 * ZIP structure (recommended):
 *   sections/
 *     aptitude/
 *       questions.md
 *       images/
 *         fig1.png
 *     theory/
 *       questions.md
 *       images/
 *         cap-theorem.png
 *
 * OR a single loose .md file (no images).
 *
 * Returns:
 *   { sections: [SectionResult], errors: [ErrorEntry] }
 *
 * SectionResult: { meta, questions }
 *   meta: { section, type, marks_per_question }
 *   questions (MCQ): { text, optA, optB, optC, optD, ans, content_format, order_index }
 *   questions (Subjective): { text, marks, content_format, order_index }
 *
 * ErrorEntry: { location, message }
 */

import JSZip from 'jszip';
import React, { useRef, useState, lazy, Suspense } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_IMAGE_BYTES   = 2 * 1024 * 1024;   // 2 MB per image
const MAX_SECTION_BYTES = 5 * 1024 * 1024;   // 5 MB total assets per section
const VALID_FORMATS     = new Set(['plain', 'markdown']);
const VALID_TYPES       = new Set(['mcq', 'subjective']);
const OPTION_KEYS       = ['A', 'B', 'C', 'D'];

// ─── Frontmatter parser (no yaml dep) ─────────────────────────────────────────

function parseFrontmatter(raw) {
  const FM_RE = /^---\s*\r?\n([\s\S]*?)\r?\n---\s*(\r?\n|$)/;
  const match = FM_RE.exec(raw);
  if (!match) return { meta: {}, body: raw };

  const meta = {};
  for (const line of match[1].split(/\r?\n/)) {
    const colon = line.indexOf(':');
    if (colon < 1) continue;
    const key = line.slice(0, colon).trim();
    const val = line.slice(colon + 1).trim();
    // unquote if quoted
    meta[key] = /^["']/.test(val) ? val.slice(1, -1) : val;
  }

  const body = raw.slice(match[0].length);
  return { meta, body };
}

// ─── Image resolution (base64 inline) ─────────────────────────────────────────

async function buildImagesMap(zipFolder, sectionPath, errors) {
  const map = {};        // "filename.ext" → "data:image/png;base64,..."
  let totalBytes = 0;

  for (const [relPath, entry] of Object.entries(zipFolder)) {
    // only files inside images/ under this section
    const imagesPrefix = sectionPath ? `${sectionPath}images/` : 'images/';
    if (!relPath.startsWith(imagesPrefix) || entry.dir) continue;

    const filename = relPath.slice(imagesPrefix.length);
    if (!filename || filename.includes('/')) continue;  // nested — ignore

    const bytes = await entry.async('uint8array');
    if (bytes.length > MAX_IMAGE_BYTES) {
      errors.push({
        location: `Image: ${filename}`,
        message: `Exceeds 2 MB limit (${(bytes.length / 1024 / 1024).toFixed(1)} MB). Skipped.`,
      });
      continue;
    }
    totalBytes += bytes.length;
    if (totalBytes > MAX_SECTION_BYTES) {
      errors.push({
        location: `Section images`,
        message: 'Total image assets exceed 5 MB. Subsequent images skipped.',
      });
      break;
    }

    const ext   = filename.split('.').pop().toLowerCase();
    const mime  = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
                : ext === 'png'  ? 'image/png'
                : ext === 'gif'  ? 'image/gif'
                : ext === 'webp' ? 'image/webp'
                : ext === 'svg'  ? 'image/svg+xml'
                : 'application/octet-stream';

    // ── Chunked btoa: avoids "Maximum call stack size exceeded" on large images ──
    // String.fromCharCode(...largeArray) overflows the call stack for files >~64KB.
    // Process in 8KB chunks instead.
    const CHUNK = 8192;
    let binary = '';
    for (let i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    }
    const b64 = btoa(binary);
    map[filename] = `data:${mime};base64,${b64}`;
  }
  return map;
}

// Rewrite image refs: ![alt](images/x.png) → ![alt](data:...)
function inlineImages(text, imagesMap, questionLabel, errors) {
  return text.replace(/!\[([^\]]*)\]\(images\/([^)]+)\)/g, (_, alt, filename) => {
    if (imagesMap[filename]) {
      return `![${alt}](${imagesMap[filename]})`;
    }
    errors.push({
      location: questionLabel,
      message: `Missing image: "${filename}". Reference left broken.`,
    });
    return `![${alt} — image missing](images/${filename})`;
  });
}

// ─── MCQ block parser ──────────────────────────────────────────────────────────

function parseMcqBlock(rawBlock, imagesMap, questionLabel, errors) {
  const lines = rawBlock.split(/\r?\n/);
  const opts   = {};      // A, B, C, D → text
  let   answer = null;
  const bodyLines = [];

  for (const line of lines) {
    // Option line: "- A) Some text" or "- A) Some text" (any whitespace)
    const optMatch = /^-\s+([A-D])\)\s+(.+)$/.exec(line.trim());
    if (optMatch) {
      opts[optMatch[1]] = optMatch[2].trim();
      continue;
    }
    // Answer line
    const ansMatch = /^Answer:\s*([A-D])\s*$/i.exec(line.trim());
    if (ansMatch) {
      answer = ansMatch[1].toUpperCase();
      continue;
    }
    bodyLines.push(line);
  }

  // Validation
  for (const k of OPTION_KEYS) {
    if (!opts[k]) {
      errors.push({ location: questionLabel, message: `Missing option ${k}.` });
    }
  }
  if (!answer) {
    errors.push({ location: questionLabel, message: 'Missing or invalid Answer line.' });
  }

  const text = inlineImages(bodyLines.join('\n').trim(), imagesMap, questionLabel, errors);

  return {
    text,
    optA: opts['A'] || '',
    optB: opts['B'] || '',
    optC: opts['C'] || '',
    optD: opts['D'] || '',
    ans:  answer     || '',
    content_format: 'markdown',
  };
}

// ─── Subjective block parser ───────────────────────────────────────────────────

function parseSubjectiveBlock(rawBlock, imagesMap, questionLabel, errors) {
  const text = inlineImages(rawBlock.trim(), imagesMap, questionLabel, errors);
  if (!text) {
    errors.push({ location: questionLabel, message: 'Question body is empty.' });
  }
  return { text, content_format: 'markdown' };
}

// ─── Section file parser ───────────────────────────────────────────────────────

function parseMarkdownSection(rawText, imagesMap, errors) {
  const { meta, body } = parseFrontmatter(rawText);

  // Meta validation
  const sectionName = meta.section || 'Unnamed Section';
  const type        = (meta.type || 'mcq').toLowerCase();
  const marksRaw    = parseInt(meta.marks_per_question, 10);
  const marks_per_question = Number.isFinite(marksRaw) && marksRaw > 0 ? marksRaw : 1;

  if (!VALID_TYPES.has(type)) {
    errors.push({
      location: `Section "${sectionName}" frontmatter`,
      message: `Invalid type "${meta.type}". Must be mcq or subjective. Defaulting to mcq.`,
    });
  }

  // Split into question blocks by "## Q<n>" headings
  const Q_SPLIT_RE = /^##\s+Q\d+\s*$/gim;
  const parts      = body.split(Q_SPLIT_RE).map(s => s.trim()).filter(Boolean);

  if (parts.length === 0) {
    errors.push({
      location: `Section "${sectionName}"`,
      message: 'No questions found. Expected "## Q1", "## Q2", ... headings.',
    });
  }

  const questions = [];
  parts.forEach((block, idx) => {
    const questionLabel = `Section "${sectionName}", Q${idx + 1}`;
    let parsed;
    if (type === 'subjective') {
      parsed = parseSubjectiveBlock(block, imagesMap, questionLabel, errors);
      parsed.marks = marks_per_question;
    } else {
      parsed = parseMcqBlock(block, imagesMap, questionLabel, errors);
    }
    parsed.order_index = idx;
    parsed.section     = sectionName;  // legacy free-text field (backward compat)
    questions.push(parsed);
  });

  return {
    meta: { section: sectionName, type, marks_per_question },
    questions,
  };
}

// ─── Top-level: parse ZIP or single .md ───────────────────────────────────────

export async function parseMarkdownZip(file) {
  const errors   = [];
  const sections = [];

  const name = file.name || '';

  if (name.endsWith('.md') || name.endsWith('.markdown')) {
    // Single loose .md — no images
    const text    = await file.text();
    const result  = parseMarkdownSection(text, {}, errors);
    sections.push(result);
    return { sections, errors };
  }

  if (!name.endsWith('.zip')) {
    errors.push({ location: 'File', message: 'Must be a .zip or .md file.' });
    return { sections, errors };
  }

  let zip;
  try {
    zip = await JSZip.loadAsync(file);
  } catch (e) {
    errors.push({ location: 'ZIP', message: `Could not open ZIP: ${e.message}` });
    return { sections, errors };
  }

  // Discover structure: find all .md files
  // Supported layouts:
  //   A) sections/<folder>/questions.md  → folder per section (recommended)
  //   B) <folder>/questions.md           → folder per section (flat)
  //   C) *.md at root                    → one section per root .md file

  const allFiles = Object.keys(zip.files);

  // Group .md files by their parent folder path
  const mdFiles = allFiles.filter(p => !zip.files[p].dir && /\.md$/i.test(p));

  if (mdFiles.length === 0) {
    errors.push({ location: 'ZIP', message: 'No .md files found inside ZIP.' });
    return { sections, errors };
  }

  // Sort for deterministic ordering (alphabetical by path)
  mdFiles.sort();

  for (const mdPath of mdFiles) {
    // Derive the section's base path (folder containing the .md)
    const lastSlash = mdPath.lastIndexOf('/');
    const sectionPath = lastSlash >= 0 ? mdPath.slice(0, lastSlash + 1) : '';

    // Build images map for this section folder
    const imagesMap = await buildImagesMap(zip.files, sectionPath, errors);

    const text   = await zip.files[mdPath].async('string');
    const result = parseMarkdownSection(text, imagesMap, errors);
    sections.push(result);
  }

  return { sections, errors };
}

// ─── Preview Modal ─────────────────────────────────────────────────────────────

const OPTION_LABELS = ['A', 'B', 'C', 'D'];

function PreviewModal({ sections, onClose, onConfirm }) {
  const [sectionIdx, setSectionIdx] = useState(0);
  const [qIdx, setQIdx]             = useState(0);
  const [selected, setSelected]     = useState({});   // "sIdx-qIdx" → option

  const sec = sections[sectionIdx];
  const q   = sec?.questions[qIdx];
  const totalQ = sections.reduce((n, s) => n + s.questions.length, 0);

  function goQ(delta) {
    const newQ = qIdx + delta;
    if (newQ >= 0 && newQ < sec.questions.length) {
      setQIdx(newQ);
    } else if (delta > 0 && sectionIdx < sections.length - 1) {
      setSectionIdx(sectionIdx + 1);
      setQIdx(0);
    } else if (delta < 0 && sectionIdx > 0) {
      setSectionIdx(sectionIdx - 1);
      setQIdx(sections[sectionIdx - 1].questions.length - 1);
    }
  }

  // Global flat index for display
  let globalIdx = 0;
  for (let s = 0; s < sectionIdx; s++) globalIdx += sections[s].questions.length;
  globalIdx += qIdx;

  if (!q) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50">
          <div>
            <h2 className="font-black text-slate-900 text-lg">Import Preview — Student POV</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {totalQ} question{totalQ !== 1 ? 's' : ''} across {sections.length} section{sections.length !== 1 ? 's' : ''} · Review before confirming import
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-2xl font-bold leading-none">×</button>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* Left sidebar — section/question palette */}
          <div className="w-56 border-r border-slate-200 bg-slate-50 p-4 overflow-y-auto flex-shrink-0">
            {sections.map((s, si) => (
              <div key={si} className="mb-4">
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 truncate" title={s.meta.section}>
                  {s.meta.section}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {s.questions.map((_, qi) => {
                    const key = `${si}-${qi}`;
                    const isActive = si === sectionIdx && qi === qIdx;
                    const isAnswered = s.meta.type === 'mcq' && !!selected[key];
                    return (
                      <button
                        key={qi}
                        onClick={() => { setSectionIdx(si); setQIdx(qi); }}
                        className={`w-8 h-8 rounded-lg text-xs font-bold border-2 transition-all ${
                          isActive
                            ? 'border-blue-700 bg-blue-600 text-white scale-110 shadow'
                            : isAnswered
                            ? 'border-emerald-500 bg-emerald-500 text-white'
                            : 'border-slate-200 bg-white text-slate-500 hover:border-blue-300'
                        }`}
                      >
                        {qi + 1}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          {/* Main question area */}
          <div className="flex-1 overflow-y-auto p-6">
            {/* Section + question header */}
            <div className="flex items-center gap-3 mb-5">
              <span className="bg-blue-900 text-white font-black px-3 py-1 rounded-lg text-sm">
                Q{globalIdx + 1}
              </span>
              <span className="text-sm font-semibold text-slate-500">{sec.meta.section}</span>
              <span className="ml-auto text-xs font-bold text-slate-400 bg-slate-100 px-2 py-1 rounded-lg">
                {sec.meta.type === 'mcq' ? `${sec.meta.marks_per_question} mark${sec.meta.marks_per_question !== 1 ? 's' : ''}` : `${q.marks} marks`}
              </span>
            </div>

            {/* Question text — rendered exactly as student sees it */}
            <div className="text-base font-medium text-slate-900 mb-6 leading-relaxed">
              <ReactMarkdown
                remarkPlugins={[remarkGfm, remarkMath]}
                rehypePlugins={[rehypeKatex]}
                components={{
                  img: ({ src, alt }) => (
                    <img src={src} alt={alt || ''} loading="lazy"
                      className="max-w-full h-auto rounded my-2 border border-gray-200" />
                  ),
                  table: ({ children }) => (
                    <div className="overflow-x-auto my-2">
                      <table className="min-w-full border-collapse border border-gray-300 text-sm">{children}</table>
                    </div>
                  ),
                  th: ({ children }) => <th className="border border-gray-300 bg-gray-50 px-3 py-1.5 text-left font-semibold">{children}</th>,
                  td: ({ children }) => <td className="border border-gray-300 px-3 py-1.5">{children}</td>,
                  pre: ({ children }) => <pre className="bg-gray-900 text-gray-100 rounded p-3 overflow-x-auto text-sm my-2">{children}</pre>,
                  code: ({ inline, children }) => inline
                    ? <code className="bg-gray-100 text-gray-800 rounded px-1 py-0.5 text-sm font-mono">{children}</code>
                    : <code>{children}</code>,
                }}
              >
                {q.text}
              </ReactMarkdown>
            </div>

            {/* MCQ options */}
            {sec.meta.type === 'mcq' && (
              <div className="grid grid-cols-1 gap-3">
                {OPTION_LABELS.map((label, oi) => {
                  const optText = q[`opt${label}`] || '';
                  if (!optText) return null;
                  const key = `${sectionIdx}-${qIdx}`;
                  const isSelected = selected[key] === label;
                  return (
                    <button
                      key={label}
                      onClick={() => setSelected(prev => ({ ...prev, [key]: label }))}
                      className={`text-left p-4 rounded-xl border-2 flex items-start gap-4 transition-all ${
                        isSelected
                          ? 'border-blue-600 bg-blue-50 text-blue-900 shadow-sm'
                          : 'border-slate-200 bg-white text-slate-700 hover:border-blue-300'
                      }`}
                    >
                      <span className={`w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-lg font-bold text-sm ${
                        isSelected ? 'bg-blue-700 text-white' : 'bg-slate-100 text-slate-500'
                      }`}>{label}</span>
                      <span className="text-sm font-medium leading-relaxed pt-1">{optText}</span>
                    </button>
                  );
                })}
              </div>
            )}

            {/* Subjective placeholder */}
            {sec.meta.type === 'subjective' && (
              <div className="mt-4 border-2 border-dashed border-slate-200 rounded-xl p-6 text-center text-slate-400">
                <p className="text-sm font-medium">Student writes answer here using the rich text editor</p>
                <p className="text-xs mt-1">(Math input, formatting tools available in live exam)</p>
              </div>
            )}
          </div>
        </div>

        {/* Footer nav + confirm */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-200 bg-slate-50">
          <button
            onClick={() => goQ(-1)}
            disabled={sectionIdx === 0 && qIdx === 0}
            className="px-4 py-2 rounded-lg border border-slate-200 bg-white text-slate-700 font-bold text-sm disabled:opacity-40 hover:bg-slate-100 transition-colors"
          >
            ← Previous
          </button>
          <span className="text-xs text-slate-500 font-medium">
            Question {globalIdx + 1} of {totalQ}
          </span>
          {globalIdx < totalQ - 1 ? (
            <button
              onClick={() => goQ(1)}
              className="px-4 py-2 rounded-lg bg-blue-900 hover:bg-blue-800 text-white font-bold text-sm transition-colors"
            >
              Next →
            </button>
          ) : (
            <button
              onClick={onConfirm}
              className="px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm transition-colors"
            >
              ✓ Confirm Import
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── React Component ───────────────────────────────────────────────────────────

export default function MarkdownZipImporter({ onImport, className = '' }) {
  const inputRef                   = useRef(null);
  const [status, setStatus]        = useState(null);
  const [summary, setSummary]      = useState(null);
  const [preview, setPreview]      = useState(null);   // { sections, errors } waiting for confirm
  const [showPreview, setShowPreview] = useState(false);

  async function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    setStatus('parsing');
    setSummary(null);
    setPreview(null);

    try {
      const result = await parseMarkdownZip(file);
      const totalQ = result.sections.reduce((n, s) => n + s.questions.length, 0);
      setSummary({
        sections: result.sections.length,
        questions: totalQ,
        errors: result.errors,
      });
      setStatus('preview-ready');
      setPreview(result);
      setShowPreview(true);   // open preview immediately
    } catch (err) {
      setSummary({ errors: [{ location: 'Parser', message: err.message }] });
      setStatus('error');
    }
  }

  function handleConfirm() {
    setShowPreview(false);
    setStatus('done');
    onImport(preview);
  }

  function handleClose() {
    setShowPreview(false);
    setStatus(null);
    setSummary(null);
    setPreview(null);
  }

  return (
    <>
      {showPreview && preview && (
        <PreviewModal
          sections={preview.sections}
          onClose={handleClose}
          onConfirm={handleConfirm}
        />
      )}

      <div className={`flex flex-col gap-2 ${className}`}>
        <input
          ref={inputRef}
          type="file"
          accept=".zip,.md,.markdown"
          className="hidden"
          onChange={handleFile}
        />

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={status === 'parsing'}
            className="px-3 py-1.5 text-sm font-medium rounded border border-dashed
                       border-indigo-400 text-indigo-600 hover:bg-indigo-50
                       disabled:opacity-50 disabled:cursor-wait transition-colors"
          >
            {status === 'parsing' ? 'Parsing…' : '⬆ Import Markdown (.zip / .md)'}
          </button>

          {status === 'done' && preview && (
            <button
              type="button"
              onClick={() => setShowPreview(true)}
              className="px-3 py-1.5 text-sm font-medium rounded border border-slate-300
                         text-slate-600 hover:bg-slate-50 transition-colors"
            >
              👁 Preview
            </button>
          )}
        </div>

        {summary && status !== 'preview-ready' && (
          <div className={`text-xs rounded p-2 ${
            summary.errors.length > 0
              ? 'bg-yellow-50 border border-yellow-200 text-yellow-800'
              : 'bg-green-50 border border-green-200 text-green-800'
          }`}>
            {status === 'done' && (
              <p className="font-semibold mb-1">
                ✓ Imported {summary.questions} question{summary.questions !== 1 ? 's' : ''} across {summary.sections} section{summary.sections !== 1 ? 's' : ''}.
              </p>
            )}
            {summary.errors.length > 0 && (
              <>
                <p className="font-semibold text-yellow-900 mb-1">
                  {summary.errors.length} warning{summary.errors.length !== 1 ? 's' : ''}:
                </p>
                <ul className="list-disc list-inside space-y-0.5">
                  {summary.errors.map((e, i) => (
                    <li key={i}>
                      <span className="font-medium">{e.location}:</span> {e.message}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
      </div>
    </>
  );
}