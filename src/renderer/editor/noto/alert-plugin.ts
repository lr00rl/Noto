/**
 * GitHub-style alerts: a blockquote that opens with `[!NOTE]`, `[!TIP]`,
 * `[!IMPORTANT]`, `[!WARNING]` or `[!CAUTION]`.
 *
 * Typora draws these as a tinted callout with an icon and a title, and the
 * author's vault is full of them. Here they are decorations over an ordinary
 * blockquote, so the file keeps its `> [!NOTE]` line byte for byte: the
 * quote takes a class for its kind, the marker text is hidden and a title
 * chip stands in its place. While the caret is inside the quote the marker
 * shows and the chip goes, which is the same reveal every other piece of
 * syntax gets.
 *
 * Recomputed on a document or selection change by walking the blockquotes,
 * which a note has a handful of, rather than mapped, which would need a
 * second pass to notice a marker being typed or deleted.
 */

import { Plugin, PluginKey, type EditorState } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';

export const alertKey = new PluginKey<DecorationSet>('noto-alerts');

export const ALERT_KINDS = ['note', 'tip', 'important', 'warning', 'caution'] as const;
export type AlertKind = (typeof ALERT_KINDS)[number];

/** The marker at the very start of the quote's first paragraph, with the break that follows. */
const MARKER = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*(\n)?/;

const TITLES: Record<AlertKind, string> = {
  note: 'Note',
  tip: 'Tip',
  important: 'Important',
  warning: 'Warning',
  caution: 'Caution',
};

/* One stroke glyph each, in the title bar's style, so the chip reads as part
   of the same app as the icons above it rather than as a pasted emoji. */
const ICONS: Record<AlertKind, string> = {
  note: '<circle cx="8" cy="8" r="6.25"/><path d="M8 7.25v4M8 5h.01"/>',
  tip: '<path d="M6.5 13.25h3M8 2.25a4 4 0 0 1 2.5 7.1c-.6.5-.9 1-.9 1.65h-3.2c0-.65-.3-1.15-.9-1.65A4 4 0 0 1 8 2.25z"/>',
  important: '<circle cx="8" cy="8" r="6.25"/><path d="M8 4.75v4M8 11.25h.01"/>',
  warning: '<path d="M8 2.25 14.25 13H1.75z"/><path d="M8 6.25v3M8 11.25h.01"/>',
  caution: '<path d="M5.5 1.75h5l3.75 3.75v5l-3.75 3.75h-5L1.75 10.5v-5z"/><path d="M8 5v3.5M8 11.25h.01"/>',
};

/** What a marker names, or null for an ordinary quote. */
export function alertKindOf(firstParagraphText: string): AlertKind | null {
  const match = MARKER.exec(firstParagraphText);
  return match ? (match[1].toLowerCase() as AlertKind) : null;
}

function title(kind: AlertKind): HTMLElement {
  const chip = document.createElement('span');
  chip.className = `noto-alert-title noto-alert-title-${kind}`;
  chip.contentEditable = 'false';
  chip.setAttribute('aria-hidden', 'true');
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('viewBox', '0 0 16 16');
  icon.innerHTML = ICONS[kind];
  const label = document.createElement('span');
  label.textContent = TITLES[kind];
  chip.append(icon, label);
  return chip;
}

export function alertDecorations(state: EditorState): DecorationSet {
  const decorations: Decoration[] = [];
  const { from: selectionFrom, to: selectionTo } = state.selection;

  state.doc.descendants((node, position) => {
    if (node.type.name !== 'blockquote') return true;
    const first = node.firstChild;
    if (!first || first.type.name !== 'paragraph') return true;
    const match = MARKER.exec(first.textContent);
    if (!match) return true;
    const kind = match[1].toLowerCase() as AlertKind;
    const end = position + node.nodeSize;
    const editing = selectionFrom < end && selectionTo > position;

    decorations.push(Decoration.node(position, end, {
      class: `noto-alert noto-alert-${kind}${editing ? ' noto-alert-editing' : ''}`,
    }));

    // The marker sits at the head of the paragraph's content: past the
    // quote's opening token and the paragraph's. A hard break right after it
    // is part of the marker line and hides with it.
    const start = position + 2;
    let length = match[0].length;
    if (!match[2]) {
      const following = first.maybeChild(1);
      if (first.firstChild?.text?.length === match[0].length && following?.type.name === 'hard_break') {
        length += following.nodeSize;
      }
    }
    decorations.push(Decoration.inline(start, start + length, { class: 'noto-alert-marker' }));
    decorations.push(Decoration.widget(start, () => title(kind), {
      side: -1,
      ignoreSelection: true,
      key: `noto-alert-${kind}`,
    }));
    return true;
  });

  return DecorationSet.create(state.doc, decorations);
}

export function alertPlugin(): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: alertKey,
    state: {
      init: (_config, state) => alertDecorations(state),
      apply: (transaction, current, _old, state) => (
        transaction.docChanged || transaction.selectionSet ? alertDecorations(state) : current
      ),
    },
    props: {
      decorations: (state) => alertKey.getState(state) ?? null,
    },
  });
}
