/**
 * Typewriter mode: the line being written stays at the middle of the window
 * and the page moves under it, which is what Typora does and what a physical
 * typewriter did.
 *
 * The scroll is only ever applied when the caret has actually moved, and only
 * when it is a caret rather than a range: dragging out a selection while the
 * page slides under the pointer is unusable. The page is moved instantly, not
 * animated: this happens on every keystroke that changes the line, and an
 * animation would spend the whole time chasing the last one.
 */

import { Plugin } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';

/** Where on the page the written line sits, as a fraction of the scroller. */
const RESTING_POINT = 0.42;

/** Ask again for this long: the layout after a keystroke settles a frame late. */
type Enabled = () => boolean;

function scroller(view: EditorView): HTMLElement | null {
  let element: HTMLElement | null = view.dom.parentElement;
  while (element) {
    const style = getComputedStyle(element);
    if (/(auto|scroll)/.test(style.overflowY) && element.scrollHeight > element.clientHeight) return element;
    element = element.parentElement;
  }
  return null;
}

export function typewriterPlugin(enabled: Enabled): Plugin {
  return new Plugin({
    view: (view) => {
      let lastHead = -1;
      const centre = (editor: EditorView) => {
        if (!enabled()) return;
        const { selection } = editor.state;
        if (!selection.empty) return;
        if (selection.head === lastHead) return;
        lastHead = selection.head;
        const pane = scroller(editor);
        if (!pane) return;
        const caret = editor.coordsAtPos(selection.head);
        const box = pane.getBoundingClientRect();
        const resting = box.top + box.height * RESTING_POINT;
        const delta = (caret.top + caret.bottom) / 2 - resting;
        if (Math.abs(delta) < 1) return;
        pane.scrollTop += delta;
      };
      return {
        update: (editor) => centre(editor),
        destroy: () => { lastHead = -1; },
      };
    },
  });
}
