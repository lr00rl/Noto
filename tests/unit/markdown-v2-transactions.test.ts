import { describe, expect, it } from 'vitest';
import { projectMarkdownV2, serializeMarkdownV2 } from '../../src/shared/markdown/v2/core';
import type { NotoEditingProjectionV2, NotoTransactionBlockV2 } from '../../src/shared/markdown/v2/contracts';

const bytes = (value: string) => new TextEncoder().encode(value);
function projected(source: string): NotoEditingProjectionV2 {
  const value = projectMarkdownV2(bytes(source));
  if ('status' in value) throw new Error(value.message);
  return value;
}
function blocks(value: NotoEditingProjectionV2): NotoTransactionBlockV2[] {
  return value.blocks.map((block) => ({ origin: block.origin, markdown: block.markdown }));
}
function transact(value: NotoEditingProjectionV2, next: readonly NotoTransactionBlockV2[]) {
  return serializeMarkdownV2(value, { version: 2, mode: 'blocks', documentId: value.documentId,
    revisionId: value.revisionId, blocks: next });
}

describe('Noto Markdown editing v2 transactions', () => {
  it('projects exact source bytes including BOM and CRLF', () => {
    const source = '\ufeff# Title\r\n\r\nParagraph.\r\n';
    const value = projected(source);
    expect(Buffer.from(value.sourceBytes)).toEqual(Buffer.from(source));
  });

  it('keeps a no-edit transaction byte-identical including BOM, CRLF, gaps, and final newline', () => {
    const source = '\ufeff# Title\r\n\r\nParagraph.\r\n';
    const value = projected(source);
    expect(Buffer.from(value.sourceBytes)).toEqual(Buffer.from(source));
    const result = transact(value, blocks(value));
    expect(result.status).toBe('serialized');
    if (result.status !== 'serialized') return;
    expect(Buffer.from(result.outputBytes)).toEqual(Buffer.from(source));
    expect(result.preservedSlices.length).toBeGreaterThanOrEqual(4);
  });

  it('applies two disjoint changes while preserving the unaffected middle block and adjacent gaps', () => {
    const value = projected('# One\n\nMiddle exact.\n\nLast old.\n');
    const next = blocks(value);
    next[0] = { origin: next[0].origin, markdown: '# Changed' };
    next[2] = { origin: next[2].origin, markdown: 'Last changed.' };
    const result = transact(value, next);
    expect(result.status).toBe('serialized');
    if (result.status !== 'serialized') return;
    expect(new TextDecoder().decode(result.outputBytes)).toBe('# Changed\n\nMiddle exact.\n\nLast changed.\n');
    expect(result.preservedSlices.some((proof) => proof.role === 'block' && proof.sliceId.includes(':b2:'))).toBe(true);
    expect(result.projection.blocks[1].id).toBe(value.blocks[1].id);
    expect(result.projection.blocks[0].id).toBe(value.blocks[0].id);
    expect(result.projection.blocks[0].origin.blockId).not.toBe(value.blocks[0].origin.blockId);
    expect(result.projection.blocks[1].origin.blockId).toBe(value.blocks[1].origin.blockId);
    const followUp = blocks(result.projection);
    followUp[1] = { origin: followUp[1].origin, markdown: 'Middle changed after rebase.' };
    expect(transact(result.projection, followUp)).toMatchObject({ status: 'serialized' });
  });

  it('uses newly accepted origins for a second save after an edited block checkpoint', () => {
    const firstProjection = projected('# Title\n\nFirst paragraph.\n\nSecond paragraph.\n');
    const firstBlocks = blocks(firstProjection);
    firstBlocks[1] = { origin: firstBlocks[1].origin, markdown: 'First paragraph saved.' };
    const first = transact(firstProjection, firstBlocks);
    expect(first.status).toBe('serialized');
    if (first.status !== 'serialized') return;
    const secondBlocks = blocks(first.projection);
    secondBlocks[1] = { origin: secondBlocks[1].origin, markdown: 'First paragraph saved again.' };
    const second = transact(first.projection, secondBlocks);
    expect(second.status).toBe('serialized');
    if (second.status !== 'serialized') return;
    expect(new TextDecoder().decode(second.outputBytes)).toContain('First paragraph saved again.');
    expect(second.projection.documentId).toBe(first.projection.documentId);
    expect(second.projection.blocks.map((block) => block.id)).toEqual(first.projection.blocks.map((block) => block.id));
  });

  it('supports insert, delete, split, merge, and kind change with deterministic output', () => {
    const value = projected('# Title\n\nAlpha.\n\nBeta.\n\nGamma.\n');
    const original = blocks(value);
    const next: NotoTransactionBlockV2[] = [
      { origin: original[0].origin, markdown: 'Title changed kind.' },
      { origin: original[1].origin, markdown: 'Alpha first.' },
      { origin: null, markdown: 'Alpha second.' },
      { origin: original[2].origin, markdown: 'Beta merged with gamma.' },
    ];
    const first = transact(value, next);
    const second = transact(value, next);
    expect(first.status).toBe('serialized');
    expect(second.status).toBe('serialized');
    if (first.status !== 'serialized' || second.status !== 'serialized') return;
    expect(Buffer.from(first.outputBytes)).toEqual(Buffer.from(second.outputBytes));
    expect(first.projection.blocks.map((block) => block.kind)).toEqual(['paragraph', 'paragraph', 'paragraph', 'paragraph']);
  });

  it.each([
    ['raw HTML', '<section>raw</section>'],
    ['custom extension', ':::custom\nopaque\n:::'],
    ['task list', '- [ ] task'],
    ['table', '| A |\n|---|\n| B |'],
    ['display math', '$$\nx\n$$'],
  ])('requires the full-source boundary for an origin-null %s insertion', (_label, markdown) => {
    const value = projected('Seed.\n');
    expect(transact(value, [{ origin: null, markdown }]))
      .toMatchObject({ status: 'failed', code: 'OPAQUE_SOURCE_INSERTED' });

    const source = serializeMarkdownV2(value, { version: 2, mode: 'source', documentId: value.documentId,
      revisionId: value.revisionId, expectedSourceSha256: value.envelope.sourceSha256,
      sourceBytes: bytes(markdown) });
    expect(source).toMatchObject({ status: 'serialized' });
    if (source.status === 'serialized') expect(Buffer.from(source.outputBytes)).toEqual(Buffer.from(markdown));
  });

  it.each([
    ['paragraph', 'Inserted paragraph.'],
    ['heading', '## Inserted heading'],
    ['bullet list', '- first\n- second'],
    ['ordered list', '1. first\n2. second'],
    ['quote', '> Inserted quote'],
    ['fenced code', '```ts\nconst inserted = true;\n```'],
  ])('keeps origin-null editable %s insertions in blocks mode', (_label, markdown) => {
    const value = projected('Seed.\n');
    expect(transact(value, [...blocks(value), { origin: null, markdown }]))
      .toMatchObject({ status: 'serialized' });
  });

  it('keeps task, table, math, callout, and unknown syntax source-only at this layer', () => {
    const value = projected('- [ ] task\n\n> [!NOTE]\n> callout\n\n| A |\n|---|\n| B |\n\n$$\nx\n$$\n\n??? unknown\n');
    expect(value.blocks.map(({ kind, editable }) => ({ kind, editable }))).toEqual([
      { kind: 'task-list', editable: false }, { kind: 'callout', editable: false },
      { kind: 'table', editable: false }, { kind: 'display-math', editable: false },
      { kind: 'unsupported', editable: false },
    ]);
    const next = blocks(value);
    next[0] = { origin: next[0].origin, markdown: '- [x] changed' };
    expect(transact(value, next)).toMatchObject({ status: 'failed', code: 'OPAQUE_SOURCE_CHANGED' });
  });

  it('rejects forged, stale, duplicate, and reordered origins', () => {
    const value = projected('# A\n\nB.\n\nC.\n');
    const original = blocks(value);
    expect(transact(value, [{ ...original[0], origin: { ...original[0].origin!, semanticKey: 'forged' } }]))
      .toMatchObject({ status: 'failed', code: 'FORGED_ORIGIN' });
    expect(serializeMarkdownV2(value, { version: 2, mode: 'blocks', documentId: value.documentId,
      revisionId: 'stale' as typeof value.revisionId, blocks: original })).toMatchObject({ status: 'failed', code: 'STALE_REVISION' });
    expect(transact(value, [original[0], original[0]])).toMatchObject({ status: 'failed', code: 'DUPLICATE_ORIGIN' });
    expect(transact(value, [original[2], original[0]])).toMatchObject({ status: 'failed', code: 'REORDERED_ORIGIN' });
  });

  it('allows explicit full-source replacement of opaque constructs and rejects stale source hashes', () => {
    const value = projected('---\nkey: old\n---\n\nText.\n');
    const result = serializeMarkdownV2(value, { version: 2, mode: 'source', documentId: value.documentId,
      revisionId: value.revisionId, expectedSourceSha256: value.envelope.sourceSha256,
      sourceBytes: bytes('---\nkey: new\n---\n\nText.\n') });
    expect(result.status).toBe('serialized');
    expect(serializeMarkdownV2(value, { version: 2, mode: 'source', documentId: value.documentId,
      revisionId: value.revisionId, expectedSourceSha256: 'stale', sourceBytes: bytes('Text.\n') }))
      .toMatchObject({ status: 'failed', code: 'STALE_REVISION' });
  });
});
