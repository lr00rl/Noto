/**
 * Making a link, and changing the address of one that already exists.
 *
 * Neither was possible. The delimiters revealed around the caret show a link's
 * destination because it is the part a reader cannot otherwise see, but they
 * are decorations and nobody can type into them, so the only way to change an
 * address was to leave for source mode. Typora puts this on Command and K, and
 * so does this.
 *
 * The panel is plain DOM owned by the plugin rather than anything React knows
 * about, for the same reason the table rails are: it belongs to one editor
 * instance, it has to sit at a position the editor computes, and it must never
 * reach the saved file.
 */

import { Plugin, PluginKey, TextSelection, type Command, type EditorState } from 'prosemirror-state';
import type { Mark } from 'prosemirror-model';
import type { EditorView } from 'prosemirror-view';
import { notoSchema } from '../../../shared/markdown/v3/pm/schema';

export interface LinkTarget {
  readonly from: number;
  readonly to: number;
  readonly href: string;
  /** Whether the range is already a link, which decides if Remove is offered. */
  readonly existing: boolean;
}

export const linkEditorKey = new PluginKey<LinkTarget | null>('noto-link-editor');

/** The whole run of the link mark under `pos`, or null. */
export function linkAround(state: EditorState, pos: number): LinkTarget | null {
  const $pos = state.doc.resolve(pos);
  const parent = $pos.parent;
  if (!parent.isTextblock) return null;
  const start = $pos.start();
  const index = $pos.parentOffset;

  let target: LinkTarget | null = null;
  parent.forEach((child, childOffset) => {
    if (target) return;
    const mark = child.marks.find((candidate) => candidate.type === notoSchema.marks.link);
    if (!mark) return;
    // The caret counts as inside when it touches either edge, so a link can be
    // reached without landing exactly in the middle of it.
    if (index < childOffset || index > childOffset + child.nodeSize) return;
    target = {
      from: start + childOffset,
      to: start + childOffset + child.nodeSize,
      href: String(mark.attrs.href ?? ''),
      existing: true,
    };
  });
  return target;
}

/**
 * What Command and K acts on: the link the caret is in, or the selected text.
 *
 * Returns null when the caret is loose in a paragraph with nothing selected,
 * because there is no text for a link to cover and inventing some would be a
 * different command. Also null inside a fence or display maths, which hold
 * their text as literal source and take no marks at all.
 */
export function linkTarget(state: EditorState): LinkTarget | null {
  const { from, to, empty } = state.selection;
  const inside = linkAround(state, from);
  if (inside) return inside;
  if (empty) return null;
  if (!state.doc.resolve(from).parent.type.allowsMarkType(notoSchema.marks.link)) return null;
  return { from, to, href: '', existing: false };
}

/** Put `href` on the range, or take the link off it when `href` is empty. */
export function applyLink(view: EditorView, target: LinkTarget, href: string): void {
  const link = notoSchema.marks.link;
  const transaction = view.state.tr.removeMark(target.from, target.to, link);
  const trimmed = href.trim();
  if (trimmed.length > 0) {
    transaction.addMark(target.from, target.to, link.create({ href: trimmed, title: null }));
  }
  transaction.setSelection(TextSelection.create(transaction.doc, target.to));
  view.dispatch(transaction);
}

/** Open the panel on whatever Command and K applies to here. */
export const openLinkEditor: Command = (state, dispatch) => {
  const target = linkTarget(state);
  if (!target) return false;
  if (dispatch) dispatch(state.tr.setMeta(linkEditorKey, target));
  return true;
};

const closeMeta = { close: true } as const;

class LinkPanel {
  private readonly dom: HTMLElement;

  private readonly input: HTMLInputElement;

  private readonly remove: HTMLButtonElement;

  private target: LinkTarget | null = null;

  private focusFrame = 0;

