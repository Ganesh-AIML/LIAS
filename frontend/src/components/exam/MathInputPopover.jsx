import { useEffect, useRef, useState, useCallback } from 'react';
import 'mathlive';

/**
 * Visual WYSIWYG equation entry using MathLive's <math-field> custom element.
 */
export default function MathInputPopover({ onConfirm, onCancel, initialLatex = '' }) {
  const mathFieldRef = useRef(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const field = mathFieldRef.current;
    if (!field) return;

    field.mathVirtualKeyboardPolicy = 'manual';
    window.mathVirtualKeyboard.show();

    if (initialLatex) {
      field.value = initialLatex;
    }

    return () => {
      window.mathVirtualKeyboard.hide();
    };
  }, [initialLatex]);

  const handleConfirm = useCallback(() => {
    const latex = mathFieldRef.current?.value?.trim();

    if (!latex) {
      setError('Please enter an equation before confirming.');
      return;
    }

    setError('');
    onConfirm(latex);
  }, [onConfirm]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Escape') onCancel();
  }, [onCancel]);

  return (
    <div
      className="absolute z-50 bg-white border border-slate-200 rounded-xl shadow-2xl p-4 w-[520px]"
      onKeyDown={handleKeyDown}
      role="dialog"
      aria-label="Equation editor"
      aria-modal="true"
    >
      <p className="text-sm text-slate-500 mb-2">
        Use the keyboard below to build your equation visually.
      </p>

      <math-field
        ref={mathFieldRef}
        class="w-full border border-slate-300 rounded-lg p-3 text-lg min-h-[60px] focus:outline-none focus:ring-2 focus:ring-blue-400"
      />

      {error && (
        <p className="text-red-500 text-xs mt-1" role="alert">{error}</p>
      )}

      <div className="flex gap-2 mt-3 justify-end">
        <button
          onClick={onCancel}
          className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg"
        >
          Cancel
        </button>
        <button
          onClick={handleConfirm}
          className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          Insert Equation
        </button>
      </div>
    </div>
  );
}