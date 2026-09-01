import { describe, expect, it } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import type { Node as ProseNode } from 'prosemirror-model';
import { notoSchema } from '../../src/shared/markdown/v3/pm/schema';
import { docFromSpans } from '../../src/shared/markdown/v3/pm/from-mdast';
import { splitBlocks } from '../../src/shared/markdown/v3/blocks';
import { parseDocument, toWire } from '../../src/shared/markdown/v3/document';
import { toLf } from '../../src/shared/markdown/v3/line-endings';
import { serializeDocument } from '../../src/shared/markdown/v3/serialize';
import type { NotoDocument } from '../../src/shared/markdown/v3/contracts';
import { captureTransaction, type PristineBlock } from '../../src/renderer/editor/noto/capture';
import { createOriginPlugin, getBlockOrigins, rebaseOrigins } from '../../src/renderer/editor/noto/origin-plugin';

const encoder = new TextEncoder();

function documentOf(source: string): NotoDocument {
  const result = parseDocument(encoder.encode(source));
  if (result.status !== 'parsed') throw new Error(`parse failed: ${result.code}`);
  return result.document;
}

/** Build editor state the way NotoEditor does, without needing a DOM. */
function editorFrom(document: NotoDocument) {
  const wire = toWire(document);
  const spans = splitBlocks(wire.text).spans;
  const doc = docFromSpans(spans);
  const pristine = new Map<string, PristineBlock>();
  doc.forEach((node, _offset, index) => {
    const origin = wire.origins[index];
    const span = spans[index];
    if (origin && span) pristine.set(origin.blockId, { node, markdown: toLf(span.markdown) });
  });
  const state = EditorState.create({ doc, plugins: [createOriginPlugin(wire.origins)] });
  return { document, wire, state, pristine };
}

function editorFor(source: string) {
  return editorFrom(documentOf(source));
}

function capture(context: ReturnType<typeof editorFor>, state = context.state) {
  return captureTransaction({
    doc: state.doc,
    origins: getBlockOrigins(state),
    document: context.wire,
    pristine: context.pristine,
  });
}

/** Byte offset of the first text position inside top level block `index`. */
function positionInBlock(doc: ProseNode, index: number): number {
  let position = 0;
  for (let current = 0; current < index; current += 1) position += doc.child(current).nodeSize;
  return position + 1;
}

describe('capture reuses untouched blocks instead of re-serializing', () => {
  it('reports every block as reused when nothing was edited', () => {
    const context = editorFor('# Title\n\nBody text.\n\n- a\n- b\n');
    const { stats, transaction } = capture(context);
    expect(stats).toEqual({ reused: 3, serialized: 0 });
    if (transaction.mode !== 'blocks') throw new Error('expected a block transaction');
    // An unedited save carries no text at all: every block is left to its
    // origin, so the transaction stays small no matter how large the file is.
    expect(transaction.units.map((unit) => unit.markdown)).toEqual([null, null, null]);
    expect(transaction.units.map((unit) => unit.origin?.ordinal)).toEqual([0, 1, 2]);
  });

  it('serializes only the block that changed', () => {
    const context = editorFor('# Title\n\nBody text.\n\n- a\n- b\n');
    const at = positionInBlock(context.state.doc, 1);
    const state = context.state.apply(context.state.tr.insertText('Edited ', at));

    const { stats, transaction } = capture(context, state);
    expect(stats).toEqual({ reused: 2, serialized: 1 });
    if (transaction.mode !== 'blocks') throw new Error('expected a block transaction');
    // Only the edited block carries text. The other two reference their origin.
    expect(transaction.units[1].markdown).toBe('Edited Body text.');
    expect(transaction.units[0].markdown).toBeNull();
    expect(transaction.units[2].markdown).toBeNull();
  });

  it('stays proportional to the edit, not the document, on a large file', () => {
    const source = `${Array.from({ length: 400 }, (_, index) => `Paragraph number ${index}.`).join('\n\n')}\n`;
    const context = editorFor(source);
    expect(context.document.blocks).toHaveLength(400);

    const at = positionInBlock(context.state.doc, 200);
    const state = context.state.apply(context.state.tr.insertText('X', at));

    const { stats } = capture(context, state);
    expect(stats).toEqual({ reused: 399, serialized: 1 });
  });
});

