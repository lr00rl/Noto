import { describe, expect, it } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import type { Decoration } from 'prosemirror-view';
import { splitBlocks } from '../../src/shared/markdown/v3/blocks';
import { docFromSpans } from '../../src/shared/markdown/v3/pm/from-mdast';
import { alertKey, alertPlugin } from '../../src/renderer/editor/noto/alert-plugin';

function stateFor(markdown: string): EditorState {
  const state = EditorState.create({ doc: docFromSpans(splitBlocks(markdown).spans), plugins: [alertPlugin()] });
  // The caret out of the way, so nothing is in its editing state to begin with.
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, state.doc.content.size - 1)));
}

/** The classes the plugin is drawing, in document order. */
function drawn(state: EditorState): string[] {
  return alertKey.getState(state)!.find()
    .map((d) => (d as Decoration & { type: { attrs?: { class?: string } } }).type.attrs?.class ?? 'widget');
}

const NOTE = '> [!NOTE]\n> Something worth knowing.\n\nAfter.';

describe('the alert plugin, applied one change at a time', () => {
  it('draws a callout for a quote that opens with a marker', () => {
    // The quote's own class, then the title chip, then the hidden marker.
    expect(drawn(stateFor(NOTE))).toEqual(['noto-alert noto-alert-note', 'widget', 'noto-alert-marker']);
  });

  it('leaves an ordinary quote alone', () => {
    expect(drawn(stateFor('> Just a quote.\n\nAfter.'))).toEqual([]);
  });

  it('adds the editing class when the caret arrives, and takes it away again', () => {
    let state = stateFor(NOTE);
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 4)));
    expect(drawn(state)[0]).toContain('noto-alert-editing');
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, state.doc.content.size - 1)));
    expect(drawn(state)[0]).not.toContain('noto-alert-editing');
  });

  it('notices a marker being typed into an ordinary quote', () => {
    let state = stateFor('> Something.\n\nAfter.');
    expect(drawn(state)).toEqual([]);
    // At the head of the quote's paragraph.
    state = state.apply(state.tr.insertText('[!TIP]\n', 2));
    expect(drawn(state)[0]).toBe('noto-alert noto-alert-tip');
  });

  it('notices a marker being deleted', () => {
    let state = stateFor(NOTE);
    expect(drawn(state)).not.toEqual([]);
    state = state.apply(state.tr.delete(2, 8));
    expect(drawn(state)).toEqual([]);
  });

  it('leaves a second alert alone while the first is edited', () => {
    const two = '> [!NOTE]\n> One.\n\n> [!WARNING]\n> Two.\n\nAfter.';
    let state = stateFor(two);
    expect(drawn(state).filter((c) => c.startsWith('noto-alert '))).toEqual([
      'noto-alert noto-alert-note', 'noto-alert noto-alert-warning',
    ]);
    state = state.apply(state.tr.insertText('x', 12));
    const classes = drawn(state).filter((c) => c.startsWith('noto-alert '));
    expect(classes).toHaveLength(2);
    expect(classes[1]).toBe('noto-alert noto-alert-warning');
  });
});
