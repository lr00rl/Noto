/**
 * The document outline.
 *
 * Derived from the accepted document text rather than tracked as separate
 * state, so it can never drift from what the editor holds. Pure, so it is
 * testable without a DOM.
 */

import { splitBlocks } from '../shared/markdown/v3/blocks';

export interface OutlineEntry {
  /** Index of the top level block, which is what the editor navigates by. */
  readonly blockIndex: number;
  readonly depth: number;
  readonly text: string;
}

/**
 * Strip the leading `#` run and any trailing closing run from a heading.
 *
 * A closing run only counts when whitespace precedes it, which is what keeps
 * `### C# and F#` from losing its last character.
 */
function headingText(markdown: string): string {
  return markdown
    .replace(/^\s{0,3}#{1,6}\s*/, '')
    .replace(/\s+#+\s*$/, '')
    .trim();
}

function setextDepth(markdown: string): number | null {
  const lines = markdown.split('\n');
  if (lines.length < 2) return null;
  const underline = lines[lines.length - 1].trim();
  if (/^=+$/.test(underline)) return 1;
  if (/^-+$/.test(underline)) return 2;
  return null;
}

export function outlineOf(text: string): OutlineEntry[] {
  const entries: OutlineEntry[] = [];
  splitBlocks(text).spans.forEach((span, blockIndex) => {
    if (span.kind !== 'heading') return;
    const atx = /^\s{0,3}(#{1,6})\s/.exec(span.markdown);
    const depth = atx ? atx[1].length : setextDepth(span.markdown) ?? 1;
    const label = atx ? headingText(span.markdown) : span.markdown.split('\n')[0].trim();
    entries.push({ blockIndex, depth, text: label || 'Untitled heading' });
  });
  return entries;
}
