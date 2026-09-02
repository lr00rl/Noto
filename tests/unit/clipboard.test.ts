import { describe, expect, it } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { splitBlocks } from '../../src/shared/markdown/v3/blocks';
import { docFromSpans } from '../../src/shared/markdown/v3/pm/from-mdast';
import { sliceToMarkdown } from '../../src/renderer/editor/noto/clipboard';

/**
 * Copy `length` characters starting where `needle` begins.
 *
 * `needle` has to sit inside one text node, because that is what is searched;
 * `length` may run past it, which is how a selection spanning a mark boundary
 * is expressed here.
 */
function copied(markdown: string, needle: string, length = needle.length): string {
  const state = EditorState.create({ doc: docFromSpans(splitBlocks(markdown).spans) });
  let at = -1;
  state.doc.descendants((node, pos) => {
    if (at >= 0 || !node.isText) return true;
    const index = node.text!.indexOf(needle);
    if (index >= 0) at = pos + index;
    return true;
  });
  if (at < 0) throw new Error(`no "${needle}" in the document`);
  const selected = state.apply(state.tr.setSelection(TextSelection.create(state.doc, at, at + length)));
  return sliceToMarkdown(selected.selection.content());
}

describe('what copying puts on the clipboard', () => {
  it('keeps the marks a selection inside one paragraph carries', () => {
    expect(copied('Some **bold** words here.', 'bold', 4)).toBe('**bold**');
    expect(copied('Some **bold** words here.', 'bold', 10)).toBe('**bold** words');
    expect(copied('Read `the code` now.', 'the code', 8)).toBe('`the code`');
  });

  it('keeps a link whole, address and all', () => {
    expect(copied('See [the paper](https://e.com/x) today.', 'the paper', 9))
      .toBe('[the paper](https://e.com/x)');
  });

  it('keeps the block a whole block was copied from', () => {
    const doc = '## A heading\n\nAnd a paragraph.';
    const state = EditorState.create({ doc: docFromSpans(splitBlocks(doc).spans) });
    const all = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 0, state.doc.content.size)));
    expect(sliceToMarkdown(all.selection.content())).toBe('## A heading\n\nAnd a paragraph.');
  });

  it('gives nothing back for an empty selection', () => {
    const state = EditorState.create({ doc: docFromSpans(splitBlocks('text').spans) });
    expect(sliceToMarkdown(state.selection.content())).toBe('');
  });
});
