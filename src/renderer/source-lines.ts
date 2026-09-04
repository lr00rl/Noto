/**
 * Where a block sits in the markdown, for the caret to follow between modes.
 *
 * Source Code Mode shows the whole file as text, and the caret has to arrive
 * where the reader was and come back to where the reader went, as it does
 * in Typora. The rendered document counts in blocks and the text counts in
 * characters, and these two functions are the exchange rate.
 */

import { splitBlocks } from '../shared/markdown/v3/blocks';

/** The character offset where block `index` starts, or the end when there is no such block. */
export function offsetOfBlock(markdown: string, index: number): number {
  const spans = splitBlocks(markdown).spans;
  if (index < 0 || spans.length === 0) return 0;
  return index < spans.length ? spans[index].start : markdown.length;
}

/** The block holding character `offset`; the one before a gap when it falls between two. */
export function blockAtOffset(markdown: string, offset: number): number {
  const spans = splitBlocks(markdown).spans;
  let found = 0;
  for (let index = 0; index < spans.length; index += 1) {
    if (spans[index].start > offset) break;
    found = index;
  }
  return found;
}
