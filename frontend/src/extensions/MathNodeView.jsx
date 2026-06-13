import { NodeViewWrapper } from '@tiptap/react';
import { useEffect, useRef } from 'react';
import katex from 'katex';
import 'katex/dist/katex.min.css';

/**
 * Renders a stored LaTeX string using KaTeX into a DOM node.
 *
 * SECURITY: katex.render() builds DOM nodes via its own virtual DOM.
 * It does NOT use innerHTML with the user-supplied latex string.
 */
export default function MathNodeView({ node, selected, editor, deleteNode }) {
  const containerRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current || !node.attrs.latex) return;

    try {
      katex.render(node.attrs.latex, containerRef.current, {
        displayMode: true,
        throwOnError: false,
        trust: false,
        strict: 'warn',
      });
    } catch {
      containerRef.current.textContent = '[Invalid equation]';
    }
  }, [node.attrs.latex]);

  return (
    <NodeViewWrapper
      className={`math-block-wrapper ${selected ? 'ring-2 ring-blue-400' : ''}`}
      data-drag-handle
    >
      <div ref={containerRef} className="py-2 px-4 bg-slate-50 rounded" />
      {editor.isEditable && (
        <button
          onClick={deleteNode}
          className="text-xs text-red-400 hover:text-red-600 mt-1"
          aria-label="Remove equation"
        >
          Remove equation
        </button>
      )}
    </NodeViewWrapper>
  );
}