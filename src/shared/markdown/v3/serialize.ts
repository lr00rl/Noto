/**
 * Rebuilds file bytes from an editing transaction.
 *
 * The rule that makes saves byte exact: a block the user did not change is
 * copied straight out of the original source text rather than re-rendered, so
 * the serializer's formatting opinions can never rewrite untouched parts of
 * somebody's file. Only blocks that actually changed go through
 * `mdast-util-to-markdown`.
 *
 * Every result is verified by reparsing the output and checking that it splits
 * into exactly the blocks the transaction asked for. That is what catches an
 * edit which would silently merge or split blocks, for example a heading edited
 * into plain text that then absorbs the paragraph beneath it.
 */

import { parseSingleBlock } from './blocks';
import { checkWindow, verificationWindows, type ReparsedBlock } from './incremental';
// `parseDocument` remains for source mode, where the whole file is replaced
// and there is no per-block knowledge to build a revision from.
import { fromLf, parseDocument, sha256, toLf } from './document';
import {
  NOTO_MARKDOWN_VERSION,
  type NotoBlock,
  type NotoBlockId,
  type NotoBlockOrigin,
  type NotoDocument,
  type NotoRevisionId,
  type NotoPreservedRange,
  type NotoSerializeFailure,
  type NotoSerializeFailureCode,
  type NotoSerializeResult,
  type NotoTransaction,
  type NotoUnit,
} from './contracts';

const UTF8_BOM = Uint8Array.from([0xef, 0xbb, 0xbf]);
const encoder = new TextEncoder();

function fail(document: NotoDocument, code: NotoSerializeFailureCode, message: string): NotoSerializeFailure {
  return {
    status: 'failed',
    version: NOTO_MARKDOWN_VERSION,
    code,
    message,
    originalBytes: document.originalBytes.slice(),
  };
}

function sameOrigin(left: NotoBlockOrigin, right: NotoBlockOrigin): boolean {
  return left.blockId === right.blockId
    && left.ordinal === right.ordinal
    && left.kind === right.kind
    && left.semanticKey === right.semanticKey;
}

/** A unit is pristine when its text is byte identical to the accepted block. */
/**
 * A unit is pristine when it still matches the block it came from.
 *
 * A null markdown says so directly; an explicit string is still compared, so a
 * caller that sends unchanged text is treated identically to one that omits it.
 */
function isPristine(unit: NotoUnit, block: NotoBlock | undefined): boolean {
  if (block === undefined || unit.origin === null) return false;
  return unit.markdown === null || unit.markdown === block.markdown;
}

/** The markdown a unit stands for, resolving an unchanged unit to its origin. */
function unitMarkdown(unit: NotoUnit, document: NotoDocument): string | null {
  if (unit.markdown !== null) return unit.markdown;
  if (unit.origin === null) return null;
  return document.blocks[unit.origin.ordinal]?.markdown ?? null;
}

function encodeOutput(text: string, bom: 'utf8' | 'none'): Uint8Array {
  const body = encoder.encode(text);
  if (bom === 'none') return body;
  const output = new Uint8Array(UTF8_BOM.length + body.length);
  output.set(UTF8_BOM, 0);
  output.set(body, UTF8_BOM.length);
  return output;
}

function validateOrigins(document: NotoDocument, units: readonly NotoUnit[]): NotoSerializeFailure | null {
  const seen = new Set<string>();
  let lastOrdinal = -1;
  for (const unit of units) {
    if (unit.markdown !== null && unit.markdown.length === 0) {
      return fail(document, 'EMPTY_UNIT',
        'An editing unit cannot be empty. Remove it from the document instead.');
    }
    if (!unit.origin) {
      if (unit.markdown === null) {
        return fail(document, 'EMPTY_UNIT',
          'A new unit must carry its markdown, since it has no origin to be unchanged from.');
      }
      continue;
    }
    const expected = document.blocks[unit.origin.ordinal];
    if (!expected || !sameOrigin(expected.origin, unit.origin)) {
      return fail(document, 'FORGED_ORIGIN',
        'An editing unit claims an identity this document did not issue.');
    }
    if (seen.has(unit.origin.blockId)) {
      return fail(document, 'DUPLICATE_ORIGIN', 'A block identity may appear only once per save.');
    }
    if (unit.origin.ordinal <= lastOrdinal) {
      return fail(document, 'REORDERED_ORIGIN', 'Surviving blocks must keep their original order.');
    }
    seen.add(unit.origin.blockId);
    lastOrdinal = unit.origin.ordinal;
  }
  return null;
}

