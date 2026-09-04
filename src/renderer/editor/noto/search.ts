/**
 * Finding text in the document.
 *
 * Kept free of `EditorView` so the matching rules can be tested directly. The
 * hard part is not the search, it is the coordinates: a match the user sees as
 * one run of characters may span several ProseMirror text nodes, because marks
 * split them. Searching each text node separately would silently fail to find
 * "hello world" when half of it is bold, which is exactly the case a writer
 * notices.
 *
 * So the document is flattened once into a plain string with a map back to
 * document positions, and matching happens on that.
 */

import { patternFor as sharedPattern } from '../../../shared/search/pattern';
import type { Node as ProseNode } from 'prosemirror-model';

export interface SearchOptions {
  readonly query: string;
  readonly caseSensitive: boolean;
  readonly wholeWord: boolean;
  readonly regex: boolean;
}

export interface SearchMatch {
  readonly from: number;
  readonly to: number;
}

interface Segment {
  /** Offset of this segment in the flattened text. */
  readonly offset: number;
  /** Position of the segment's first character in the document. */
  readonly position: number;
  readonly length: number;
}

export interface FlatDocument {
  readonly text: string;
  readonly segments: readonly Segment[];
}

/**
 * Flatten the document to searchable text.
 *
 * Block boundaries become newlines so that a query cannot match across two
 * paragraphs as though they were one line, and so `^` and `$` in a regular
 * expression mean what the user expects.
 */
export function flatten(doc: ProseNode): FlatDocument {
  const segments: Segment[] = [];
  let text = '';

  doc.descendants((node, position) => {
    if (node.isText) {
      segments.push({ offset: text.length, position, length: node.text?.length ?? 0 });
      text += node.text ?? '';
      return false;
    }
    // A leaf that is not text still occupies space the user can see, but it has
    // no characters to match, so it only contributes a boundary.
    if (node.isBlock && text.length > 0 && !text.endsWith('\n')) text += '\n';
    return true;
  });

  return { text, segments };
}

/** Document position for an offset in the flattened text. */
function positionAt(flat: FlatDocument, offset: number): number {
  let low = 0;
  let high = flat.segments.length - 1;
  let best = flat.segments[0];
  while (low <= high) {
    const middle = (low + high) >> 1;
    const segment = flat.segments[middle];
    if (segment.offset <= offset) {
      best = segment;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  if (!best) return 0;
  // Offsets landing in an inserted boundary clamp to the end of the segment
  // before it, which keeps a selection inside real content.
  const within = Math.min(offset - best.offset, best.length);
  return best.position + Math.max(0, within);
}


/**
 * The pattern to run against the flattened text.
 *
 * Returns null for a query that cannot compile, so a half typed regular
 * expression shows no matches instead of throwing while the user is typing.
 */
export function patternFor(options: SearchOptions): RegExp | null {
  return sharedPattern(options.query, options);
}

/** Every match in the document, in document order. */
export function findMatches(doc: ProseNode, options: SearchOptions): SearchMatch[] {
  const pattern = patternFor(options);
  if (!pattern) return [];

  const flat = flatten(doc);
  const matches: SearchMatch[] = [];
  let found: RegExpExecArray | null = pattern.exec(flat.text);
  while (found !== null) {
    // A pattern able to match nothing would spin forever on the same offset.
    if (found[0].length === 0) {
      pattern.lastIndex += 1;
    } else {
      matches.push({
        from: positionAt(flat, found.index),
        to: positionAt(flat, found.index + found[0].length),
      });
      if (matches.length >= 10_000) break;
    }
    found = pattern.exec(flat.text);
  }
  return matches;
}

/**
 * The match to select next, given where the caret is.
 *
 * Searching forward starts at the caret rather than at the top of the document,
 * so find behaves like a continuation of where the user is reading, and wraps
 * around instead of stopping at the end.
 */
export function nextMatch(
  matches: readonly SearchMatch[],
  caret: number,
  direction: 'forward' | 'backward',
): number {
  if (matches.length === 0) return -1;
  if (direction === 'forward') {
    const index = matches.findIndex((match) => match.from >= caret);
    return index === -1 ? 0 : index;
  }
  for (let index = matches.length - 1; index >= 0; index -= 1) {
    if (matches[index].to <= caret) return index;
  }
  return matches.length - 1;
}
