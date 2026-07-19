/**
 * TexZipImporter
 * SOLE import path for LIAS question banks (Task 2 — single-format migration).
 *
 * Required ZIP shape:
 *   exam.zip
 *   ├── questions.tex   (exactly one .tex file, anywhere in the zip)
 *   └── images/         (optional — flat, referenced via \includegraphics)
 *
 * questions.tex format — one or more sections, each opened by:
 *   \metasection{Section Name}{mcq|subjective|coding}{marks_per_question}
 * followed by \begin{question}...\end{question} blocks (mcq/subjective)
 * or \begin{codingquestion}...\end{codingquestion} blocks (coding).
 *
 * MCQ question body:
 *   \begin{question}
 *   Question text, may include $inline math$ and \includegraphics{images/x.png}
 *   \begin{choices}
 *   \choice A: option text
 *   \choice B: option text
 *   \choice C: option text
 *   \choice D: option text
 *   \end{choices}
 *   \answer{B}
 *   \end{question}
 *
 * Subjective question body: same \begin{question}...\end{question}, no choices/answer.
 *
 * Coding question body:
 *   \begin{codingquestion}
 *   \title{Two Sum}
 *   \description{...}
 *   \constraints{...}
 *   \testcase{stdin}{stdout}
 *   \testcase[hidden]{stdin}{stdout}
 *   \end{codingquestion}
 *
 * Formatting commands (\textbf \textit \underline, itemize/enumerate) are converted
 * to Markdown. Math ($...$, $$...$$, \(...\), \[...\]) is left as LaTeX — only the
 * \(\) \[\] delimiters are normalized to $ $$ so remark-math + KaTeX (existing
 * renderer, untouched) picks it up. Output shape is unchanged from the previous
 * importer so downstream code (ScheduleTest state, /admin/exams payload, question
 * model) needs no changes:
 *
 *   { sections: [{ meta: {section,type,marks_per_question}, questions: [...] }],
 *     codingProblems: [{ id, title, description, constraints, languages, testCases }],
 *     errors: [{ location, message }] }
 */

import JSZip from 'jszip';
import React, { useRef, useState } from 'react';
import { normalizeMath } from '../../utils/normalizeMath';

const MAX_IMAGE_BYTES   = 2 * 1024 * 1024;   // 2 MB per image
const MAX_TOTAL_BYTES   = 8 * 1024 * 1024;   // 8 MB total image assets
const MAX_TEX_BYTES     = 4 * 1024 * 1024;   // 4 MB guard on the .tex source itself
const VALID_TYPES       = new Set(['mcq', 'subjective', 'coding']);
const OPTION_KEYS        = ['A', 'B', 'C', 'D'];

const genMcqId = () => `mcq_${Math.random().toString(36).slice(2, 11)}`;
const genCpId  = () => `cp_${Math.random().toString(36).slice(2, 11)}`;
const genTcId  = () => `tc_${Math.random().toString(36).slice(2, 11)}`;

// ─── ZIP discovery & validation ─────────────────────────────────────────────

function isPathTraversal(path) {
  // Reject absolute paths and any segment that walks upward.
  if (path.startsWith('/') || /^[a-zA-Z]:/.test(path)) return true;
  return path.split('/').some(seg => seg === '..');
}

