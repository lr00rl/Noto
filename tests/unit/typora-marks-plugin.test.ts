import { describe, expect, it } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import type { Decoration } from 'prosemirror-view';
import { splitBlocks } from '../../src/shared/markdown/v3/blocks';
import { docFromSpans } from '../../src/shared/markdown/v3/pm/from-mdast';
import { notoSchema } from '../../src/shared/markdown/v3/pm/schema';
import { typoraMarksKey, typoraMarksPlugin } from '../../src/renderer/editor/noto/typora-marks-plugin';

/**
 * A state whose caret is in the last block. A fresh state puts it in the
 * first, which would keep that block in its editing state throughout.
 */
function stateFor(markdown: string): EditorState {
  const state = EditorState.create({ doc: docFromSpans(splitBlocks(markdown).spans), plugins: [typoraMarksPlugin()] });
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, state.doc.content.size - 1)));
}

/** The classes drawn, in document order. */
function drawn(state: EditorState): string[] {
  const set = typoraMarksKey.getState(state)!;
  return set.find().map((decoration) => (decoration as Decoration & { type: { attrs: { class: string } } }).type.attrs.class);
}

/** Position of `text` in the first paragraph. */
function positionOf(state: EditorState, text: string): number {
  return 1 + state.doc.firstChild!.textContent.indexOf(text);
}

describe('the Typora marks plugin', () => {
  it('draws a highlight and its two delimiters', () => {
    expect(drawn(stateFor('Mark ==key== here.\n\nelsewhere'))).toEqual(['noto-typora-delim', 'noto-mark-highlight', 'noto-typora-delim']);
  });

  it('rescans a block whose marks changed, even though a mark step maps nothing', () => {
    let state = stateFor('Mark ==key== here.\n\nelsewhere');
    const from = positionOf(state, '==key==');
    const to = from + '==key=='.length;
    state = state.apply(state.tr.addMark(from, to, notoSchema.marks.inline_code.create()));
    expect(drawn(state)).toEqual([]);
    state = state.apply(state.tr.removeMark(from, to, notoSchema.marks.inline_code));
    expect(drawn(state)).toEqual(['noto-typora-delim', 'noto-mark-highlight', 'noto-typora-delim']);
  });

  it('reveals the syntax while the selection touches the block', () => {
    let state = stateFor('Mark ==key== here.\n\nelsewhere');
    expect(drawn(state)).not.toContain('noto-marks-editing');
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 2)));
    expect(drawn(state)).toContain('noto-marks-editing');
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, state.doc.content.size - 1)));
    expect(drawn(state)).not.toContain('noto-marks-editing');
  });

  it('does not scan inside inline code', () => {
    expect(drawn(stateFor('Not `==this==` here.\n\nelsewhere'))).toEqual([]);
  });

  it('leaves a neighbour alone when only the block after it changes', () => {
    let state = stateFor('==a==\n\nplain');
    const endOfFirst = state.doc.firstChild!.nodeSize - 1;
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, endOfFirst)));
    expect(drawn(state)).toContain('noto-marks-editing');
    // A change in the second block, with the selection left where it is.
    const second = state.doc.firstChild!.nodeSize + 1;
    state = state.apply(state.tr.insertText('x', second));
    expect(drawn(state)).toContain('noto-marks-editing');
    expect(drawn(state)).toHaveLength(4);
  });
});
