import { describe, expect, it } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import type { Command } from 'prosemirror-state';
import { splitBlocks } from '../../src/shared/markdown/v3/blocks';
import { docFromSpans } from '../../src/shared/markdown/v3/pm/from-mdast';
import { blockToMarkdown } from '../../src/shared/markdown/v3/pm/to-mdast';
import { moveBlock, moveColumn, moveLine } from '../../src/renderer/editor/noto/move-block';

function stateFor(markdown: string, from: number): EditorState {
  const state = EditorState.create({ doc: docFromSpans(splitBlocks(markdown).spans) });
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, from)));
}

/** Run the command and give back the whole document as markdown, or null if it declined. */
function run(state: EditorState, command: Command): string | null {
  let next: EditorState | null = null;
  const handled = command(state, (tr) => { next = state.apply(tr); });
  if (!handled || next === null) return null;
  const doc = (next as EditorState).doc;
  const blocks: string[] = [];
  doc.forEach((child) => blocks.push(blockToMarkdown(child)));
  return blocks.join('\n\n');
}

/** The caret's position after the command, so the test can say it followed the text. */
function caretAfter(state: EditorState, command: Command): number | null {
  let next: EditorState | null = null;
  command(state, (tr) => { next = state.apply(tr); });
  return next === null ? null : (next as EditorState).selection.from;
}

/** The offset of `needle` inside the document, as a caret position. */
function at(markdown: string, needle: string): number {
  const state = EditorState.create({ doc: docFromSpans(splitBlocks(markdown).spans) });
  let found = -1;
  state.doc.descendants((node, pos) => {
    if (found >= 0 || !node.isText) return true;
    const index = node.text!.indexOf(needle);
    if (index >= 0) found = pos + index;
    return true;
  });
  if (found < 0) throw new Error(`no "${needle}" in the document`);
  return found;
}

describe('moving a line of code', () => {
  it('swaps it with the one above or below, keeping the column', () => {
    expect(moveLine('a\nbb\nccc', 5, true)).toEqual({ text: 'a\nccc\nbb', offset: 2 });
    expect(moveLine('a\nbb\nccc', 2, false)).toEqual({ text: 'a\nccc\nbb', offset: 6 });
  });

  it('declines at the ends, where there is nothing to swap with', () => {
    expect(moveLine('a\nb', 0, true)).toBeNull();
    expect(moveLine('a\nb', 3, false)).toBeNull();
    expect(moveLine('only', 2, true)).toBeNull();
  });

  it('keeps the caret in the same column of the line that moved', () => {
    expect(moveLine('long line\nx', 8, false)).toEqual({ text: 'x\nlong line', offset: 10 });
  });

  it('counts the offset at a line break as belonging to the line it ends', () => {
    // The caret sits after "a", which is line 0, not the start of line 1.
    expect(moveLine('a\nb', 1, false)).toEqual({ text: 'b\na', offset: 3 });
  });
});

describe('moving what the caret is in', () => {
  const doc = 'First para.\n\nSecond para.\n\nThird para.';

  it('moves a paragraph past its neighbour', () => {
    expect(run(stateFor(doc, at(doc, 'Second')), moveBlock(true)))
      .toBe('Second para.\n\nFirst para.\n\nThird para.');
    expect(run(stateFor(doc, at(doc, 'Second')), moveBlock(false)))
      .toBe('First para.\n\nThird para.\n\nSecond para.');
  });

  it('declines at the top and the bottom of the document', () => {
    expect(run(stateFor(doc, at(doc, 'First')), moveBlock(true))).toBeNull();
    expect(run(stateFor(doc, at(doc, 'Third')), moveBlock(false))).toBeNull();
  });

  it('carries the caret along, so a held key keeps moving the same block', () => {
    const state = stateFor(doc, at(doc, 'Second') + 3);
    const caret = caretAfter(state, moveBlock(true));
    // Three characters into "Second", which now starts the document.
    expect(caret).toBe(4);
  });

  it('swaps two items of a list rather than the whole list', () => {
    const list = '- alpha\n- beta\n- gamma';
    expect(run(stateFor(list, at(list, 'beta')), moveBlock(true)))
      .toBe('- beta\n- alpha\n- gamma');
  });

  it('moves the whole list when the item has no sibling that way', () => {
    const source = 'Above.\n\n- only item';
    expect(run(stateFor(source, at(source, 'only')), moveBlock(true)))
      .toBe('- only item\n\nAbove.');
  });

  it('moves a line inside a fence instead of the fence itself', () => {
    const fence = '```js\nconst a = 1;\nconst b = 2;\n```';
    expect(run(stateFor(fence, at(fence, 'const b')), moveBlock(true)))
      .toBe('```js\nconst b = 2;\nconst a = 1;\n```');
  });

  it('moves the fence itself once the line has nowhere to go, which Typora does not', () => {
    const source = 'Above.\n\n```js\nonly();\n```';
    expect(run(stateFor(source, at(source, 'only')), moveBlock(true)))
      .toBe('```js\nonly();\n```\n\nAbove.');
  });
});

describe('moving a table row', () => {
  const table = '| a | b |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |';

  it('swaps two body rows', () => {
    expect(run(stateFor(table, at(table, '3')), moveBlock(true)))
      .toBe('| a | b |\n| --- | --- |\n| 3 | 4 |\n| 1 | 2 |');
  });

  it('never moves the header, and never moves a row above it', () => {
    expect(run(stateFor(table, at(table, '1')), moveBlock(true))).toBeNull();
    expect(run(stateFor(table, at(table, 'a')), moveBlock(false))).toBeNull();
    expect(run(stateFor(table, at(table, 'a')), moveBlock(true))).toBeNull();
  });

  it('declines below the last row', () => {
    expect(run(stateFor(table, at(table, '3')), moveBlock(false))).toBeNull();
  });
});

describe('moving a table column', () => {
  const table = '| a | b | c |\n| --- | --- | --- |\n| 1 | 2 | 3 |';

  it('takes the header and every body cell with it', () => {
    expect(run(stateFor(table, at(table, 'b')), moveColumn(true)))
      .toBe('| b | a | c |\n| --- | --- | --- |\n| 2 | 1 | 3 |');
    expect(run(stateFor(table, at(table, 'b')), moveColumn(false)))
      .toBe('| a | c | b |\n| --- | --- | --- |\n| 1 | 3 | 2 |');
  });

  it('declines at either edge', () => {
    expect(run(stateFor(table, at(table, 'a')), moveColumn(true))).toBeNull();
    expect(run(stateFor(table, at(table, 'c')), moveColumn(false))).toBeNull();
  });

  it('declines outside a table', () => {
    expect(run(stateFor('plain text', 2), moveColumn(true))).toBeNull();
  });
});
