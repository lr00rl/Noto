/**
 * The document transforms behind the two ported plugins.
 *
 * Pure functions over markdown, kept apart from the plugin shells so they can
 * be tested without a lifecycle, an editor, or a running app. Both are clean
 * room reimplementations of behaviour from the owner's `typora-plugin-lite`;
 * no Typora code is involved.
 */

const ATX_HEADING = /^(\s{0,3})(#{1,6})(\s)/;
const FENCE = /^\s{0,3}(`{3,}|~{3,})/;

/**
 * Walk lines while tracking fenced code, so a transform never edits inside a
 * fence. A `#` in a shell script is not a heading and a CJK boundary inside
 * code is not a spacing opportunity.
 */
function mapOutsideFences(markdown: string, transform: (line: string) => string): string {
  let fence: string | null = null;
  return markdown.split('\n').map((line) => {
    const match = FENCE.exec(line);
    if (match) {
      const marker = match[1][0];
      if (fence === null) fence = marker;
      else if (marker === fence) fence = null;
      return line;
    }
    return fence === null ? transform(line) : line;
  }).join('\n');
}

export interface ShiftResult {
  readonly markdown: string;
  readonly changed: boolean;
  /** True when a heading could not move because it was already at the edge. */
  readonly clamped: boolean;
}

/**
 * Move every heading up or down a level.
 *
 * A heading that would leave the one-to-six range is left alone rather than
 * dropped or clamped silently, and the caller is told so it can say why nothing
 * happened.
 */
export function shiftHeadings(markdown: string, delta: number): ShiftResult {
  let changed = false;
  let clamped = false;

  const result = mapOutsideFences(markdown, (line) => {
    const match = ATX_HEADING.exec(line);
    if (!match) return line;

    const [, indent, hashes, spacer] = match;
    const level = hashes.length + delta;
    if (level < 1 || level > 6) {
      clamped = true;
      return line;
    }
    changed = true;
    return `${indent}${'#'.repeat(level)}${spacer}${line.slice(match[0].length)}`;
  });

  return { markdown: result, changed, clamped };
}

// A CJK-ish range wide enough for Chinese, Japanese and Korean text.
const CJK = '\\u2e80-\\u2eff\\u2f00-\\u2fdf\\u3040-\\u309f\\u30a0-\\u30ff\\u3400-\\u4dbf\\u4e00-\\u9fff\\uf900-\\ufaff';

/**
 * Stands in for a protected span while spacing runs.
 *
 * A private-use character, included in the half-width class below, so that a
 * boundary between CJK text and an inline code span or link is spaced exactly
 * as it would be against ordinary Latin text. Splitting the line and processing
 * the pieces separately would make those boundaries invisible.
 */
const PLACEHOLDER = '\uE000';

// Latin letters, digits, the placeholder, and the symbols that read as part of
// a word rather than as punctuation.
const HALF = `A-Za-z0-9${PLACEHOLDER}`;

const CJK_THEN_HALF = new RegExp(`([${CJK}])([${HALF}$%^&*+\\\\=|/@#])`, 'g');
const HALF_THEN_CJK = new RegExp(`([${HALF}~!$%^&*+\\\\=|/@#;:,.?)\\]}>])([${CJK}])`, 'g');

/** Inline spans that must survive untouched: code, links, images, math. */
const PROTECTED = /`[^`\n]*`|!?\[[^\]\n]*\]\([^)\n]*\)|\$[^$\n]+\$/g;

/**
 * Insert a space between CJK and half-width characters.
 *
 * Applied per line and outside fences. Inline code, links and math are swapped
 * for a placeholder first, so a URL or an identifier is never rewritten while
 * the boundary around it is still spaced. Text that already has a space is left
 * alone, so running this twice changes nothing.
 */
export function padCjkSpacing(markdown: string): string {
  return mapOutsideFences(markdown, (line) => {
    const protectedSpans: string[] = [];
    const masked = line.replace(PROTECTED, (span) => {
      protectedSpans.push(span);
      return PLACEHOLDER;
    });

    const spaced = masked
      .replace(CJK_THEN_HALF, '$1 $2')
      .replace(HALF_THEN_CJK, '$1 $2');

    let index = 0;
    return spaced.replaceAll(PLACEHOLDER, () => protectedSpans[index++]);
  });
}
