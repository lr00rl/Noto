import { describe, expect, it } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { splitBlocks } from '../../src/shared/markdown/v3/blocks';
import { docFromSpans } from '../../src/shared/markdown/v3/pm/from-mdast';
import { linkTarget } from '../../src/renderer/editor/noto/link-plugin';

function stateFor(markdown: string, from: number, to = from): EditorState {
  const state = EditorState.create({ doc: docFromSpans(splitBlocks(markdown).spans) });
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, from, to)));
}

/** The caret position of the first occurrence of `needle`. */
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

describe('what a link command acts on', () => {
  const withLink = 'Read [the paper](https://example.com/a) today.';

  it('is the whole link when the caret is inside one', () => {
    const target = linkTarget(stateFor(withLink, at(withLink, 'paper')));
    expect(target).not.toBeNull();
    expect(target!.href).toBe('https://example.com/a');
    expect(target!.existing).toBe(true);
    // The range covers the link text, not the surrounding sentence.
    expect(target!.to - target!.from).toBe('the paper'.length);
  });

  it('is the whole link from either edge of it', () => {
    const start = at(withLink, 'the paper');
    expect(linkTarget(stateFor(withLink, start))!.existing).toBe(true);
    expect(linkTarget(stateFor(withLink, start + 'the paper'.length))!.existing).toBe(true);
  });

  it('is the selection when there is one and no link', () => {
    const plain = 'Read the paper today.';
    const start = at(plain, 'the paper');
    const target = linkTarget(stateFor(plain, start, start + 9));
    expect(target).toEqual({ from: start, to: start + 9, href: '', existing: false });
  });

  it('is nothing when the caret is loose with no selection', () => {
    expect(linkTarget(stateFor('Read the paper today.', 3))).toBeNull();
  });

  it('is nothing inside a code fence, which has no marks to carry a link', () => {
    const fence = '```js\nconst a = 1;\n```';
    const start = at(fence, 'const');
    expect(linkTarget(stateFor(fence, start, start + 5))).toBeNull();
  });
});