/**
 * Decide the text between two consecutive units.
 *
 * The original gap is reused whenever both sides came from adjacent blocks in
 * the accepted document. A gap that is only a single newline is reused only if
 * both neighbours are also unchanged, because a single newline relies on the
 * blocks being self terminating and an edit can remove that property.
 */
function gapBetween(
  document: NotoDocument,
  previous: NotoUnit,
  current: NotoUnit,
  previousPristine: boolean,
  currentPristine: boolean,
  lineEnding: NotoDocument['envelope']['lineEnding'],
): { text: string; preserved: NotoPreservedRange | null } {
  const canonical = { text: fromLf('\n\n', lineEnding), preserved: null };
  if (!previous.origin || !current.origin) return canonical;
  if (current.origin.ordinal !== previous.origin.ordinal + 1) return canonical;

  const gap = document.gaps.find((candidate) => candidate.beforeOrdinal === previous.origin!.ordinal);
  if (gap === undefined) return canonical;

  const hasBlankLine = toLf(gap.text).includes('\n\n');
  if (!hasBlankLine && !(previousPristine && currentPristine)) return canonical;

  const previousBlock = document.blocks[previous.origin.ordinal];
  const currentBlock = document.blocks[current.origin.ordinal];
  return {
    text: gap.text,
    preserved: {
      role: 'gap',
      start: previousBlock.end,
      end: currentBlock.start,
      sha256: sha256(gap.text),
    },
  };
}