async function locateTexAndImages(zip, errors) {
  const allPaths = Object.keys(zip.files).filter(p => !zip.files[p].dir);

  for (const p of allPaths) {
    if (isPathTraversal(p)) {
      errors.push({ location: 'ZIP', message: `Unsafe path rejected: "${p}".` });
    }
  }
  const safePaths = allPaths.filter(p => !isPathTraversal(p));

  const texPaths = safePaths.filter(p => /\.tex$/i.test(p));
  if (texPaths.length === 0) {
    errors.push({ location: 'ZIP', message: 'No questions.tex found inside ZIP.' });
    return null;
  }
  if (texPaths.length > 1) {
    errors.push({ location: 'ZIP', message: `Multiple .tex files found (${texPaths.join(', ')}). Exactly one is required.` });
    return null;
  }

  const texPath = texPaths[0];
  const texEntry = zip.files[texPath];

  let texText;
  try {
    texText = await texEntry.async('string');
  } catch (e) {
    errors.push({ location: texPath, message: `Could not read TEX source: ${e.message}` });
    return null;
  }
  if (texText.length > MAX_TEX_BYTES) {
    errors.push({ location: texPath, message: `File too large (${(texText.length / 1024 / 1024).toFixed(1)} MB). Limit 4 MB.` });
    return null;
  }

  // images/<filename> only — one level deep, matching the original importer's contract.
  const imagesMap = {};
  let totalBytes = 0;
  const seen = new Set();
  for (const p of safePaths) {
    const m = /^(?:.*\/)?images\/([^/]+)$/i.exec(p);
    if (!m) continue;
    const filename = m[1];

    if (seen.has(filename)) {
      errors.push({ location: `Image: ${filename}`, message: 'Duplicate image filename — using last occurrence.' });
    }
    seen.add(filename);

    const entry = zip.files[p];
    let bytes;
    try {
      bytes = await entry.async('uint8array');
    } catch (e) {
      errors.push({ location: `Image: ${filename}`, message: `Could not read: ${e.message}` });
      continue;
    }
    if (bytes.length > MAX_IMAGE_BYTES) {
      errors.push({ location: `Image: ${filename}`, message: `Exceeds 2 MB limit (${(bytes.length / 1024 / 1024).toFixed(1)} MB). Skipped.` });
      continue;
    }
    totalBytes += bytes.length;
    if (totalBytes > MAX_TOTAL_BYTES) {
      errors.push({ location: 'images/', message: 'Total image assets exceed 8 MB. Subsequent images skipped.' });
      break;
    }

    const ext  = filename.split('.').pop().toLowerCase();
    const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
               : ext === 'png'  ? 'image/png'
               : ext === 'gif'  ? 'image/gif'
               : ext === 'webp' ? 'image/webp'
               : ext === 'svg'  ? 'image/svg+xml'
               : 'application/octet-stream';

    // Chunked btoa — avoids call-stack overflow on large images (>~64KB).
    const CHUNK = 8192;
    let binary = '';
    for (let i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    }
    imagesMap[filename] = `data:${mime};base64,${btoa(binary)}`;
  }

  return { texText, imagesMap };
}

// ─── Brace-balanced argument extraction ─────────────────────────────────────
// TEX arguments can contain nested braces ("\textbf{a {b} c}"), so a simple
// regex can't reliably find the closing brace. Walk char-by-char instead.

function readBracedArg(src, start) {
  // src[start] must be '{'. Returns { value, next } where next is index after '}'.
  if (src[start] !== '{') return null;
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    if (src[i] === '\\' && src[i + 1] === '{') { i++; continue; } // escaped brace
    if (src[i] === '\\' && src[i + 1] === '}') { i++; continue; }
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return { value: src.slice(start + 1, i), next: i + 1 };
    }
  }
  return null; // unbalanced
}

function findEnv(src, envName, fromIndex, errors) {
  // Locate the next \begin{envName} ... \end{envName} pair from fromIndex,
  // honoring nested \begin{envName} of the SAME name (not expected here, but safe).
  const beginTag = `\\begin{${envName}}`;
  const endTag   = `\\end{${envName}}`;
  const start = src.indexOf(beginTag, fromIndex);
  if (start === -1) return null;

  let depth = 1;
  let cursor = start + beginTag.length;
  while (depth > 0) {
    const nextBegin = src.indexOf(beginTag, cursor);
    const nextEnd   = src.indexOf(endTag, cursor);
    if (nextEnd === -1) {
      errors.push({ location: envName, message: `Unclosed \\begin{${envName}} — missing \\end{${envName}}.` });
      return null;
    }
    if (nextBegin !== -1 && nextBegin < nextEnd) {
      depth++;
      cursor = nextBegin + beginTag.length;
    } else {
      depth--;
      cursor = nextEnd + endTag.length;
    }
  }
  const bodyStart = start + beginTag.length;
  const bodyEnd   = cursor - endTag.length;
  return { body: src.slice(bodyStart, bodyEnd), matchStart: start, matchEnd: cursor };
}

function findAllEnvs(src, envName, errors) {
  const results = [];
  let idx = 0;
  while (true) {
    const found = findEnv(src, envName, idx, errors);
    if (!found) break;
    results.push(found.body);
    idx = found.matchEnd;
  }
  return results;
}

