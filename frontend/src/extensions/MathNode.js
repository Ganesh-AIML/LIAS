import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import MathNodeView from './MathNodeView';

/**
 * TipTap node that stores a LaTeX string as its attribute.
 * Renders via MathNodeView (KaTeX display) in the editor.
 * Serializes to $$ latex $$ in Markdown output.
 *
 * SECURITY: This node stores only a LaTeX string.
 * It never stores or renders raw HTML from user input.
 */
export const MathNode = Node.create({
  name: 'mathBlock',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      latex: {
        default: '',
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-math-block]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-math-block': true }), 0];
  },

  addNodeView() {
    return ReactNodeViewRenderer(MathNodeView);
  },

  addStorage() {
    return {
      markdown: {
        serialize(state, node) {
          state.write(`$$${node.attrs.latex}$$`);
          state.closeBlock(node);
        },
      },
    };
  },
});