function serializeBlocks(
  document: NotoDocument,
  units: readonly NotoUnit[],
): NotoSerializeResult {
  const originFailure = validateOrigins(document, units);
  if (originFailure) return originFailure;

  const { lineEnding, bom } = document.envelope;

  // A file with no blocks is pure whitespace. It has no units to drive the
  // loop below, so preserve it directly rather than emitting nothing.
  if (document.blocks.length === 0 && units.length === 0) {
    const outputBytes = encodeOutput(document.text, bom);
    return {
      status: 'serialized',
      version: NOTO_MARKDOWN_VERSION,
      outputBytes,
      outputSha256: sha256(outputBytes),
      document,
      preserved: [{ role: 'trailing', start: 0, end: document.text.length, sha256: sha256(document.text) }],
    };
  }
  const parts: string[] = [];
  const preserved: NotoPreservedRange[] = [];
  // Where each unit and gap lands in the output text, so the next revision can
  // be built by shifting offsets instead of parsing the file again.
  const unitStart: number[] = [];
  const unitEnd: number[] = [];
  const emittedGaps: string[] = [];
  let cursor = 0;
  const emit = (text: string) => { parts.push(text); cursor += text.length; };

  if (bom === 'utf8') preserved.push({ role: 'bom', start: 0, end: 3, sha256: sha256(UTF8_BOM) });

  const startsAtFirstBlock = units[0]?.origin?.ordinal === 0;
  const emittedLeading = startsAtFirstBlock ? document.leading : '';
  if (emittedLeading.length > 0) {
    emit(emittedLeading);
    preserved.push({ role: 'leading', start: 0, end: document.leading.length, sha256: sha256(document.leading) });
  }

  const pristine = units.map((unit) => isPristine(unit, unit.origin ? document.blocks[unit.origin.ordinal] : undefined));

  for (let index = 0; index < units.length; index += 1) {
    const unit = units[index];
    if (index > 0) {
      const gap = gapBetween(document, units[index - 1], unit, pristine[index - 1], pristine[index], lineEnding);
      emittedGaps.push(gap.text);
      emit(gap.text);
      if (gap.preserved) preserved.push(gap.preserved);
    }

    if (pristine[index] && unit.origin) {
      const block = document.blocks[unit.origin.ordinal];
      unitStart.push(cursor);
      emit(document.text.slice(block.start, block.end));
      unitEnd.push(cursor);
      preserved.push({ role: 'block', start: block.start, end: block.end, sha256: block.sha256 });
      continue;
    }

    // Only a changed unit reaches here, so its text is always present. A unit
    // that claims to be unchanged but has no origin to be unchanged from is a
    // malformed transaction rather than a save that should quietly proceed.
    const markdown = unitMarkdown(unit, document);
    if (markdown === null) {
      return fail(document, 'MULTI_BLOCK_UNIT',
        'An unchanged unit must reference a block of the open document.');
    }
    if (parseSingleBlock(markdown) === null) {
      return fail(document, 'MULTI_BLOCK_UNIT',
        'Each editing unit must be exactly one markdown block.');
    }
    unitStart.push(cursor);
    emit(fromLf(markdown, lineEnding));
    unitEnd.push(cursor);
  }

  const lastUnit = units.at(-1);
  const endsAtLastBlock = lastUnit?.origin?.ordinal === document.blocks.length - 1;
  let emittedTrailing = '';
  if (endsAtLastBlock && pristine[units.length - 1] && document.trailing.length > 0) {
    const lastBlock = document.blocks[document.blocks.length - 1];
    emittedTrailing = document.trailing;
    emit(emittedTrailing);
    preserved.push({
      role: 'trailing',
      start: lastBlock.end,
      end: document.text.length,
      sha256: sha256(document.trailing),
    });
  } else if (document.envelope.hasFinalNewline && units.length > 0) {
    emittedTrailing = fromLf('\n', lineEnding);
    emit(emittedTrailing);
  }

  const outputText = parts.join('');
  const outputBytes = encodeOutput(outputText, bom);

  // A save that reproduces the bytes we parsed needs no reparse.
  //
  // Parsing is deterministic, so reparsing identical bytes can only rebuild the
  // document already in hand. On a large file that check is the difference
  // between a save costing a full parse and costing a string comparison, and it
  // is the common case: an autosave, or a save after an edit that was undone.
  if (outputText === document.text) {
    return {
      status: 'serialized',
      version: NOTO_MARKDOWN_VERSION,
      outputBytes,
      outputSha256: sha256(outputBytes),
      document,
      preserved,
    };
  }

  // Verify only where a change could have altered a boundary, and build the
  // next revision by shifting the offsets of everything that did not move.
  const dirty = pristine.map((clean) => !clean);
  const effective = units.map((unit) => unitMarkdown(unit, document));
  if (effective.some((markdown) => markdown === null)) {
    return fail(document, 'REPARSE_MISMATCH', 'An unchanged unit lost the block it referenced.');
  }

  const reparsedBlocks = new Map<number, ReparsedBlock>();
  for (const window of verificationWindows(dirty)) {
    const sliceStart = window.from === 0 ? 0 : unitStart[window.from];
    const sliceEnd = window.to === units.length - 1 ? outputText.length : unitEnd[window.to];
    const check = checkWindow(
      outputText.slice(sliceStart, sliceEnd),
      window,
      effective.slice(window.from, window.to + 1) as string[],
    );
    if (!check.ok || !check.blocks) {
      return fail(document, 'REPARSE_MISMATCH',
        `Block ${(check.failedAt ?? window.from) + 1} would not have survived a reparse unchanged.`);
    }
    check.blocks.forEach((block: ReparsedBlock, offset: number) =>
      reparsedBlocks.set(window.from + offset, block));
  }

  const nextDocument = buildNextDocument({
    previous: document,
    outputText,
    outputBytes,
    bom,
    units,
    effective: effective as string[],
    unitStart,
    unitEnd,
    gaps: emittedGaps,
    leading: emittedLeading,
    trailing: emittedTrailing,
    reparsedBlocks,
  });

  return {
    status: 'serialized',
    version: NOTO_MARKDOWN_VERSION,
    outputBytes,
    outputSha256: sha256(outputBytes),
    document: nextDocument,
    preserved,
  };
}

/**
 * The document the saved bytes represent, assembled rather than parsed.
 *
 * Every block's text is already known: an unchanged one keeps the markdown it
 * had, and a changed one was just confirmed by its window. What moves is where
 * they sit in the file, and that is arithmetic. Parsing again to learn it would
 * cost a full parse to rediscover facts already in hand.
 */