// ─── Formatting: TEX → Markdown (math left untouched) ───────────────────────

function convertFormatting(text) {
  let out = text;

  // Normalize math delimiters to what remark-math expects; interior stays LaTeX.
  out = out.replace(/\\\[([\s\S]*?)\\\]/g, (_, inner) => `$$${inner}$$`);
  out = out.replace(/\\\(([\s\S]*?)\\\)/g, (_, inner) => `$${inner}$`);

  // Protect math spans from formatting conversion below by stashing them.
  const stashed = [];
  out = out.replace(/\$\$[\s\S]*?\$\$|\$[^$\n]*\$/g, (m) => {
    stashed.push(m);
    return `\u0000MATH${stashed.length - 1}\u0000`;
  });

  // Simple inline commands: \textbf{x} \textit{x} \underline{x} \emph{x}
  const inlineCmd = (out, cmd, wrap) => {
    let result = '';
    let i = 0;
    const tag = `\\${cmd}{`;
    while (i < out.length) {
      const pos = out.indexOf(tag, i);
      if (pos === -1) { result += out.slice(i); break; }
      result += out.slice(i, pos);
      const arg = readBracedArg(out, pos + cmd.length + 1);
      if (!arg) { result += out.slice(pos, pos + tag.length); i = pos + tag.length; continue; }
      result += wrap(convertFormatting(arg.value));
      i = arg.next;
    }
    return result;
  };
  out = inlineCmd(out, 'textbf', s => `**${s}**`);
  out = inlineCmd(out, 'textit', s => `*${s}*`);
  out = inlineCmd(out, 'emph', s => `*${s}*`);
  out = inlineCmd(out, 'underline', s => `__${s}__`);
  out = inlineCmd(out, 'boldsymbol', s => `**${s}**`);
  out = inlineCmd(out, 'mathrm', s => s);
  out = out.replace(/\\pounds/g, '£');

  // itemize / enumerate → markdown lists (\item per line)
  out = out.replace(/\\begin\{itemize\}([\s\S]*?)\\end\{itemize\}/g, (_, body) =>
    body.split('\\item').slice(1).map(s => `- ${s.trim()}`).join('\n'));
  out = out.replace(/\\begin\{enumerate\}([\s\S]*?)\\end\{enumerate\}/g, (_, body) =>
    body.split('\\item').slice(1).map((s, i) => `${i + 1}. ${s.trim()}`).join('\n'));

  // Restore math
  out = out.replace(/\u0000MATH(\d+)\u0000/g, (_, i) => stashed[Number(i)]);

  return out.trim();
}

function resolveImages(text, imagesMap, questionLabel, errors) {
  return text.replace(/\\includegraphics(?:\[[^\]]*\])?\{([^}]+)\}/g, (_, rawPath) => {
    const filename = rawPath.trim().split('/').pop();
    if (imagesMap[filename]) {
      return `![${filename}](${imagesMap[filename]})`;
    }
    errors.push({ location: questionLabel, message: `Missing image: "${rawPath}". Reference left broken.` });
    return `![missing: ${filename}]()`;
  });
}

// ─── TABLE CONVERSION (tabular → GFM pipe table) ───────────────────────────

function convertTableToGFM(body) {
  let out = body
    .replace(/\\toprule\s*/g, '')
    .replace(/\\midrule\s*/g, '')
    .replace(/\\bottomrule\s*/g, '')
    .replace(/\\hline\s*/g, '');

  const rows = out.split(/\\\\/).map(r => r.trim()).filter(r => r.length > 0);
  if (rows.length === 0) return '';

  const gfmRows = [];
  for (let i = 0; i < rows.length; i++) {
    const cells = rows[i].split('&').map(c => {
      let cell = c.trim();
      cell = convertFormatting(cell);
      return cell;
    });
    if (i === 0) {
      gfmRows.push('| ' + cells.join(' | ') + ' |');
      gfmRows.push('| ' + cells.map(() => '---').join(' | ') + ' |');
    } else {
      gfmRows.push('| ' + cells.join(' | ') + ' |');
    }
  }
  return '\n\n' + gfmRows.join('\n') + '\n\n';
}

