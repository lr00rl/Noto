import { describe, expect, it } from 'vitest';
import { parseDocument } from '../../src/shared/markdown/v3/document';
import { serializeDocument } from '../../src/shared/markdown/v3/serialize';
import { verificationWindows } from '../../src/shared/markdown/v3/incremental';
import {
  NOTO_MARKDOWN_VERSION,
  type NotoDocument,
  type NotoTransaction,
} from '../../src/shared/markdown/v3/contracts';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function parsed(source: string): NotoDocument {
  const result = parseDocument(encoder.encode(source));
  if (result.status !== 'parsed') throw new Error(`fixture did not parse: ${result.code}`);
  return result.document;
}

/** A transaction that rewrites the block at `ordinal` and leaves the rest. */
function editing(document: NotoDocument, edits: ReadonlyMap<number, string>): NotoTransaction {
  return {
    version: NOTO_MARKDOWN_VERSION,
    mode: 'blocks',
    envelope: { lineEnding: 'mixed' as const, hasFinalNewline: true },
    documentId: document.documentId,
    revisionId: document.revisionId,
    units: document.blocks.map((block, ordinal) => ({
      origin: block.origin,
      markdown: edits.get(ordinal) ?? null,
    })),
  };
}

function serialized(document: NotoDocument, transaction: NotoTransaction) {
  const result = serializeDocument(document, transaction);
  if (result.status !== 'serialized') throw new Error(`serialize failed: ${result.code}: ${result.message}`);
  return result;
}

/**
 * The revision the serializer assembled must match the one a full parse of the
 * same bytes would produce. This is the safety net for skipping that parse: if
 * the two ever disagree, the shortcut is wrong.
 */
function expectMatchesFullParse(document: NotoDocument, transaction: NotoTransaction): void {
  const result = serialized(document, transaction);
  const full = parseDocument(result.outputBytes);
  if (full.status !== 'parsed') throw new Error('output did not reparse');

  const assembled = result.document;
  const reference = full.document;

  expect(assembled.text).toBe(reference.text);
  expect(assembled.leading).toBe(reference.leading);
  expect(assembled.trailing).toBe(reference.trailing);
  expect(assembled.gaps).toEqual(reference.gaps);
  expect(assembled.envelope).toEqual(reference.envelope);
  expect(assembled.revisionId).toBe(reference.revisionId);
  // Every block must agree on identity, kind, text and where it sits.
  expect(assembled.blocks).toEqual(reference.blocks);
}

const MIXED = [
  '# Title',
  '',
  'First paragraph.',
  '',
  '```ts',
  'const x = 1;',
  '```',
  '',
  '| a | b |',
  '| --- | --- |',
  '| 1 | 2 |',
  '',
  '- one',
  '- two',
  '',
  '> A quote.',
  '',
  '$$',
  'x = y',
  '$$',
  '',
  'Last paragraph.',
  '',
].join('\n');

