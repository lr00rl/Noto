/**
 * Marks the top level block that holds the selection.
 *
 * This is the hook for Typora's signature behaviour: syntax markers are visible
 * only in the block you are editing, and the rest of the document stays clean
 * prose. Doing it with a decoration rather than by rewriting the document keeps
 * the markers out of the saved file entirely.
 */

import { Plugin, PluginKey, type EditorState } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';

export const activeNodeKey = new PluginKey<DecorationSet>('noto-active-node');

function activeDecorations(state: EditorState): DecorationSet {
  const { from, to } = state.selection;
  const decorations: Decoration[] = [];

  // Only the blocks the selection actually touches are visited. Scanning every
  // top level child instead would make each keystroke cost a walk of the whole
  // document, which is precisely the cost a long document cannot afford.
  state.doc.nodesBetween(from, to, (node, position, parent) => {
    if (parent !== state.doc) return false;
    decorations.push(Decoration.node(position, position + node.nodeSize, {
      class: 'noto-active-block',
    }));
    return false;
  });

  return DecorationSet.create(state.doc, decorations);
}

export function activeNodePlugin(): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: activeNodeKey,
    state: {
      init: (_config, state) => activeDecorations(state),
      apply: (transaction, previous, _oldState, newState) =>
        (transaction.docChanged || transaction.selectionSet ? activeDecorations(newState) : previous),
    },
    props: {
      decorations: (state) => activeNodeKey.getState(state),
    },
  });
}
