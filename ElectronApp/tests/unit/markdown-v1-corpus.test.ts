import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { projectMarkdownV1, serializeMarkdownV1 } from '../../src/shared/markdown/v1/core';
import type { NotoBlockEditV1, NotoBlockKindV1, NotoMarkdownDocumentV1 } from '../../src/shared/markdown/v1/contracts';

const root = new URL('../fixtures/g002-v1/', import.meta.url);

type Fixture = {
  file: string;
  status: 'projected' | 'fallback';
  code?: string;
  blocks?: Array<{ kind: NotoBlockKindV1; editable: boolean }>;
  claims: string[];
};

function project(bytes: Uint8Array) {
  const result = projectMarkdownV1(bytes);
  if (result.status !== 'projected') throw new Error(`${result.code}: ${result.message}`);
  return result;
}

function editFor(document: NotoMarkdownDocumentV1, index: number, markdown: string): NotoBlockEditV1 {
  const semantic = project(Buffer.from(markdown)).document.blocks[0];
  const block = document.blocks[index];
  return { version: 1, documentId: document.documentId, revisionId: document.revisionId, blockId: block.id, expectedKind: block.kind, markdown, expectedSemanticKey: semantic.semanticKey };
}

const replacements: Record<Extract<NotoBlockKindV1, 'heading' | 'paragraph' | 'bullet-list' | 'ordered-list' | 'task-list' | 'quote' | 'callout' | 'fenced-code' | 'table' | 'display-math'>, string> = {
  heading: '## 新标题',
  paragraph: '新的 *段落* with **strong**、[链接](https://example.invalid/edited)、`code`、$x+y$ 和 ![图](edited.png)。',
  'bullet-list': '- 新项目\n  - nested\n- final',
  'ordered-list': '1. 新项目\n2. second',
  'task-list': '- [ ] 新任务\n- [x] done',
  quote: '> 新引用\n> continued',
  callout: '> [!WARNING]\n> 新 callout',
  'fenced-code': '~~~ts\nconst edited = true;\n~~~',
  table: '| A | B |\n| --- | ---: |\n| 新 | 2 |',
  'display-math': '$$\nx + y = z\n$$',
};

