/**
 * The arithmetic behind a code block's line-number gutter.
 *
 * Ported from the author's `fence-enhance` plugin for Typora. The gutter is
 * as wide as the block's own line count needs, never a fixed width for every
 * block in the document: a fixed width is wrong in both directions, wasting
 * four columns on the six-line snippets that are most of any document and
 * still clipping a four-digit file. `1ch` is one digit in the mono face, so
 * N digits reserve N columns and nothing more.
 */

/**
 * Never below two digits. A one-digit gutter reads as cramped against the
 * rule, and the blocks in the one-to-nine range are exactly the ones that
 * grow into two digits as you type; reserving the column up front avoids a
 * reflow on the tenth line.
 */
export const MIN_DIGITS = 2;

/** Past six digits nothing sane is that long, and a clamp beats a scroll. */
export const MAX_DIGITS = 6;

export function digitsForLineCount(lineCount: number): number {
  if (!Number.isFinite(lineCount) || lineCount < 1) return MIN_DIGITS;
  return Math.min(MAX_DIGITS, Math.max(MIN_DIGITS, String(Math.floor(lineCount)).length));
}

/** Lines in a block's text. An empty block is one line, since the caret is on it. */
export function lineCount(text: string): number {
  let count = 1;
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) === 10) count += 1;
  }
  return count;
}

/** The numbers, one per line, for a gutter set in `white-space: pre`. */
export function gutterText(lines: number): string {
  const parts: string[] = [];
  for (let line = 1; line <= lines; line += 1) parts.push(String(line));
  return parts.join('\n');
}
