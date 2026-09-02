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
 * Recomputed on a document or selection change by walking the containers,
 * rather than mapped, which would need a second pass to notice a marker being
 * typed or deleted. The walk stops at anything holding text, so it costs the
 * number of blocks in the file rather than the number of characters.
 */

import { Plugin, PluginKey, type EditorState, type Transaction } from 'prosemirror-state';
import type { Node as ProseNode } from 'prosemirror-model';
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

/** Every alert decoration between two document positions. */
function decorationsIn(state: EditorState, rangeFrom: number, rangeTo: number): Decoration[] {
  const decorations: Decoration[] = [];
  const { from: selectionFrom, to: selectionTo } = state.selection;

  state.doc.nodesBetween(rangeFrom, rangeTo, (node, position) => {
    if (node.type.name !== 'blockquote') {
      /*
       * Only a container can hold a quote, so the walk stops at anything that
       * holds text. Without this it descended into every paragraph's inline
       * content and every character of the document on every keystroke, which
       * on a forty thousand block file cost most of a second a letter.
       */
      return node.isBlock && !node.isTextblock;
    }
    const first = node.firstChild;
    if (!first || first.type.name !== 'paragraph') return false;
    const match = MARKER.exec(first.textContent);
    if (!match) return false;
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
    // An alert inside an alert is not a thing, so there is nothing below.
    return false;
  });

  return decorations;
}

export function alertDecorations(state: EditorState): DecorationSet {
  return DecorationSet.create(state.doc, decorationsIn(state, 0, state.doc.content.size));
}

/**
 * The top level blocks a range touches, whole.
 *
 * A quote has to be rescanned as a unit, since its marker lives in its first
 * paragraph and decides the class on the quote itself, so a range that clips
 * one is widened to the block that holds it.
 */
function topLevelRange(doc: ProseNode, from: number, to: number): [number, number] {
  const size = doc.content.size;
  const start = doc.resolve(Math.max(0, Math.min(from, size)));
  const end = doc.resolve(Math.max(0, Math.min(to, size)));
  return [
    start.depth === 0 ? start.pos : start.before(1),
    end.depth === 0 ? end.pos : end.after(1),
  ];
}

/**
 * Only what the transaction touched.
 *
 * Rebuilding the whole set on every keystroke cost little in the state and a
 * great deal in the view: a wholly new set gives ProseMirror nothing to
 * compare, so it revisits every block in the document. On the eight megabyte
 * corpus file that was most of a second a letter.
 */
function apply(transaction: Transaction, current: DecorationSet, old: EditorState, state: EditorState): DecorationSet {
  if (!transaction.docChanged && !transaction.selectionSet) return current;

  const ranges: Array<[number, number]> = [];
  let next = current;
  if (transaction.docChanged) {
    next = current.map(transaction.mapping, transaction.doc);
    transaction.mapping.maps.forEach((map, index) => {
      const rest = transaction.mapping.slice(index + 1);
      map.forEach((_oldStart, _oldEnd, newStart, newEnd) => {
        ranges.push(topLevelRange(state.doc, rest.map(newStart, -1), rest.map(newEnd, 1)));
      });
    });
  }
  if (transaction.selectionSet) {
    // Both ends of both selections: a quote loses its editing class as the
    // caret leaves it just as it gains one as the caret arrives.
    ranges.push(topLevelRange(state.doc, transaction.mapping.map(old.selection.from, -1), transaction.mapping.map(old.selection.to, 1)));
    ranges.push(topLevelRange(state.doc, state.selection.from, state.selection.to));
  }

  for (const [from, to] of ranges) {
    const stale = next.find(from, to);
    if (stale.length > 0) next = next.remove(stale);
    const fresh = decorationsIn(state, from, to);
    if (fresh.length > 0) next = next.add(state.doc, fresh);
  }
  return next;
}

export function alertPlugin(): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: alertKey,
    state: {
      init: (_config, state) => alertDecorations(state),
      apply,
    },
    props: {
      decorations: (state) => alertKey.getState(state) ?? null,
    },
  });
}
