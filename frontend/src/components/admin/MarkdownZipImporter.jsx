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
import React, { useRef, useState } from 'react';

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

    const b64  = btoa(String.fromCharCode(...bytes));
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

// ─── React Component ───────────────────────────────────────────────────────────
//
// Usage (in ScheduleTest.jsx):
//
//   import MarkdownZipImporter from './MarkdownZipImporter';
//
//   <MarkdownZipImporter
//     onImport={({ sections, errors }) => { /* merge into state */ }}
//   />
//
// onImport receives { sections: SectionResult[], errors: ErrorEntry[] }
// Caller decides how to merge into existing questions/subjectiveQuestions arrays.

export default function MarkdownZipImporter({ onImport, className = '' }) {
  const inputRef               = useRef(null);
  const [status, setStatus]    = useState(null);   // null | 'parsing' | 'done' | 'error'
  const [summary, setSummary]  = useState(null);

  async function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';                            // allow re-selecting same file

    setStatus('parsing');
    setSummary(null);

    try {
      const result = await parseMarkdownZip(file);
      const totalQ = result.sections.reduce((n, s) => n + s.questions.length, 0);
      setSummary({
        sections: result.sections.length,
        questions: totalQ,
        errors: result.errors,
      });
      setStatus(result.errors.length > 0 ? 'done-with-errors' : 'done');
      onImport(result);
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
        accept=".zip,.md,.markdown"
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
        {status === 'parsing' ? 'Parsing…' : '⬆ Import Markdown (.zip / .md)'}
      </button>

      {summary && (
        <div className={`text-xs rounded p-2 ${
          summary.errors.length > 0
            ? 'bg-yellow-50 border border-yellow-200 text-yellow-800'
            : 'bg-green-50 border border-green-200 text-green-800'
        }`}>
          {status !== 'error' && (
            <p className="font-semibold mb-1">
              Imported {summary.questions} question{summary.questions !== 1 ? 's' : ''} across {summary.sections} section{summary.sections !== 1 ? 's' : ''}.
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
  );
}