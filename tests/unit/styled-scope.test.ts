import { describe, expect, it } from 'vitest';
import { EditorState, TextSelection, type Command } from 'prosemirror-state';
import { splitBlocks } from '../../src/shared/markdown/v3/blocks';
import { docFromSpans } from '../../src/shared/markdown/v3/pm/from-mdast';
import { blockToMarkdown } from '../../src/shared/markdown/v3/pm/to-mdast';
import { clearFormat, insertComment, selectStyledScope, styledScopeAt } from '../../src/renderer/editor/noto/keymap';

function stateFor(markdown: string, from: number, to = from): EditorState {
  const state = EditorState.create({ doc: docFromSpans(splitBlocks(markdown).spans) });
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, from, to)));
}

function after(state: EditorState, command: Command): EditorState | null {
  let next: EditorState | null = null;
  const handled = command(state, (tr) => { next = state.apply(tr); });
  return handled ? next : null;
}

const selected = (state: EditorState) => state.doc.textBetween(state.selection.from, state.selection.to);

// "Some **bold words** here." draws as: Some (1-6) bold words (6-16) here. (16-22)
const NOTE = 'Some **bold words** here.';

describe('the styled scope', () => {
  it('is the run with the same marks around the caret', () => {
    expect(styledScopeAt(stateFor(NOTE, 9))).toEqual({ from: 6, to: 16 });
    // At the run's start, the caret belongs to the run after it.
    expect(styledScopeAt(stateFor(NOTE, 6))).toEqual({ from: 6, to: 16 });
    // In plain text there is none.
    expect(styledScopeAt(stateFor(NOTE, 3))).toBeNull();
  });

  it('is selected by Select Styled Scope, and the block stands in when there is none', () => {
    expect(selected(after(stateFor(NOTE, 9), selectStyledScope)!)).toBe('bold words');
    expect(selected(after(stateFor(NOTE, 3), selectStyledScope)!)).toBe('Some bold words here.');
  });

  it('is what Clear Format clears when nothing is selected', () => {
    const next = after(stateFor(NOTE, 9), clearFormat)!;
    expect(blockToMarkdown(next.doc.firstChild!)).toBe('Some bold words here.');
    expect(after(stateFor(NOTE, 3), clearFormat)).toBeNull();
  });
});

describe('Comment', () => {
  it('wraps the selection in an HTML comment the note keeps', () => {
    const next = after(stateFor(NOTE, 6, 16), insertComment)!;
    expect(blockToMarkdown(next.doc.firstChild!)).toBe('Some <!-- **bold words** --> here.');
    expect(selected(next)).toBe('bold words');
  });
});
