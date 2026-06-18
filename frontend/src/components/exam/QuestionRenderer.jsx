/**
 * QuestionRenderer
 *
 * Renders admin-authored question text safely.
 * - format === 'markdown'  → ReactMarkdown + remark-gfm + remark-math + rehype-katex
 *   Permissive allowedElements: includes img, table, pre, code, headings.
 *   Does NOT use rehype-raw or dangerouslySetInnerHTML — raw HTML from the DB
 *   is never rendered, only parsed Markdown nodes. Security contract preserved.
 * - format !== 'markdown'  → plain whitespace-pre-wrap span (legacy path, identical
 *   to current behaviour in ExamWorkspace/UpcomingTestPreview/AnalyticsView).
 *
 * Props:
 *   text   {string}  Question text (plain or markdown+latex)
 *   format {string}  'markdown' | 'plain' (default 'plain')
 *   className {string} optional extra Tailwind classes on wrapper
 */

import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm    from 'remark-gfm';
import remarkMath   from 'remark-math';
import rehypeKatex  from 'rehype-katex';
import 'katex/dist/katex.min.css';

// Allowed HTML element types produced by the ReactMarkdown AST.
// Extends AnswerRenderer's list to include img, table family, pre/code, headings.
// Deliberately excludes: script, style, iframe, object, embed, form, input.
const ALLOWED_ELEMENTS = [
  // Text-level
  'p', 'span', 'strong', 'em', 's', 'del', 'ins', 'mark', 'sub', 'sup',
  'br', 'hr',
  // Headings (for multi-part questions)
  'h1', 'h2', 'h3', 'h4',
  // Lists
  'ul', 'ol', 'li',
  // Inline/block code
  'pre', 'code',
  // Links (open in new tab, rel=noopener)
  'a',
  // Images (admin-authored; base64 data-URIs or absolute https URLs only in practice)
  'img',
  // Tables (GFM)
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
  // Blockquote
  'blockquote',
  // KaTeX math wrappers (injected by rehype-katex)
  'span', 'math', 'semantics', 'mrow', 'mn', 'mo', 'mi', 'msup', 'msub',
  'mfrac', 'msqrt', 'mtext', 'mspace', 'annotation', 'svg', 'path', 'g',
  // Div wrapper inserted by rehype-katex for display math
  'div',
];

// Custom renderers
const COMPONENTS = {
  // Open links in new tab safely
  a: ({ href, children, ...props }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-indigo-600 underline"
      {...props}
    >
      {children}
    </a>
  ),
  // Responsive images; cap width, lazy-load
  img: ({ src, alt, ...props }) => (
    <img
      src={src}
      alt={alt || ''}
      loading="lazy"
      className="max-w-full h-auto rounded my-2 border border-gray-200"
      {...props}
    />
  ),
  // Scrollable code blocks
  pre: ({ children, ...props }) => (
    <pre
      className="bg-gray-900 text-gray-100 rounded p-3 overflow-x-auto text-sm my-2"
      {...props}
    >
      {children}
    </pre>
  ),
  code: ({ inline, className, children, ...props }) =>
    inline ? (
      <code
        className="bg-gray-100 text-gray-800 rounded px-1 py-0.5 text-sm font-mono"
        {...props}
      >
        {children}
      </code>
    ) : (
      <code className={className} {...props}>{children}</code>
    ),
  // GFM tables
  table: ({ children, ...props }) => (
    <div className="overflow-x-auto my-2">
      <table
        className="min-w-full border-collapse border border-gray-300 text-sm"
        {...props}
      >
        {children}
      </table>
    </div>
  ),
  th: ({ children, ...props }) => (
    <th
      className="border border-gray-300 bg-gray-50 px-3 py-1.5 text-left font-semibold"
      {...props}
    >
      {children}
    </th>
  ),
  td: ({ children, ...props }) => (
    <td className="border border-gray-300 px-3 py-1.5" {...props}>
      {children}
    </td>
  ),
  blockquote: ({ children, ...props }) => (
    <blockquote
      className="border-l-4 border-indigo-300 pl-3 italic text-gray-600 my-2"
      {...props}
    >
      {children}
    </blockquote>
  ),
};

const KATEX_OPTIONS = { strict: false, trust: true, throwOnError: false, errorColor: '#cc0000' };
const REMARK_PLUGINS = [remarkGfm, remarkMath];
const REHYPE_PLUGINS = [[rehypeKatex, KATEX_OPTIONS]];

export default function QuestionRenderer({ text = '', format = 'plain', className = '' }) {
  if (!format || format !== 'markdown') {
    // Legacy plain-text path — identical byte-for-byte behaviour to current code
    return (
      <span
        className={`whitespace-pre-wrap ${className}`}
        style={{ fontFamily: 'inherit' }}
      >
        {text}
      </span>
    );
  }

  return (
    <div className={`prose prose-sm max-w-none question-renderer ${className}`}>
      <ReactMarkdown
        remarkPlugins={REMARK_PLUGINS}
        rehypePlugins={REHYPE_PLUGINS}
        allowedElements={ALLOWED_ELEMENTS}
        unwrapDisallowed
        components={COMPONENTS}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}