/**
 * Ticking a task by pressing its box.
 *
 * The box is a pseudo-element drawn from the item's `data-checked` attribute,
 * so there is nothing to attach a handler to and nothing for a click to land
 * on: a press went through to the text and put the caret there instead. Ticking
 * an item was only possible by retyping `[x] ` at the head of it, which is not
 * something anybody would guess.
 *
 * A pseudo-element's clicks are reported against the element that owns it, so
 * the item itself is the target and the only question is whether the press was
 * in the box or in the words. That is a matter of where it landed, and the box
 * is drawn to the left of the item's content, so the answer is the geometry.
 */

import { Plugin } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { notoSchema } from '../../../shared/markdown/v3/pm/schema';

/**
 * Whether a press at `clientX` landed on the box rather than on the words.
 *
 * The box sits in the margin the list reserves, so anything left of the item's
 * own content box is it. A small allowance on the right so a press on the edge
 * of the box counts, which is how a checkbox behaves everywhere else.
 */
export function pressedTheBox(itemLeft: number, clientX: number): boolean {
  return clientX < itemLeft + 2;
}

export function taskClickPlugin(): Plugin {
  return new Plugin({
    props: {
      handleClickOn: (view: EditorView, _position, node, nodePosition, event) => {
        if (node.type !== notoSchema.nodes.list_item) return false;
        // Only a task has a state to flip; an ordinary bullet has none.
        if (node.attrs.checked === null) return false;
        const target = event.target;
        if (!(target instanceof HTMLElement)) return false;
        const item = target.closest<HTMLElement>('li.noto-task-item');
        if (!item) return false;
        if (!pressedTheBox(item.getBoundingClientRect().left, (event as MouseEvent).clientX)) {
          return false;
        }
        view.dispatch(view.state.tr.setNodeMarkup(nodePosition, undefined, {
          ...node.attrs,
          checked: !node.attrs.checked,
        }));
        return true;
      },
    },
  });
}