describe('an assembled revision matches a full parse', () => {
  it('for an edit in the middle', () => {
    const document = parsed(MIXED);
    expectMatchesFullParse(document, editing(document, new Map([[2, 'Edited paragraph.']])));
  });

  it('for an edit to the first block', () => {
    const document = parsed(MIXED);
    expectMatchesFullParse(document, editing(document, new Map([[0, '# Renamed title']])));
  });

  it('for an edit to the last block', () => {
    const document = parsed(MIXED);
    const last = document.blocks.length - 1;
    expectMatchesFullParse(document, editing(document, new Map([[last, 'Rewritten ending.']])));
  });

  it('for edits to adjacent blocks', () => {
    const document = parsed(MIXED);
    expectMatchesFullParse(document, editing(document, new Map([
      [1, 'Changed one.'],
      [2, 'Changed two.'],
    ])));
  });

  it('for edits far apart, which produce separate windows', () => {
    const document = parsed(MIXED);
    const last = document.blocks.length - 1;
    expectMatchesFullParse(document, editing(document, new Map([
      [0, '## Demoted title'],
      [last, 'Different ending.'],
    ])));
  });

  it('for an edit that changes a block kind', () => {
    const document = parsed(MIXED);
    // A paragraph becomes a heading, so its kind and semantic key both change.
    expectMatchesFullParse(document, editing(document, new Map([[2, '### Now a heading']])));
  });

  it('for a document with CRLF line endings', () => {
    const document = parsed(MIXED.replaceAll('\n', '\r\n'));
    expectMatchesFullParse(document, editing(document, new Map([[2, 'Edited paragraph.']])));
  });

  it('for a document with a byte order mark', () => {
    const withBom = new Uint8Array([0xEF, 0xBB, 0xBF, ...encoder.encode(MIXED)]);
    const result = parseDocument(withBom);
    if (result.status !== 'parsed') throw new Error('bom fixture did not parse');
    expectMatchesFullParse(result.document, editing(result.document, new Map([[2, 'Edited.']])));
  });

  it('for a document with no trailing newline', () => {
    const document = parsed(MIXED.trimEnd());
    expectMatchesFullParse(document, editing(document, new Map([[2, 'Edited paragraph.']])));
  });

  it('for a document with frontmatter', () => {
    const document = parsed(`---\ntitle: Note\n---\n\n# Heading\n\nBody.\n`);
    expectMatchesFullParse(document, editing(document, new Map([[2, 'Changed body.']])));
  });

  it('for every single block edit in the document, one at a time', () => {
    const document = parsed(MIXED);
    for (let ordinal = 0; ordinal < document.blocks.length; ordinal += 1) {
      const replacement = `Replacement for block ${ordinal}.`;
      expectMatchesFullParse(document, editing(document, new Map([[ordinal, replacement]])));
    }
  });
});

describe('the windowed check still catches damage', () => {
  it('refuses an unterminated fence that would swallow what follows', () => {
    const document = parsed(MIXED);
    const result = serializeDocument(document, editing(document, new Map([[4, '```ts\nconst x = 1;']])));
    expect(result.status).toBe('failed');
    if (result.status !== 'failed') throw new Error('expected failure');
    expect(result.code).toBe('REPARSE_MISMATCH');
  });

  it('widens the gap rather than letting two blocks merge', () => {
    // A heading turned into plain text would absorb the paragraph beneath it,
    // so the serializer separates them instead of writing a merge. Refusing
    // would be the safe answer; this is the better one, and the windowed check
    // still confirms the result reparses as two blocks.
    const document = parsed('# Heading\nParagraph directly beneath.\n');
    const result = serialized(document, editing(document, new Map([[0, 'No longer a heading']])));
    expect(decoder.decode(result.outputBytes))
      .toBe('No longer a heading\n\nParagraph directly beneath.\n');
    expect(result.document.blocks).toHaveLength(2);
  });

  it('leaves an untouched document byte identical', () => {
    const document = parsed(MIXED);
    const result = serialized(document, editing(document, new Map()));
    expect(decoder.decode(result.outputBytes)).toBe(MIXED);
  });

  it('rewrites only the edited block and preserves the others byte for byte', () => {
    const document = parsed(MIXED);
    // Ordinal 1 is the first paragraph; ordinal 2 is the code fence.
    const result = serialized(document, editing(document, new Map([[1, 'Edited paragraph.']])));
    const output = decoder.decode(result.outputBytes);
    expect(output).toBe(MIXED.replace('First paragraph.', 'Edited paragraph.'));
  });
});

describe('choosing which windows to reparse', () => {
  it('covers a change and one neighbour on each side', () => {
    expect(verificationWindows([false, false, true, false, false]))
      .toEqual([{ from: 1, to: 3 }]);
  });

  it('reparses nothing when nothing changed', () => {
    expect(verificationWindows([false, false, false])).toEqual([]);
  });

  it('merges changes that are close together into one window', () => {
    expect(verificationWindows([true, true, false, false])).toEqual([{ from: 0, to: 2 }]);
    // One clean block between two changes still merges, since the windows touch.
    expect(verificationWindows([true, false, true, false, false]))
      .toEqual([{ from: 0, to: 3 }]);
  });

  it('keeps distant changes as separate windows', () => {
    expect(verificationWindows([true, false, false, false, false, true]))
      .toEqual([{ from: 0, to: 1 }, { from: 4, to: 5 }]);
  });

  it('clamps at the edges of the document', () => {
    expect(verificationWindows([true])).toEqual([{ from: 0, to: 0 }]);
  });
});
