/**
 * normalizeMath.js
 *
 * Fixes malformed display math blocks so remark-math can parse them.
 *
 * Problem:
 *   Authors write:  $$\begin{aligned}...\end{aligned}$$
 *   remark-math requires newlines around $$ delimiters to treat them
 *   as display math. Without leading/trailing newlines inside the $$
 *   block, the parser sees inline math or fails.
 *
 * Transformation:
 *   $$\begin{aligned}...$$  →  $$\n\begin{aligned}...\n$$
 *
 * Rules:
 *   - Only transforms $$ blocks containing \begin{...}
 *   - Skips already-correct blocks (inner already starts+ends with \n)
 *   - Skips inline $...$ math (not touched)
 *   - Skips single-line $$ with no \begin (e.g. $$x^2$$)
 *   - Idempotent: safe to apply multiple times
 */

const DISPLAY_MATH_RE = /\$\$([\s\S]+?)\$\$/g;

export function normalizeMath(markdown) {
  if (typeof markdown !== 'string') return markdown;

  return markdown.replace(DISPLAY_MATH_RE, (match, inner) => {
    // Only act on blocks that contain \begin{...}
    if (!/\\begin\s*\{/.test(inner)) return match;

    const startsWithNewline = /^\s*\n/.test(inner);
    const endsWithNewline   = /\n\s*$/.test(inner);
    if (startsWithNewline && endsWithNewline) return match; // already correct

    let normalized = inner;
    if (!startsWithNewline) normalized = '\n' + normalized.trimStart();
    if (!endsWithNewline)   normalized = normalized.trimEnd() + '\n';

    return `$$${normalized}$$`;
  });
}