// ─── PRE-PROCESSOR: strip/replace block environments before formatting ──────

function preprocessLaTeX(text, errors) {
  let out = text;

  // 1. Strip \begin{center}...\end{center} — keep content
  let result = '';
  let idx = 0;
  while (true) {
    const found = findEnv(out, 'center', idx, errors);
    if (!found) break;
    result += out.slice(idx, found.matchStart);
    result += found.body;
    idx = found.matchEnd;
  }
  result += out.slice(idx);
  out = result;

  // 2. Replace \begin{tikzpicture}...\end{tikzpicture} with placeholder
  result = '';
  idx = 0;
  while (true) {
    const found = findEnv(out, 'tikzpicture', idx, errors);
    if (!found) break;
    result += out.slice(idx, found.matchStart);
    result += '\n*[Diagram: see printed question paper]*\n';
    idx = found.matchEnd;
  }
  result += out.slice(idx);
  out = result;

  // 3. Convert \begin{tabular}...\end{tabular} to GFM table
  result = '';
  idx = 0;
  while (true) {
    const found = findEnv(out, 'tabular', idx, errors);
    if (!found) break;
    result += out.slice(idx, found.matchStart);
    result += convertTableToGFM(found.body);
    idx = found.matchEnd;
  }
  result += out.slice(idx);
  out = result;

  return out;
}

// ─── Question parsing ────────────────────────────────────────────────────────

function parseQuestionBody(rawBody, type, imagesMap, questionLabel, errors) {
  const choicesEnv = findEnv(rawBody, 'choices', 0, errors);
  let mainText = choicesEnv ? rawBody.slice(0, choicesEnv.matchStart) : rawBody;

  // \answer{X} may sit outside \choices — strip it from the main text either way.
  let answer = null;
  mainText = mainText.replace(/\\answer\{([A-Da-d])\}/, (_, a) => { answer = a.toUpperCase(); return ''; });

  const text = normalizeMath(convertFormatting(preprocessLaTeX(resolveImages(mainText, imagesMap, questionLabel, errors), errors)));

  if (type === 'subjective') {
    if (!text) errors.push({ location: questionLabel, message: 'Question body is empty.' });
    return { text, content_format: 'markdown' };
  }

  // MCQ
  if (!choicesEnv) {
    errors.push({ location: questionLabel, message: 'Missing \\begin{choices}...\\end{choices} block.' });
  }
  const opts = {};
  if (choicesEnv) {
    const choiceRe = /\\choice\s+([A-Da-d])\s*[:)]\s*([\s\S]*?)(?=\\choice\s+[A-Da-d]\s*[:)]|$)/g;
    let m;
    while ((m = choiceRe.exec(choicesEnv.body)) !== null) {
      opts[m[1].toUpperCase()] = normalizeMath(convertFormatting(preprocessLaTeX(resolveImages(m[2].trim(), imagesMap, questionLabel, errors), errors)));
    }
    // \answer{X} sometimes placed inside \choices
    const inChoiceAns = /\\answer\{([A-Da-d])\}/.exec(choicesEnv.body);
    if (inChoiceAns) answer = inChoiceAns[1].toUpperCase();
  }
  for (const k of OPTION_KEYS) {
    if (!opts[k]) errors.push({ location: questionLabel, message: `Missing option ${k}.` });
  }
  if (!answer) errors.push({ location: questionLabel, message: 'Missing or invalid \\answer{}.' });

  return {
    text,
    optA: opts.A || '', optB: opts.B || '', optC: opts.C || '', optD: opts.D || '',
    ans: answer || '',
    content_format: 'markdown',
  };
}

