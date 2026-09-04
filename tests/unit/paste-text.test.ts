import { describe, expect, it } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { splitBlocks } from '../../src/shared/markdown/v3/blocks';
import { docFromSpans } from '../../src/shared/markdown/v3/pm/from-mdast';
import { sliceFromText } from '../../src/renderer/editor/noto/paste-text';

function stateFor(markdown: string, at: number): EditorState {
  const state = EditorState.create({ doc: docFromSpans(splitBlocks(markdown).spans) });
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, at)));
}

function pasted(markdown: string, at: number, text: string): EditorState {
  const state = stateFor(markdown, at);
  const slice = sliceFromText(text, state.selection.$from);
  return state.apply(state.tr.replaceSelection(slice));
}

describe('pasted text', () => {
  it('is read as markdown', () => {
    const next = pasted('Before.', 8, '\n\n# Heading\n\n- one\n- two\n');
    const names = [] as string[];
    next.doc.forEach((node) => names.push(node.type.name));
    expect(names).toEqual(['paragraph', 'heading', 'bullet_list']);
    expect(next.doc.child(1).textContent).toBe('Heading');
  });

  it('joins one sentence into the paragraph the caret is in', () => {
    const next = pasted('Before after.', 8, 'and *then* ');
    expect(next.doc.childCount).toBe(1);
    expect(next.doc.firstChild!.textContent).toBe('Before and then after.');
    expect(next.doc.firstChild!.child(1).marks[0].type.name).toBe('emphasis');
  });

  it('stays source inside a fence, and Windows line endings become lines', () => {
    const next = pasted('```\ncode\n```', 1, '# not a heading\r\nx');
    expect(next.doc.firstChild!.type.name).toBe('code_block');
    expect(next.doc.firstChild!.textContent).toBe('# not a heading\nxcode');
  });

  it('pastes nothing as nothing', () => {
    const next = pasted('Before.', 8, '');
    expect(next.doc.firstChild!.textContent).toBe('Before.');
  });
});
