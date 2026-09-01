/**
 * Verifying a save without reparsing the whole document.
 *
 * The full reparse in the serializer exists to prove one thing: that the bytes
 * about to be written read back as exactly the blocks the editor intended. On a
 * large file that proof costs a complete parse, which is the single largest
 * cost in a save and the reason saving an eight megabyte document took tens of
 * seconds.
 *
 * The proof can be made local. Blocks whose bytes did not change can only
 * reparse differently if their boundaries moved, and a boundary can only move
 * because of a change beside it. So reparsing each changed block together with
 * one untouched neighbour on each side covers every way a change can reach
 * outside itself. An unterminated code fence, the classic case, swallows its
 * neighbours, and those neighbours are inside the window, so the block count
 * comes back wrong and the save is refused exactly as before.
 *
 * This is not a weaker check traded for speed. It is the same check, applied to
 * the region where it can fail.
 */

import { splitBlocks } from './blocks';
import { toLf } from './line-endings';
import type { NotoBlockKind } from './contracts';

export interface VerificationWindow {
  /** First and last unit index covered, inclusive. */
  readonly from: number;
  readonly to: number;
}

/**
 * The windows that have to be reparsed.
 *
 * Each changed unit is widened by one neighbour on each side, and overlapping
 * windows are merged so a run of changes is checked once rather than repeatedly.
 */
export function verificationWindows(
  dirty: readonly boolean[],
): VerificationWindow[] {
  const windows: VerificationWindow[] = [];
  for (let index = 0; index < dirty.length; index += 1) {
    if (!dirty[index]) continue;
    const from = Math.max(0, index - 1);
    const to = Math.min(dirty.length - 1, index + 1);
    const last = windows.at(-1);
    // `>= from - 1` merges windows that touch as well as ones that overlap,
    // so two changes either side of one clean block become a single reparse.
    if (last && last.to >= from - 1) {
      windows[windows.length - 1] = { from: last.from, to: Math.max(last.to, to) };
    } else {
      windows.push({ from, to });
    }
  }
  return windows;
}

export interface ReparsedBlock {
  readonly kind: NotoBlockKind;
  readonly semanticKey: string;
  readonly markdown: string;
}

export interface WindowCheck {
  readonly ok: boolean;
  /** Index of the unit that failed, for the message the user sees. */
  readonly failedAt?: number;
  /** Facts about each reparsed block, needed to build the next revision. */
  readonly blocks?: readonly ReparsedBlock[];
}

/**
 * Reparse one window and confirm it produced the intended blocks.
 *
 * `expected` holds the markdown each unit in the window should read as. The
 * slice must contain whole units and the gaps between them, which it does
 * because units are contiguous in the output.
 */
export function checkWindow(
  slice: string,
  window: VerificationWindow,
  expected: readonly string[],
): WindowCheck {
  const split = splitBlocks(slice);
  const count = window.to - window.from + 1;

  // A different number of blocks means a change altered a boundary: the classic
  // case is an unterminated fence swallowing what follows it.
  if (split.spans.length !== count) return { ok: false, failedAt: window.from };

  const blocks: ReparsedBlock[] = [];
  for (let offset = 0; offset < count; offset += 1) {
    const span = split.spans[offset];
    if (toLf(span.markdown) !== toLf(expected[offset])) {
      return { ok: false, failedAt: window.from + offset };
    }
    blocks.push({ kind: span.kind, semanticKey: span.semanticKey, markdown: toLf(span.markdown) });
  }

  // Anything outside the blocks must be the whitespace of the gaps, never
  // content that has quietly appeared.
  if (split.leading.trim().length > 0 || split.trailing.trim().length > 0) {
    return { ok: false, failedAt: window.from };
  }

  return { ok: true, blocks };
}