  constructor(private readonly view: EditorView) {
    this.dom = document.createElement('div');
    this.dom.className = 'noto-link-panel';
    this.dom.hidden = true;
    this.dom.setAttribute('role', 'dialog');
    this.dom.setAttribute('aria-label', 'Link address');

    this.input = document.createElement('input');
    this.input.type = 'text';
    this.input.className = 'noto-link-input';
    this.input.placeholder = 'https://';
    this.input.spellcheck = false;
    this.input.dataset.testid = 'link-input';

    this.remove = document.createElement('button');
    this.remove.type = 'button';
    this.remove.className = 'noto-link-remove';
    this.remove.textContent = 'Remove';
    this.remove.dataset.testid = 'link-remove';

    this.dom.append(this.input, this.remove);
    document.body.append(this.dom);

    this.input.addEventListener('keydown', this.onKeyDown);
    this.remove.addEventListener('click', this.onRemove);
    this.input.addEventListener('blur', this.onBlur);
    /*
     * A press inside the panel must not move focus.
     *
     * Pressing Remove blurred the field before the click landed, and blurring
     * is how the panel is dismissed, so by the time the button's own handler
     * ran there was nothing left for it to act on.
     */
    this.dom.addEventListener('mousedown', (event) => {
      if (event.target !== this.input) event.preventDefault();
    });
  }

  update(view: EditorView): void {
    const next = linkEditorKey.getState(view.state) ?? null;
    if (next === this.target) return;
    this.target = next;
    if (!next) {
      this.dom.hidden = true;
      return;
    }
    this.input.value = next.href;
    this.remove.hidden = !next.existing;
    this.dom.hidden = false;
    this.place(next);
    /*
     * Focus on the next frame, not now.
     *
     * A command run from the menu focuses the editor again as soon as it
     * returns, which happens after this runs. Taking focus here meant the
     * field was focused and then immediately blurred, and blurring is how the
     * panel is dismissed, so the panel opened and shut in the same tick.
     */
    this.focusFrame = requestAnimationFrame(() => {
      this.focusFrame = 0;
      if (!this.target) return;
      this.input.focus();
      this.input.select();
    });
  }

  private place(target: LinkTarget): void {
    const start = this.view.coordsAtPos(target.from);
    const end = this.view.coordsAtPos(target.to);
    // Measured after it is shown, because a hidden element has no size.
    const box = this.dom.getBoundingClientRect();
    const below = Math.max(start.bottom, end.bottom) + 6;
    // Fixed to the viewport, because that is the space the editor measures in.
    // A link near the foot of the window puts the panel above itself rather
    // than off the bottom edge.
    const top = below + box.height > window.innerHeight - 8
      ? Math.min(start.top, end.top) - box.height - 6
      : below;
    const left = Math.min(Math.round(start.left), window.innerWidth - box.width - 8);
    this.dom.style.top = `${Math.round(Math.max(8, top))}px`;
    this.dom.style.left = `${Math.max(8, left)}px`;
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Enter') {
      event.preventDefault();
      const target = this.target;
      if (target) applyLink(this.view, target, this.input.value);
      this.close();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      this.close();
    }
  };

  private readonly onRemove = (): void => {
    const target = this.target;
    if (target) applyLink(this.view, target, '');
    this.close();
  };

  /** Clicking away is a cancel, the same as Escape: nothing is written. */
  private readonly onBlur = (): void => {
    if (this.target) this.close();
  };

  private close(): void {
    if (this.focusFrame) cancelAnimationFrame(this.focusFrame);
    this.focusFrame = 0;
    this.target = null;
    this.dom.hidden = true;
    this.view.dispatch(this.view.state.tr.setMeta(linkEditorKey, closeMeta));
    this.view.focus();
  }

  destroy(): void {
    if (this.focusFrame) cancelAnimationFrame(this.focusFrame);
    this.input.removeEventListener('keydown', this.onKeyDown);
    this.remove.removeEventListener('click', this.onRemove);
    this.input.removeEventListener('blur', this.onBlur);
    this.dom.remove();
  }
}

export function linkEditorPlugin(): Plugin<LinkTarget | null> {
  return new Plugin<LinkTarget | null>({
    key: linkEditorKey,
    state: {
      init: () => null,
      apply(transaction, current) {
        const meta = transaction.getMeta(linkEditorKey);
        if (meta === closeMeta) return null;
        if (meta) return meta as LinkTarget;
        // A change to the document moves the range out from under the panel,
        // so the panel goes rather than writing to somewhere else.
        return transaction.docChanged ? null : current;
      },
    },
    view: (view) => new LinkPanel(view),
  });
}