describe('versioned G002 v1 corpus', () => {
  it('asserts every manifest block kind, editability, opacity, fallback, and no-edit byte identity', async () => {
    const manifest = JSON.parse(await readFile(new URL('manifest.json', root), 'utf8')) as { version: number; fixtures: Fixture[] };
    expect(manifest.version).toBe(1);
    for (const fixture of manifest.fixtures) {
      const bytes = await readFile(new URL(fixture.file, root));
      const result = projectMarkdownV1(bytes);
      expect(result.status, fixture.file).toBe(fixture.status);
      if (result.status === 'fallback') {
        expect(result.code, fixture.file).toBe(fixture.code);
        expect(Buffer.from(result.originalBytes).equals(bytes)).toBe(true);
        expect('outputBytes' in result).toBe(false);
        continue;
      }
      expect(result.document.blocks.map(({ kind, editable }) => ({ kind, editable })), fixture.file).toEqual(fixture.blocks);
      for (const block of result.document.blocks.filter((candidate) => !candidate.editable)) {
        expect(block.semantic).toMatchObject({ type: 'opaque', executable: false });
        expect(block.projectionMarkdown).toMatch(/^:::noto-opaque/);
      }
      const output = serializeMarkdownV1(result.document, []);
      expect(output.status === 'serialized' && Buffer.from(output.outputBytes).equals(bytes), fixture.file).toBe(true);
      expect(result.projection.markdown).not.toContain('__NOTO_MUST_NOT_EXECUTE__');
    }
  });

  it('behaviorally edits every claimed editable kind with deterministic output and exact untouched proof', async () => {
    const manifest = JSON.parse(await readFile(new URL('manifest.json', root), 'utf8')) as { fixtures: Fixture[] };
    const exercised = new Set<NotoBlockKindV1>();
    for (const fixture of manifest.fixtures.filter((candidate) => candidate.status === 'projected')) {
      const bytes = await readFile(new URL(fixture.file, root));
      const result = project(bytes);
      for (let index = 0; index < result.document.blocks.length; index += 1) {
        const block = result.document.blocks[index];
        if (!block.editable || exercised.has(block.kind)) continue;
        const replacement = replacements[block.kind as keyof typeof replacements];
        expect(replacement, `missing behavioral replacement for ${block.kind}`).toBeTypeOf('string');
        const edit = editFor(result.document, index, replacement);
        const first = serializeMarkdownV1(result.document, [edit]);
        const second = serializeMarkdownV1(result.document, [edit]);
        expect(first, block.kind).toEqual(second);
        expect(first).toMatchObject({ status: 'serialized', deterministic: true, semanticReparseEquivalent: true, editedBlockId: block.id, editedBlockIdentityPolicy: 'preserved-within-document-v1' });
        if (first.status !== 'serialized') throw new Error(first.message);
        expect(first.document.documentId).toBe(result.document.documentId);
        expect(first.document.revisionId).not.toBe(result.document.revisionId);
        expect(first.document.blocks[index].id).toBe(block.id);
        expect(first.untouchedSlices).toHaveLength(result.document.slices.length - 1);
        for (const proof of first.untouchedSlices) {
          const before = result.document.slices.find((slice) => slice.id === proof.sliceId)!;
          const after = first.document.slices.find((slice) => slice.id === proof.sliceId)!;
          expect(Buffer.from(after.bytes).equals(Buffer.from(before.bytes))).toBe(true);
          expect(proof).toEqual({ sliceId: before.id, beforeSha256: before.sha256, afterSha256: before.sha256, byteIdentical: true });
        }
        expect(first.document.blocks.filter((_, blockIndex) => blockIndex !== index).map((candidate) => candidate.id))
          .toEqual(result.document.blocks.filter((_, blockIndex) => blockIndex !== index).map((candidate) => candidate.id));
        exercised.add(block.kind);
      }
    }
    expect(exercised).toEqual(new Set(Object.keys(replacements)));
  });

  it('durably represents the claimed inline tokens and nested-list depth', async () => {
    const inlineDocument = project(await readFile(new URL('cjk-inline.md', root))).document;
    const paragraph = inlineDocument.blocks.find((block) => block.kind === 'paragraph')!;
    expect(paragraph.semantic).toEqual({
      type: 'paragraph',
      inline: [
        { type: 'text', value: '这是 ' },
        { type: 'emphasis', value: '强调' },
        { type: 'text', value: '、' },
        { type: 'strong', value: '加粗' },
        { type: 'text', value: '、' },
        { type: 'link', label: '链接', destination: 'https://example.invalid' },
        { type: 'text', value: '、' },
        { type: 'code', value: '代码' },
        { type: 'text', value: '、' },
        { type: 'math', value: 'E=mc^2' },
        { type: 'text', value: ' 和 ' },
        { type: 'image', label: '图片', destination: 'asset.png' },
        { type: 'text', value: '。' },
      ],
    });
    const listDocument = project(await readFile(new URL('bullet-list.md', root))).document;
    const list = listDocument.blocks[0];
    expect(list.semantic).toMatchObject({ type: 'list', ordered: false, task: false, itemCount: 3, maxDepth: 2 });
    expect(list.semantic.type === 'list' && list.semantic.source).toContain('  - 嵌套');
  });

  it('keeps multiline raw HTML and comments indivisible and rejects opaque edits', async () => {
    for (const tag of ['script', 'style', 'pre', 'textarea']) {
      const bytes = Buffer.from(`<${tag}>\nbody\n\n# not editable\n</${tag}>\n`);
      const result = project(bytes);
      expect(result.document.blocks).toHaveLength(1);
      expect(result.document.blocks[0]).toMatchObject({ kind: 'html', editable: false, semantic: { type: 'opaque', syntax: 'html', executable: false } });
      expect(serializeMarkdownV1(result.document, []).status === 'serialized').toBe(true);
      const block = result.document.blocks[0];
      const rejected = serializeMarkdownV1(result.document, [{ version: 1, documentId: result.document.documentId, revisionId: result.document.revisionId, blockId: block.id, expectedKind: block.kind, markdown: 'replacement', expectedSemanticKey: block.semanticKey }]);
      expect(rejected).toMatchObject({ status: 'failed', code: 'UNSUPPORTED_OPAQUE_EDIT' });
      expect(rejected.status === 'failed' && Buffer.from(rejected.originalBytes).equals(bytes)).toBe(true);
    }
    const commentBytes = Buffer.from('<!-- begin\n\n# not editable\nend -->\n');
    const comment = project(commentBytes);
    expect(comment.document.blocks).toHaveLength(1);
    expect(comment.document.blocks[0]).toMatchObject({ kind: 'html', editable: false });
    for (const source of ['<script>\nbody\n\n# hidden', '<style>\nbody', '<pre>\nbody', '<textarea>\nbody', '<!--\nbody\n\n# hidden']) {
      const fallback = projectMarkdownV1(Buffer.from(source));
      expect(fallback).toMatchObject({ status: 'fallback', code: 'MALFORMED_BOUNDARY', sourceOnly: true });
      expect(fallback.status === 'fallback' && Buffer.from(fallback.originalBytes).equals(Buffer.from(source))).toBe(true);
    }
  });

  it('returns a coherent accepted document for a second sequential edit', async () => {
    const original = project(Buffer.from('# First\n\nParagraph one.\n\n- item\n'));
    const first = serializeMarkdownV1(original.document, [editFor(original.document, 0, '# Second')]);
    if (first.status !== 'serialized') throw new Error(first.message);
    const second = serializeMarkdownV1(first.document, [editFor(first.document, 1, 'Paragraph two.')]);
    expect(second).toMatchObject({ status: 'serialized', documentId: original.document.documentId, fromRevisionId: first.document.revisionId });
    if (second.status !== 'serialized') throw new Error(second.message);
    expect(second.document.revisionId).not.toBe(first.document.revisionId);
    expect(second.document.blocks.map((block) => block.id)).toEqual(original.document.blocks.map((block) => block.id));
    expect(Buffer.from(second.outputBytes).toString()).toBe('# Second\n\nParagraph two.\n\n- item\n');
  });

  it('never drops bytes under bounded truncation and mutation', async () => {
    const original = await readFile(new URL('fences.md', root));
    const candidates: Buffer[] = [];
    for (let end = 1; end <= original.length; end += 7) candidates.push(original.subarray(0, end));
    for (let index = 0; index < original.length; index += 11) {
      const mutated = Buffer.from(original);
      mutated[index] ^= 0x7f;
      candidates.push(mutated);
    }
    for (const bytes of candidates) {
      const result = projectMarkdownV1(bytes);
      if (result.status === 'fallback') expect(Buffer.from(result.originalBytes).equals(bytes)).toBe(true);
      else {
        expect(Buffer.concat(result.document.slices.map((slice) => Buffer.from(slice.bytes))).equals(bytes)).toBe(true);
        const noEdit = serializeMarkdownV1(result.document, []);
        expect(noEdit.status === 'serialized' && Buffer.from(noEdit.outputBytes).equals(bytes)).toBe(true);
      }
    }
  });
});
