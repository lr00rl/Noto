import { describe, expect, it } from 'vitest';
import { EditorState, TextSelection, type Command } from 'prosemirror-state';
import { splitBlocks } from '../../src/shared/markdown/v3/blocks';
import { docFromSpans } from '../../src/shared/markdown/v3/pm/from-mdast';
import { blockToMarkdown } from '../../src/shared/markdown/v3/pm/to-mdast';
import { alignColumn } from '../../src/renderer/editor/noto/keymap';

const TABLE = '| a | b |\n|---|---|\n| 1 | 2 |';

function stateFor(markdown: string, at: number): EditorState {
  const state = EditorState.create({ doc: docFromSpans(splitBlocks(markdown).spans) });
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, at)));
}

function after(state: EditorState, command: Command): EditorState | null {
  let next: EditorState | null = null;
  const handled = command(state, (tr) => { next = state.apply(tr); });
  return handled ? next : null;
}

describe('aligning a column', () => {
  it('sets the header and every cell of the column, and the rule row says so', () => {
    // Position 6 is inside header cell b.
    const next = after(stateFor(TABLE, 6), alignColumn('center'))!;
    const table = next.doc.firstChild!;
    expect(table.child(0).child(1).attrs.align).toBe('center');
    expect(table.child(1).child(1).attrs.align).toBe('center');
    expect(table.child(0).child(0).attrs.align).toBeNull();
    expect(blockToMarkdown(table)).toMatch(/\|\s*-+\s*\|\s*:-+:\s*\|/);
  });

  it('takes an alignment away again, and declines outside a table', () => {
    const centred = after(stateFor(TABLE, 6), alignColumn('right'))!;
    const back = after(centred, alignColumn(null))!;
    expect(back.doc.firstChild!.child(0).child(1).attrs.align).toBeNull();
    expect(after(stateFor('words', 1), alignColumn('left'))).toBeNull();
  });
});
