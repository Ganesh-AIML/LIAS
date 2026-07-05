import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { useState, useCallback, useEffect } from 'react';
import { Sigma } from 'lucide-react';

import { MathNode } from '../../extensions/MathNode';
import MathInputPopover from './MathInputPopover';

export default function SubjectiveEditor({
  questionId,
  questionText,
  onChange,
  initialValue = '',
  disabled = false,
}) {
  const [showMathPopover, setShowMathPopover] = useState(false);
  const [charCount, setCharCount] = useState(0);
  const MAX_CHARS = 5000;

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
      }),
      Placeholder.configure({
        placeholder: 'Write your answer here. Use the Σ button to insert equations visually.',
      }),
      MathNode,
    ],
    content: initialValue,
    editable: !disabled,
    onUpdate({ editor }) {
      const markdown = serializeToMarkdown(editor);
      const textLength = editor.getText().length;
      setCharCount(textLength);
      onChange(markdown);
    },
  });

  useEffect(() => {
    if (editor && initialValue && editor.isEmpty) {
      editor.commands.setContent(initialValue);
    }
  }, [editor, initialValue]);

  const handleMathConfirm = useCallback((latex) => {
    if (!editor) return;

    editor
      .chain()
      .focus()
      .insertContent({
        type: 'mathBlock',
        attrs: { latex },
      })
      .run();

    // ROOT CAUSE FIX:
    // mathBlock is an atom node. After insertContent(), TipTap leaves a
    // NodeSelection sitting ON the atom (cursor cannot go "inside" an atom).
    // Two bugs stemmed from this:
    //  1. Nothing to continue typing into -> can't type after an equation.
    //  2. Because selection is a NodeSelection on the math node, the NEXT
    //     insertContent() call replaces that selected node instead of
    //     inserting after it -> equations overwrite each other.
    // Fix: ensure there is always a text block right after the inserted
    // math node, and move the cursor (TextSelection) into it.
    const { state } = editor;
    const afterPos = state.selection.to; // position right after the atom
    const nodeAfter = state.doc.nodeAt(afterPos);

    if (!nodeAfter || !nodeAfter.isTextblock) {
      editor
        .chain()
        .insertContentAt(afterPos, { type: 'paragraph' })
        .setTextSelection(afterPos + 1)
        .focus()
        .run();
    } else {
      editor
        .chain()
        .setTextSelection(afterPos + 1)
        .focus()
        .run();
    }

    setShowMathPopover(false);
  }, [editor]);

  if (!editor) return null;

  return (
    <div className="relative flex flex-col gap-2">
      <p className="text-slate-700 font-medium">{questionText}</p>

      <div className="flex items-center gap-1 border border-slate-200 rounded-t-lg px-2 py-1 bg-slate-50">
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBold().run()}
          active={editor.isActive('bold')}
          label="Bold"
          disabled={disabled}
        >
          <strong>B</strong>
        </ToolbarButton>

        <ToolbarButton
          onClick={() => editor.chain().focus().toggleItalic().run()}
          active={editor.isActive('italic')}
          label="Italic"
          disabled={disabled}
        >
          <em>I</em>
        </ToolbarButton>

        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          active={editor.isActive('bulletList')}
          label="Bullet list"
          disabled={disabled}
        >
          •–
        </ToolbarButton>

        <div className="w-px h-5 bg-slate-300 mx-1" aria-hidden="true" />

        <ToolbarButton
          onClick={() => setShowMathPopover(true)}
          label="Insert equation"
          disabled={disabled}
          className="flex items-center gap-1 text-blue-600 font-semibold"
        >
          <Sigma size={15} />
          <span className="text-xs">Equation</span>
        </ToolbarButton>
      </div>

      <div className="relative">
        <EditorContent
          editor={editor}
          className="min-h-[200px] max-h-[500px] overflow-y-auto border border-t-0 border-slate-200 rounded-b-lg px-4 py-3 prose prose-sm max-w-none focus-within:ring-2 focus-within:ring-blue-400"
        />

        {showMathPopover && (
          <div className="absolute top-2 left-2">
            <MathInputPopover
              onConfirm={handleMathConfirm}
              onCancel={() => setShowMathPopover(false)}
            />
          </div>
        )}
      </div>

      <div className="flex justify-end">
        <span className={`text-xs ${charCount > MAX_CHARS * 0.9 ? 'text-orange-500' : 'text-slate-400'}`}>
          {charCount} / {MAX_CHARS} characters
        </span>
      </div>
    </div>
  );
}

function ToolbarButton({ onClick, active, label, disabled, children, className = '' }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={active}
      className={`
        px-2 py-1 rounded text-sm transition-colors
        ${active ? 'bg-blue-100 text-blue-700' : 'text-slate-600 hover:bg-slate-100'}
        ${disabled ? 'opacity-40 cursor-not-allowed' : ''}
        ${className}
      `}
    >
      {children}
    </button>
  );
}

function serializeToMarkdown(editor) {
  const doc = editor.getJSON();
  return doc.content?.map(serializeNode).join('\n\n') ?? '';
}

function serializeNode(node) {
  switch (node.type) {
    case 'mathBlock':
      return `$$${node.attrs?.latex ?? ''}$$`;

    case 'paragraph':
      return node.content?.map(serializeInline).join('') ?? '';

    case 'bulletList':
      return node.content?.map(item =>
        `- ${item.content?.map(serializeNode).join('')}`
      ).join('\n') ?? '';

    case 'orderedList':
      return node.content?.map((item, i) =>
        `${i + 1}. ${item.content?.map(serializeNode).join('')}`
      ).join('\n') ?? '';

    case 'blockquote':
      return node.content?.map(n => `> ${serializeNode(n)}`).join('\n') ?? '';

    default:
      return node.content?.map(serializeInline).join('') ?? '';
  }
}

function serializeInline(node) {
  if (node.type === 'text') {
    let text = node.text ?? '';
    const marks = node.marks ?? [];
    if (marks.some(m => m.type === 'bold'))   text = `**${text}**`;
    if (marks.some(m => m.type === 'italic'))  text = `*${text}*`;
    return text;
  }
  return '';
}