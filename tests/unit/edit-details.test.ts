import { describe, expect, it } from 'vitest';
import { EditorState, TextSelection, type Command } from 'prosemirror-state';
import { splitBlocks } from '../../src/shared/markdown/v3/blocks';
import { docFromSpans } from '../../src/shared/markdown/v3/pm/from-mdast';
import { selectLine, selectWord } from '../../src/renderer/editor/noto/keymap';
import { footnoteTitles } from '../../src/renderer/editor/noto/footnote-hover';

function stateFor(markdown: string, at: number): EditorState {
  const state = EditorState.create({ doc: docFromSpans(splitBlocks(markdown).spans) });
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, at)));
}

function after(state: EditorState, command: Command): EditorState | null {
  let next: EditorState | null = null;
  const handled = command(state, (tr) => { next = state.apply(tr); });
  return handled ? next : null;
}

const selected = (state: EditorState) => state.doc.textBetween(state.selection.from, state.selection.to);

describe("Typora's selections", () => {
  it('selects the word around the caret, Chinese and Latin alike', () => {
    expect(selected(after(stateFor('one two_three four', 7), selectWord)!)).toBe('two_three');
    expect(selected(after(stateFor('联系方式 统筹', 3), selectWord)!)).toBe('联系方式');
    // Between two spaces there is no word to select.
    expect(after(stateFor('one  two', 5), selectWord)).toBeNull();
  });

  it('selects the whole line the caret is in', () => {
    expect(selected(after(stateFor('one two\n\nthree', 3), selectLine)!)).toBe('one two');
    expect(selected(after(stateFor('one two\n\nthree', 12), selectLine)!)).toBe('three');
  });
});

describe('a footnote on hover', () => {
  it('carries its text as the title of its reference', () => {
    const state = stateFor('A claim[^1] and another[^2].\n\n[^1]: The first note.\n\n[^2]: The second, with *emphasis*.\n', 1);
    const set = footnoteTitles(state.doc);
    expect(set.find()).toHaveLength(2);
    const attrs = set.find().map((decoration) => (decoration as unknown as { type: { attrs: { title: string } } }).type.attrs.title);
    expect(attrs).toEqual(['The first note.', 'The second, with emphasis.']);
  });

  it('leaves a reference with no definition alone', () => {
    const state = stateFor('A claim[^9].\n', 1);
    expect(footnoteTitles(state.doc).find()).toHaveLength(0);
  });
});
