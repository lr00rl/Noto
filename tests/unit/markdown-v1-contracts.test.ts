import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { projectMarkdownV1, serializeMarkdownV1 } from '../../src/shared/markdown/v1/core';
import type { NotoBlockEditV1, NotoBlockIdV1, NotoDocumentIdV1, NotoRevisionIdV1 } from '../../src/shared/markdown/v1/contracts';

const fixtures = new URL('../fixtures/g002-v1/', import.meta.url);

function projected(bytes: Uint8Array) {
  const result = projectMarkdownV1(bytes);
  expect(result.status).toBe('projected');
  if (result.status !== 'projected') throw new Error(result.message);
  return result;
}

function totalCoverage(bytes: Uint8Array, slices: readonly { startByte: number; endByte: number; bytes: Uint8Array }[]) {
  expect(slices[0]?.startByte).toBe(0);
  expect(slices.at(-1)?.endByte).toBe(bytes.byteLength);
  for (let index = 0; index < slices.length; index += 1) {
    const slice = slices[index];
    expect(slice.endByte).toBeGreaterThan(slice.startByte);
    expect(slice.startByte).toBe(index === 0 ? 0 : slices[index - 1].endByte);
    expect(Buffer.from(slice.bytes).equals(Buffer.from(bytes.slice(slice.startByte, slice.endByte)))).toBe(true);
  }
}