function buildNextDocument(input: {
  previous: NotoDocument;
  outputText: string;
  outputBytes: Uint8Array;
  bom: 'utf8' | 'none';
  units: readonly NotoUnit[];
  effective: readonly string[];
  unitStart: readonly number[];
  unitEnd: readonly number[];
  gaps: readonly string[];
  leading: string;
  trailing: string;
  reparsedBlocks: ReadonlyMap<number, ReparsedBlock>;
}): NotoDocument {
  const sourceSha256 = sha256(input.outputBytes);

  const blocks: NotoBlock[] = input.units.map((unit, ordinal) => {
    const reparsed = input.reparsedBlocks.get(ordinal);
    const original = unit.origin ? input.previous.blocks[unit.origin.ordinal] : undefined;
    const markdown = input.effective[ordinal];

    // An unchanged block that also kept its position already knows its hash,
    // its identity and its kind. Recomputing them would put a hash of every
    // block back into the cost of every save, which is the scaling this whole
    // path exists to remove. Only where it sits in the file has changed.
    if (!reparsed && original && unit.origin?.ordinal === ordinal) {
      return {
        ...original,
        start: input.unitStart[ordinal],
        end: input.unitEnd[ordinal],
      };
    }

    // A changed block's kind comes from its reparse; an unchanged one that
    // moved keeps what it already was, which is the same answer a parse would
    // give since its bytes are identical.
    const kind = reparsed?.kind ?? original?.kind ?? 'paragraph';
    const semanticKey = reparsed?.semanticKey ?? original?.semanticKey ?? '';
    const id = `noto-block-v3:${ordinal}:${sha256(markdown).slice(0, 16)}` as NotoBlockId;
    return {
      version: NOTO_MARKDOWN_VERSION,
      id,
      kind,
      start: input.unitStart[ordinal],
      end: input.unitEnd[ordinal],
      markdown,
      sha256: sha256(markdown),
      semanticKey,
      origin: { blockId: id, ordinal, kind, semanticKey },
    };
  });

  return {
    version: NOTO_MARKDOWN_VERSION,
    // Saving produces a new revision of the same document, not a new document.
    documentId: input.previous.documentId,
    revisionId: `noto-rev-v3:${sourceSha256}` as NotoRevisionId,
    envelope: {
      version: NOTO_MARKDOWN_VERSION,
      byteLength: input.outputBytes.byteLength,
      bom: input.bom,
      lineEnding: input.previous.envelope.lineEnding,
      hasFinalNewline: input.outputText.endsWith('\n'),
      sourceSha256,
    },
    originalBytes: input.outputBytes.slice(),
    text: input.outputText,
    blocks,
    gaps: input.gaps.map((text, index) => ({ beforeOrdinal: index, text })),
    leading: input.leading,
    trailing: input.trailing,
  };
}

/**
 * Apply a transaction and return the exact bytes to write.
 *
 * `source` mode is the escape hatch for edits the block model cannot express,
 * such as rewriting frontmatter or repairing a malformed fence. It replaces the
 * whole file, so it carries the base hash the editor was working from.
 */
export function serializeDocument(
  document: NotoDocument,
  transaction: NotoTransaction,
): NotoSerializeResult {
  if (transaction.version !== NOTO_MARKDOWN_VERSION || document.version !== NOTO_MARKDOWN_VERSION) {
    return fail(document, 'UNSUPPORTED_VERSION', 'The editing contract version does not match.');
  }
  if (transaction.documentId !== document.documentId) {
    return fail(document, 'WRONG_DOCUMENT', 'This transaction belongs to a different document.');
  }
  if (transaction.revisionId !== document.revisionId) {
    return fail(document, 'STALE_REVISION',
      'This document changed since the editor loaded it. Reload before saving.');
  }

  if (transaction.mode === 'source') {
    if (transaction.expectedSourceSha256 !== document.envelope.sourceSha256) {
      return fail(document, 'STALE_REVISION', 'The full source edit was based on an older revision.');
    }
    const reparsed = parseDocument(transaction.sourceBytes);
    if (reparsed.status !== 'parsed') {
      return fail(document, 'INVALID_FULL_SOURCE', reparsed.message);
    }
    const outputBytes = transaction.sourceBytes.slice();
    return {
      status: 'serialized',
      version: NOTO_MARKDOWN_VERSION,
      outputBytes,
      outputSha256: sha256(outputBytes),
      // Same document, new revision, exactly as for a block save.
      document: { ...reparsed.document, documentId: document.documentId },
      preserved: [],
    };
  }

  return serializeBlocks(document, transaction.units);
}

/**
 * Build the no-op transaction for a document, which every save path can use as
 * a starting point and which must always reproduce the original bytes.
 */
export function identityTransaction(document: NotoDocument): NotoTransaction {
  return {
    version: NOTO_MARKDOWN_VERSION,
    mode: 'blocks',
    documentId: document.documentId,
    revisionId: document.revisionId,
    units: document.blocks.map((block) => ({ origin: block.origin, markdown: block.markdown })),
  };
}
