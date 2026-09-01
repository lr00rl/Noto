/**
 * Turning editor state into a save transaction.
 *
 * Kept free of `EditorView` so it can be tested without a DOM, and so the
 * expensive decision (serialize this block, or reuse its original source?)
 * lives somewhere it can be reasoned about on its own.
 */

import type { Node as ProseNode } from 'prosemirror-model';
import { blockToMarkdown } from '../../../shared/markdown/v3/pm/to-mdast';
import {
  NOTO_MARKDOWN_VERSION,
  type NotoBlockOrigin,
  type NotoDocumentWire,
  type NotoTransaction,
  type NotoUnit,
} from '../../../shared/markdown/v3/contracts';

/** What a block looked like when the document was accepted. */
export interface PristineBlock {
  readonly node: ProseNode;
  readonly markdown: string;
}

export interface CaptureInput {
  readonly doc: ProseNode;
  readonly origins: readonly (NotoBlockOrigin | null)[];
  readonly document: NotoDocumentWire;
  readonly pristine: ReadonlyMap<string, PristineBlock>;
}

export interface CaptureStats {
  /** Blocks reused verbatim, costing no serialization. */
  readonly reused: number;
  /** Blocks rendered back to markdown. */
  readonly serialized: number;
}

/**
 * Source text for one block.
 *
 * `ProseNode.eq` is a structural comparison that stops at the first difference,
 * so an untouched block is far cheaper than rendering it back to markdown. On a
 * large document where the user changed one paragraph this is the difference
 * between serializing one block and serializing all of them.
 */
function markdownFor(
  node: ProseNode,
  origin: NotoBlockOrigin | null,
  pristine: CaptureInput['pristine'],
): { markdown: string; reused: boolean } {
  if (origin) {
    const previous = pristine.get(origin.blockId);
    if (previous && node.eq(previous.node)) {
      return { markdown: previous.markdown, reused: true };
    }
  }
  return { markdown: blockToMarkdown(node), reused: false };
}

/**
 * The markdown a unit stands for, resolving an unchanged unit to its origin.
 *
 * Callers that want the document as text (a plugin transform, the outline) need
 * every block's markdown, while callers that want a save transaction need
 * unchanged blocks to stay empty. This keeps the two apart rather than making
 * one pay for the other.
 */
export function unitMarkdown(unit: NotoUnit, pristine: CaptureInput['pristine']): string {
  if (unit.markdown !== null) return unit.markdown;
  if (unit.origin === null) return '';
  return pristine.get(unit.origin.blockId)?.markdown ?? '';
}

/** Every block's markdown, in document order. */
export function captureMarkdown(input: CaptureInput): string[] {
  return captureUnits(input).units.map((unit) => unitMarkdown(unit, input.pristine));
}

export function captureUnits(input: CaptureInput): { units: NotoUnit[]; stats: CaptureStats } {
  const units: NotoUnit[] = [];
  let reused = 0;
  let serialized = 0;

  input.doc.forEach((node, _offset, index) => {
    const origin = input.origins[index] ?? null;
    const result = markdownFor(node, origin, input.pristine);
    if (result.reused) reused += 1;
    else serialized += 1;
    // A reused block sends no text. Main already holds its bytes, so repeating
    // them would make every save carry the whole document across the process
    // boundary regardless of how little changed.
    units.push({ origin, markdown: result.reused ? null : result.markdown });
  });

  return { units, stats: { reused, serialized } };
}

export function captureTransaction(input: CaptureInput): { transaction: NotoTransaction; stats: CaptureStats } {
  const { units, stats } = captureUnits(input);
  return {
    transaction: {
      version: NOTO_MARKDOWN_VERSION,
      mode: 'blocks',
      documentId: input.document.documentId,
      revisionId: input.document.revisionId,
      units,
    },
    stats,
  };
}