function parseCodingBody(rawBody, imagesMap, label, errors) {
  const titleMatch = /\\title\{/.exec(rawBody);
  let title = '';
  if (titleMatch) {
    const arg = readBracedArg(rawBody, titleMatch.index + 6);
    if (arg) title = convertFormatting(arg.value).trim();
  }
  if (!title) errors.push({ location: label, message: 'Missing \\title{}.' });

  const descMatch = /\\description\{/.exec(rawBody);
  let description = '';
  if (descMatch) {
    const arg = readBracedArg(rawBody, descMatch.index + 12);
    if (arg) description = normalizeMath(convertFormatting(resolveImages(arg.value, imagesMap, label, errors))).trim();
  }
  if (!description) errors.push({ location: label, message: 'Missing \\description{}.' });

  const consMatch = /\\constraints\{/.exec(rawBody);
  let constraints = '';
  if (consMatch) {
    const arg = readBracedArg(rawBody, consMatch.index + 13);
    if (arg) constraints = convertFormatting(arg.value).trim();
  }

  const testCases = [];
  const tcRe = /\\testcase(?:\[([^\]]*)\])?\{/g;
  let m;
  while ((m = tcRe.exec(rawBody)) !== null) {
    const isHidden = (m[1] || '').trim().toLowerCase() === 'hidden';
    const inputArg = readBracedArg(rawBody, m.index + m[0].length - 1);
    if (!inputArg) { errors.push({ location: label, message: 'Malformed \\testcase{} — missing input braces.' }); continue; }
    const outputArg = readBracedArg(rawBody, inputArg.next);
    if (!outputArg) { errors.push({ location: label, message: 'Malformed \\testcase{} — missing output braces.' }); continue; }
    testCases.push({ id: genTcId(), input: inputArg.value.trim(), output: outputArg.value.trim(), isHidden });
    tcRe.lastIndex = outputArg.next;
  }
  if (testCases.length === 0) {
    errors.push({ location: label, message: 'No \\testcase{} entries found.' });
  }

  return {
    id: genCpId(),
    title: title || 'Untitled Problem',
    description,
    constraints,
    languages: '71,54,62,50', // same default as manual "Add Problem" in CodingProblemBuilder
    testCases,
  };
}

// ─── Section parsing ─────────────────────────────────────────────────────────

function parseSections(texText, imagesMap, errors) {
  const sections = [];
  const codingProblems = [];

  const metaRe = /\\metasection\{/g;
  const boundaries = [];
  let m;
  while ((m = metaRe.exec(texText)) !== null) {
    const nameArg = readBracedArg(texText, m.index + '\\metasection'.length);
    if (!nameArg) { errors.push({ location: 'Document', message: 'Malformed \\metasection{} — missing braces.' }); continue; }
    const typeArg = readBracedArg(texText, nameArg.next);
    if (!typeArg) { errors.push({ location: 'Document', message: 'Malformed \\metasection{} — missing type argument.' }); continue; }
    const marksArg = readBracedArg(texText, typeArg.next);
    boundaries.push({
      name: nameArg.value.trim(),
      type: typeArg.value.trim().toLowerCase(),
      marksRaw: marksArg ? marksArg.value.trim() : '',
      bodyStart: marksArg ? marksArg.next : typeArg.next,
    });
  }

  if (boundaries.length === 0) {
    errors.push({ location: 'Document', message: 'No \\metasection{} found. Expected at least one section.' });
    return { sections, codingProblems };
  }

  for (let i = 0; i < boundaries.length; i++) {
    const b = boundaries[i];
    const bodyEnd = i + 1 < boundaries.length
      ? texText.indexOf('\\metasection{', boundaries[i].bodyStart)
      : texText.length;
    const sectionBody = texText.slice(b.bodyStart, bodyEnd === -1 ? texText.length : bodyEnd);

    const sectionName = b.name || 'Unnamed Section';
    let type = b.type;
    if (!VALID_TYPES.has(type)) {
      errors.push({ location: `Section "${sectionName}"`, message: `Invalid type "${b.type}". Must be mcq, subjective, or coding. Defaulting to mcq.` });
      type = 'mcq';
    }
    const marksRaw = parseInt(b.marksRaw, 10);
    const marks_per_question = Number.isFinite(marksRaw) && marksRaw > 0 ? marksRaw : 1;

    if (type === 'coding') {
      const bodies = findAllEnvs(sectionBody, 'codingquestion', errors);
      if (bodies.length === 0) {
        errors.push({ location: `Section "${sectionName}"`, message: 'No \\begin{codingquestion} blocks found.' });
      }
      bodies.forEach((body, idx) => {
        const label = `Section "${sectionName}", Problem ${idx + 1}`;
        codingProblems.push(parseCodingBody(body, imagesMap, label, errors));
      });
      continue;
    }

    const bodies = findAllEnvs(sectionBody, 'question', errors);
    if (bodies.length === 0) {
      errors.push({ location: `Section "${sectionName}"`, message: 'No \\begin{question} blocks found.' });
    }
    const questions = bodies.map((body, idx) => {
      const label = `Section "${sectionName}", Q${idx + 1}`;
      const parsed = parseQuestionBody(body, type, imagesMap, label, errors);
      parsed.order_index = idx;
      parsed.section = sectionName;
      if (type === 'subjective') parsed.marks = marks_per_question;
      return parsed;
    });

    sections.push({ meta: { section: sectionName, type, marks_per_question }, questions });
  }

  return { sections, codingProblems };
}

// ─── Top-level entry ─────────────────────────────────────────────────────────

export async function parseTexZip(file) {
  const errors = [];
  const name = file.name || '';

  if (!name.toLowerCase().endsWith('.zip')) {
    errors.push({ location: 'File', message: 'Must be a .zip file containing questions.tex.' });
    return { sections: [], codingProblems: [], errors };
  }

  let zip;
  try {
    zip = await JSZip.loadAsync(file);
  } catch (e) {
    errors.push({ location: 'ZIP', message: `Could not open ZIP — file may be corrupted or malformed: ${e.message}` });
    return { sections: [], codingProblems: [], errors };
  }

  const located = await locateTexAndImages(zip, errors);
  if (!located) {
    return { sections: [], codingProblems: [], errors };
  }

  try {
    const { sections, codingProblems } = parseSections(located.texText, located.imagesMap, errors);
    return { sections, codingProblems, errors };
  } catch (e) {
    errors.push({ location: 'Parser', message: `Unexpected error while parsing TEX: ${e.message}` });
    return { sections: [], codingProblems: [], errors };
  }
}

// ─── React component ─────────────────────────────────────────────────────────

export default function TexZipImporter({ onImport, className = '' }) {
  const inputRef = useRef(null);
  const [status, setStatus] = useState(null);   // null | 'parsing' | 'done' | 'error'
  const [summary, setSummary] = useState(null);

  async function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    setStatus('parsing');
    setSummary(null);

    try {
      const result = await parseTexZip(file);
      const totalMcqSubj = result.sections.reduce((n, s) => n + s.questions.length, 0);
      const totalCoding = result.codingProblems.length;
      setSummary({
        sections: result.sections.length,
        questions: totalMcqSubj,
        coding: totalCoding,
        errors: result.errors,
      });
      setStatus(result.sections.length || result.codingProblems.length ? 'done' : 'error');
      if (result.sections.length || result.codingProblems.length) {
        onImport(result);
      }
    } catch (err) {
      setSummary({ errors: [{ location: 'Parser', message: err.message }] });
      setStatus('error');
    }
  }

  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      <input
        ref={inputRef}
        type="file"
        accept=".zip"
        className="hidden"
        onChange={handleFile}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={status === 'parsing'}
        className="px-3 py-1.5 text-sm font-medium rounded border border-dashed
                   border-indigo-400 text-indigo-600 hover:bg-indigo-50
                   disabled:opacity-50 disabled:cursor-wait transition-colors"
      >
        {status === 'parsing' ? 'Parsing…' : '⬆ Import TEX ZIP'}
      </button>

      {summary && (
        <div className={`text-xs rounded p-2 ${
          summary.errors.length > 0
            ? 'bg-yellow-50 border border-yellow-200 text-yellow-800'
            : 'bg-green-50 border border-green-200 text-green-800'
        }`}>
          {status === 'done' && (
            <p className="font-semibold mb-1">
              ✓ Imported {summary.questions} question{summary.questions !== 1 ? 's' : ''}
              {summary.coding ? `, ${summary.coding} coding problem${summary.coding !== 1 ? 's' : ''}` : ''} across {summary.sections} section{summary.sections !== 1 ? 's' : ''}.
            </p>
          )}
          {summary.errors.length > 0 && (
            <>
              <p className="font-semibold text-yellow-900 mb-1">
                {summary.errors.length} issue{summary.errors.length !== 1 ? 's' : ''}:
              </p>
              <ul className="list-disc list-inside space-y-0.5">
                {summary.errors.map((e, i) => (
                  <li key={i}><span className="font-medium">{e.location}:</span> {e.message}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}