describe('capture feeds a byte exact save', () => {
  it('reproduces the original bytes when nothing was edited', () => {
    const source = '# Title\n\nBody.\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\n```ts\nconst a = 1;\n```\n';
    const context = editorFor(source);
    const result = serializeDocument(context.document, capture(context).transaction);
    expect(result.status).toBe('serialized');
    if (result.status !== 'serialized') return;
    expect(Buffer.from(result.outputBytes).toString('utf8')).toBe(source);
  });

  it('keeps the untouched table and fence byte identical after editing a paragraph', () => {
    const source = '# Title\n\nBody.\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\n```ts\nconst a = 1;\n```\n';
    const context = editorFor(source);
    const at = positionInBlock(context.state.doc, 1);
    const state = context.state.apply(context.state.tr.insertText('New ', at));

    const result = serializeDocument(context.document, capture(context, state).transaction);
    expect(result.status).toBe('serialized');
    if (result.status !== 'serialized') return;
    const output = Buffer.from(result.outputBytes).toString('utf8');
    expect(output).toBe('# Title\n\nNew Body.\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\n```ts\nconst a = 1;\n```\n');
  });

  it('round trips a CRLF document with a BOM after an edit', () => {
    const source = '# Title\r\n\r\nBody.\r\n';
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...encoder.encode(source)]);
    const parsedResult = parseDocument(bytes);
    if (parsedResult.status !== 'parsed') throw new Error('parse failed');

    const context = editorFrom(parsedResult.document);
    const edited = context.state.apply(
      context.state.tr.insertText('New ', positionInBlock(context.state.doc, 1)),
    );

    const result = serializeDocument(context.document, capture(context, edited).transaction);

    expect(result.status).toBe('serialized');
    if (result.status !== 'serialized') return;
    const output = Buffer.from(result.outputBytes);
    expect(output[0]).toBe(0xef);
    expect(output.toString('utf8').slice(1)).toBe('# Title\r\n\r\nNew Body.\r\n');
  });
});

describe('block origins survive editing', () => {
  it('keeps origins aligned when a block is edited in place', () => {
    const context = editorFor('# One\n\n# Two\n\n# Three\n');
    const at = positionInBlock(context.state.doc, 1);
    const state = context.state.apply(context.state.tr.insertText('X', at));

    const origins = getBlockOrigins(state);
    expect(origins.map((origin) => origin?.ordinal ?? null)).toEqual([0, 1, 2]);
  });

  it('drops the origin of a deleted block and shifts the rest', () => {
    const context = editorFor('# One\n\n# Two\n\n# Three\n');
    const doc = context.state.doc;
    const start = positionInBlock(doc, 1) - 1;
    const end = start + doc.child(1).nodeSize;
    const state = context.state.apply(context.state.tr.delete(start, end));

    const origins = getBlockOrigins(state);
    expect(origins).toHaveLength(2);
    expect(origins.map((origin) => origin?.ordinal ?? null)).toEqual([0, 2]);
  });

  it('gives a newly inserted block no origin, so it is serialized fresh', () => {
    const context = editorFor('# One\n\n# Two\n');
    const doc = context.state.doc;
    const insertAt = doc.child(0).nodeSize;
    const paragraph = notoSchema.nodes.paragraph.create(null, notoSchema.text('Inserted.'));
    const state = context.state.apply(context.state.tr.insert(insertAt, paragraph));

    const origins = getBlockOrigins(state);
    expect(origins.map((origin) => origin?.ordinal ?? null)).toEqual([0, null, 1]);

    const { stats, transaction } = capture(context, state);
    expect(stats).toEqual({ reused: 2, serialized: 1 });
    if (transaction.mode !== 'blocks') throw new Error('expected a block transaction');
    expect(transaction.units[1]).toEqual({ origin: null, markdown: 'Inserted.' });
  });

  it('rebases origins onto a freshly saved document without touching content', () => {
    const context = editorFor('# One\n\n# Two\n');
    const at = positionInBlock(context.state.doc, 0);
    const edited = context.state.apply(context.state.tr.insertText('X', at));

    const result = serializeDocument(context.document, capture(context, edited).transaction);
    expect(result.status).toBe('serialized');
    if (result.status !== 'serialized') return;

    const saved = result.document;
    const rebased = edited.apply(rebaseOrigins(edited.tr, saved.blocks.map((block) => block.origin)));

    expect(getBlockOrigins(rebased).map((origin) => origin?.blockId ?? null))
      .toEqual(saved.blocks.map((block) => block.id));
    expect(rebased.doc.eq(edited.doc)).toBe(true);
  });

  it('survives a selection-only transaction unchanged', () => {
    const context = editorFor('# One\n\n# Two\n');
    const before = getBlockOrigins(context.state);
    const state = context.state.apply(
      context.state.tr.setSelection(TextSelection.create(context.state.doc, positionInBlock(context.state.doc, 1))),
    );
    expect(getBlockOrigins(state)).toEqual(before);
  });
});
