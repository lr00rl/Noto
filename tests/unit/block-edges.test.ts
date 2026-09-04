import { describe, expect, it } from 'vitest';
import { EditorState, TextSelection, type Command } from 'prosemirror-state';
import { splitBlocks } from '../../src/shared/markdown/v3/blocks';
import { docFromSpans } from '../../src/shared/markdown/v3/pm/from-mdast';
import { enterInTable, tableFromRows, unwrapAtStart } from '../../src/renderer/editor/noto/block-edges';

function stateFor(markdown: string, at: number): EditorState {
  const state = EditorState.create({ doc: docFromSpans(splitBlocks(markdown).spans) });
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, at)));
}

/** The state after the command, or null when it declined. */
function after(state: EditorState, command: Command): EditorState | null {
  let next: EditorState | null = null;
  const handled = command(state, (tr) => { next = state.apply(tr); });
  return handled ? next : null;
}

describe('Backspace at the start of a block', () => {
  it('turns a heading into a paragraph, keeping its words', () => {
    const next = after(stateFor('## Title', 1), unwrapAtStart)!;
    expect(next.doc.firstChild!.type.name).toBe('paragraph');
    expect(next.doc.firstChild!.textContent).toBe('Title');
    expect(next.selection.from).toBe(1);
  });

  it('does that before joining into the paragraph above', () => {
    // The heading opens at 6: paragraph "one" is 5 wide.
    const next = after(stateFor('one\n\n## Two', 6), unwrapAtStart)!;
    expect(next.doc.childCount).toBe(2);
    expect(next.doc.child(1).type.name).toBe('paragraph');
  });

  it('takes an empty fence away', () => {
    const next = after(stateFor('```\n```', 1), unwrapAtStart)!;
    expect(next.doc.firstChild!.type.name).toBe('paragraph');
    expect(next.doc.firstChild!.content.size).toBe(0);
  });

  it('leaves a fence with code in it, and a paragraph, to the ordinary key', () => {
    expect(after(stateFor('```\ncode\n```', 1), unwrapAtStart)).toBeNull();
    expect(after(stateFor('words', 1), unwrapAtStart)).toBeNull();
    // Not at the start: the heading keeps its level.
    expect(after(stateFor('## Title', 3), unwrapAtStart)).toBeNull();
  });
});

const TABLE = '| a | b |\n|---|---|\n| 1 | 2 |';

describe('Enter in a table', () => {
  it('goes down the column', () => {
    // Header cell b holds position 6; body cell 2 holds 14.
    const next = after(stateFor(TABLE, 6), enterInTable)!;
    expect(next.selection.from).toBe(14);
    expect(next.selection.$from.parent.textContent).toBe('2');
  });

  it('makes a row at the bottom and lands in the same column of it', () => {
    const next = after(stateFor(TABLE, 14), enterInTable)!;
    const table = next.doc.firstChild!;
    expect(table.childCount).toBe(3);
    expect(table.lastChild!.childCount).toBe(2);
    expect(next.selection.$from.parent.type.name).toBe('table_cell');
    expect(next.selection.$from.index(-1)).toBe(1);
  });

  it('declines outside a table', () => {
    expect(after(stateFor('words', 1), enterInTable)).toBeNull();
  });
});

describe('a table typed as two lines', () => {
  it('becomes the table when Enter follows the rule, with one row to fill', () => {
    const next = after(stateFor('| a | b |\n\n| :-- | --: |', 25), tableFromRows)!;
    expect(next.doc.childCount).toBe(1);
    const table = next.doc.firstChild!;
    expect(table.type.name).toBe('table');
    expect(table.childCount).toBe(2);
    const header = table.firstChild!;
    expect(header.child(0).type.name).toBe('table_header');
    expect(header.child(0).textContent).toBe('a');
    expect(header.child(0).attrs.align).toBe('left');
    expect(header.child(1).attrs.align).toBe('right');
    expect(table.lastChild!.child(1).attrs.align).toBe('right');
    expect(next.selection.$from.parent.type.name).toBe('table_cell');
    expect(next.selection.$from.index(-1)).toBe(0);
  });

  it('needs a header of the same width right before the rule', () => {
    expect(after(stateFor('|---|---|', 10), tableFromRows)).toBeNull();
    expect(after(stateFor('| a |\n\n|---|---|', 17), tableFromRows)).toBeNull();
    expect(after(stateFor('words\n\n|---|---|', 17), tableFromRows)).toBeNull();
  });
});