describe('Noto Markdown v1 contracts and envelope', () => {
  for (const bom of [false, true]) for (const lineEnding of ['\n', '\r\n']) for (const finalNewline of [false, true]) {
    it(`accounts exactly for bom=${bom}, eol=${JSON.stringify(lineEnding)}, final=${finalNewline}`, () => {
      const prefix = bom ? Buffer.from([0xef, 0xbb, 0xbf]) : Buffer.alloc(0);
      const source = `# 标题${lineEnding}${lineEnding}正文${finalNewline ? lineEnding : ''}`;
      const bytes = Buffer.concat([prefix, Buffer.from(source)]);
      const result = projected(bytes);
      expect(result.document.envelope).toMatchObject({ bom: bom ? 'utf8' : 'none', lineEnding: lineEnding === '\n' ? 'lf' : 'crlf', hasFinalNewline: finalNewline, byteLength: bytes.byteLength });
      totalCoverage(bytes, result.document.slices);
      expect(serializeMarkdownV1(result.document, [])).toMatchObject({ status: 'serialized', outputSha256: result.document.envelope.sourceSha256 });
      const noEdit = serializeMarkdownV1(result.document, []);
      expect(noEdit.status === 'serialized' && Buffer.from(noEdit.outputBytes).equals(bytes)).toBe(true);
    });
  }

  it('falls back explicitly for mixed endings and invalid UTF-8 without success bytes', () => {
    const mixed = projectMarkdownV1(Buffer.from('a\r\n\r\nb\n'));
    expect(mixed).toMatchObject({ status: 'fallback', code: 'MIXED_LINE_ENDINGS', sourceOnly: true });
    expect(mixed.status === 'fallback' && Buffer.from(mixed.originalBytes).equals(Buffer.from('a\r\n\r\nb\n'))).toBe(true);
    const invalid = projectMarkdownV1(Uint8Array.from([0x61, 0xc3, 0x28]));
    expect(invalid).toMatchObject({ status: 'fallback', code: 'INVALID_UTF8', sourceOnly: true });
    expect('outputBytes' in invalid).toBe(false);
  });

  it('falls back explicitly for empty and whitespace-only bytes', () => {
    for (const bytes of [Buffer.alloc(0), Buffer.from('   \n\n'), Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('\r\n\t')])]) {
      const result = projectMarkdownV1(bytes);
      expect(result).toMatchObject({ status: 'fallback', code: 'EMPTY_DOCUMENT', sourceOnly: true });
      expect(result.status === 'fallback' && Buffer.from(result.originalBytes).equals(bytes)).toBe(true);
      expect('outputBytes' in result).toBe(false);
    }
  });

  it('is deterministic and keeps domain contracts free of vendor imports', async () => {
    const bytes = await readFile(new URL('cjk-inline.md', fixtures));
    const first = projected(bytes);
    const second = projected(bytes);
    expect(second).toEqual(first);
    const contracts = await readFile(new URL('../../src/shared/markdown/v1/contracts.ts', import.meta.url), 'utf8');
    expect(contracts).not.toMatch(/from ['"](?:@milkdown|prosemirror|remark|electron|node:)/);
    expect(contracts).not.toContain('Buffer');
  });

  it('rejects wrong, stale, unknown, duplicate, opaque, kind-changing, and semantic-mismatch edits exactly', async () => {
    const bytes = await readFile(new URL('frontmatter.md', fixtures));
    const result = projected(bytes);
    const paragraph = result.document.blocks.find((block) => block.kind === 'paragraph')!;
    const opaque = result.document.blocks.find((block) => !block.editable)!;
    const base = { version: 1, documentId: result.document.documentId, revisionId: result.document.revisionId, blockId: paragraph.id, expectedKind: paragraph.kind, markdown: '新的正文。', expectedSemanticKey: paragraph.semanticKey } as const;
    const cases: Array<[string, readonly NotoBlockEditV1[]]> = [
      ['WRONG_DOCUMENT', [{ ...base, documentId: 'wrong' as NotoDocumentIdV1 }]],
      ['STALE_REVISION', [{ ...base, revisionId: 'stale' as NotoRevisionIdV1 }]],
      ['UNKNOWN_BLOCK', [{ ...base, blockId: 'unknown' as NotoBlockIdV1 }]],
      ['DUPLICATE_BLOCK_EDIT', [base, base]],
      ['UNSUPPORTED_OPAQUE_EDIT', [{ ...base, blockId: opaque.id, expectedKind: opaque.kind }]],
      ['BLOCK_KIND_CHANGED', [{ ...base, expectedKind: 'heading' }]],
      ['SEMANTIC_MISMATCH', [base]],
    ];
    for (const [code, edits] of cases) {
      const failure = serializeMarkdownV1(result.document, edits);
      expect(failure).toMatchObject({ status: 'failed', code });
      expect(failure.status === 'failed' && Buffer.from(failure.originalBytes).equals(bytes)).toBe(true);
      expect('outputBytes' in failure).toBe(false);
    }
  });

  it('owns accepted bytes and rejects caller mutation without losing the accepted original', async () => {
    const bytes = await readFile(new URL('cjk-inline.md', fixtures));
    const originalMutation = projected(bytes);
    originalMutation.document.originalBytes[0] ^= 0x7f;
    const originalFailure = serializeMarkdownV1(originalMutation.document, []);
    expect(originalFailure).toMatchObject({ status: 'failed', code: 'DOCUMENT_INTEGRITY_FAILED' });
    expect(originalFailure.status === 'failed' && Buffer.from(originalFailure.originalBytes).equals(bytes)).toBe(true);
    expect('outputBytes' in originalFailure).toBe(false);

    const sliceMutation = projected(bytes);
    sliceMutation.document.slices[0].bytes[0] ^= 0x7f;
    const sliceFailure = serializeMarkdownV1(sliceMutation.document, []);
    expect(sliceFailure).toMatchObject({ status: 'failed', code: 'DOCUMENT_INTEGRITY_FAILED' });
    expect(sliceFailure.status === 'failed' && Buffer.from(sliceFailure.originalBytes).equals(bytes)).toBe(true);

    const source = Buffer.from(bytes);
    const sourceOwnership = projected(source);
    source.fill(0);
    const noEdit = serializeMarkdownV1(sourceOwnership.document, []);
    expect(noEdit.status === 'serialized' && Buffer.from(noEdit.outputBytes).equals(bytes)).toBe(true);
  });

  it('validates accepted envelope, offsets, hashes, relations, and identities before serialization', async () => {
    const bytes = await readFile(new URL('cjk-inline.md', fixtures));
    const mutations: Array<(document: any) => void> = [
      (document) => { document.envelope.sourceSha256 = '0'.repeat(64); },
      (document) => { document.slices[0].startByte = 1; },
      (document) => { document.slices[0].sha256 = '0'.repeat(64); },
      (document) => { document.slices[1].id = document.slices[0].id; },
      (document) => { document.blocks[0].sourceSliceId = document.slices.at(-1).id; },
      (document) => { document.blocks[1].id = document.blocks[0].id; },
      (document) => { document.blocks[0].semanticKey = '{}'; },
    ];
    for (const mutate of mutations) {
      const result = projected(bytes);
      mutate(result.document);
      const failure = serializeMarkdownV1(result.document, []);
      expect(failure).toMatchObject({ status: 'failed', code: 'DOCUMENT_INTEGRITY_FAILED' });
      expect(failure.status === 'failed' && Buffer.from(failure.originalBytes).equals(bytes)).toBe(true);
      expect('outputBytes' in failure).toBe(false);
    }
  });

  it('rejects every wrong runtime version with accepted bytes and no success output', async () => {
    const bytes = await readFile(new URL('cjk-inline.md', fixtures));
    const documentMutations: Array<(document: any) => void> = [
      (document) => { document.version = 2; },
      (document) => { document.envelope.version = 2; },
      (document) => { document.slices[0].version = 2; },
      (document) => { document.blocks[0].version = 2; },
    ];
    for (const mutate of documentMutations) {
      const result = projected(bytes);
      mutate(result.document);
      const failure = serializeMarkdownV1(result.document, []);
      expect(failure).toMatchObject({ status: 'failed', code: 'UNSUPPORTED_VERSION' });
      expect(failure.status === 'failed' && Buffer.from(failure.originalBytes).equals(bytes)).toBe(true);
      expect('outputBytes' in failure).toBe(false);
    }
    const result = projected(bytes);
    const block = result.document.blocks.find((candidate) => candidate.kind === 'paragraph')!;
    const semantic = projected(Buffer.from('changed')).document.blocks[0].semanticKey;
    const wrongEdit = { version: 2, documentId: result.document.documentId, revisionId: result.document.revisionId, blockId: block.id, expectedKind: block.kind, markdown: 'changed', expectedSemanticKey: semantic } as unknown as NotoBlockEditV1;
    const failure = serializeMarkdownV1(result.document, [wrongEdit]);
    expect(failure).toMatchObject({ status: 'failed', code: 'UNSUPPORTED_VERSION' });
    expect(failure.status === 'failed' && Buffer.from(failure.originalBytes).equals(bytes)).toBe(true);
    const acceptedEdit = serializeMarkdownV1(result.document, [{ ...wrongEdit, version: 1 }]);
    if (acceptedEdit.status !== 'serialized') throw new Error(acceptedEdit.message);
    (acceptedEdit.document as any).version = 2;
    const updatedFailure = serializeMarkdownV1(acceptedEdit.document, []);
    expect(updatedFailure).toMatchObject({ status: 'failed', code: 'UNSUPPORTED_VERSION' });
    expect(updatedFailure.status === 'failed' && Buffer.from(updatedFailure.originalBytes).equals(Buffer.from(acceptedEdit.outputBytes))).toBe(true);
  });

  it('models every trailing separator byte and rejects separator-bearing block edits without dropping input', () => {
    for (const lineEnding of ['\n', '\r\n']) for (const count of [2, 3]) {
      const bytes = Buffer.from(`first${lineEnding}${lineEnding}second${lineEnding.repeat(count)}`);
      const result = projected(bytes);
      const trailing = result.document.slices.at(-1)!;
      expect(trailing.role).toBe('gap');
      expect(Buffer.from(trailing.bytes).equals(Buffer.from(lineEnding.repeat(count)))).toBe(true);
      const block = result.document.blocks[1];
      const semantic = projected(Buffer.from('changed')).document.blocks[0].semanticKey;
      const success = serializeMarkdownV1(result.document, [{ version: 1, documentId: result.document.documentId, revisionId: result.document.revisionId, blockId: block.id, expectedKind: block.kind, markdown: 'changed', expectedSemanticKey: semantic }]);
      expect(success.status).toBe('serialized');
      expect(success.status === 'serialized' && Buffer.from(success.outputBytes).subarray(-Buffer.byteLength(lineEnding.repeat(count))).equals(Buffer.from(lineEnding.repeat(count)))).toBe(true);
      const rejected = serializeMarkdownV1(result.document, [{ version: 1, documentId: result.document.documentId, revisionId: result.document.revisionId, blockId: block.id, expectedKind: block.kind, markdown: `changed${lineEnding.repeat(count)}`, expectedSemanticKey: semantic }]);
      expect(rejected).toMatchObject({ status: 'failed', code: 'BLOCK_KIND_CHANGED' });
      expect(rejected.status === 'failed' && Buffer.from(rejected.originalBytes).equals(bytes)).toBe(true);
    }
  });
});
