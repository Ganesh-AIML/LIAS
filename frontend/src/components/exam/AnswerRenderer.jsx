import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';

/**
 * AnswerRenderer — renders a stored Markdown+LaTeX answer string safely.
 *
 * SECURITY CONTRACT:
 * This is the ONLY permitted way to display student answer content.
 * - ReactMarkdown renders to React elements, not via innerHTML.
 * - rehype-katex renders math via KaTeX's own DOM builder.
 * - Raw HTML in the Markdown string is blocked by default in ReactMarkdown.
 * - Do NOT replace this with dangerouslySetInnerHTML anywhere in the admin panel.
 */
export default function AnswerRenderer({ markdown }) {
  if (!markdown) {
    return <p className="text-slate-400 italic text-sm">No answer provided.</p>;
  }

  return (
    <div className="prose prose-sm max-w-none text-slate-800">
      <ReactMarkdown
        remarkPlugins={[remarkMath]}
        rehypePlugins={[rehypeKatex]}
        allowedElements={[
          'p', 'strong', 'em', 'ul', 'ol', 'li',
          'blockquote', 'br', 'span', 'div', 'annotation',
          'math', 'semantics', 'mrow', 'mi', 'mo', 'mn', 'msup',
          'msub', 'mfrac', 'msubsup', 'mover', 'munder',
        ]}
        unwrapDisallowed={true}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}