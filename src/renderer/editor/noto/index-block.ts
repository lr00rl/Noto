/**
 * A generated index, drawn as the list it is rather than as the markdown it
 * is stored as.
 *
 * The author's vault pipeline writes directory indexes into notes between
 * `<!-- note-assistant:index:start -->` and `<!-- note-assistant:index:end -->`,
 * and rewrites them on every run. Read as markdown, one is a heading, a line
 * of small print, and a long nested list of `[[path|title]]` links with counts
 * after them: correct, and about three times the height of what it says. The
 * author's note-assistant plugin for Typora draws the region instead as a
 * quiet list, one line per note, title first and path after in small type,
 * and this is a port of that rendering to ProseMirror.
 *
 * Nothing in the document changes. The blocks of the region are hidden by a
 * decoration and the list is a widget drawn after them, so the file is what it
 * always was and the pipeline that owns it never sees a difference. Put the
 * caret anywhere inside and the region comes back as markdown, editable, which
 * is how Typora treats its own rendered constructs and how this editor treats
 * front matter.
 *
 * The parser is pure and tested. Both marker families are recognised, because
 * the generator renamed them once and a renderer that knew only the old pair
 * silently matched nothing across 250 index blocks.
 */

import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import type { Node as ProseNode } from 'prosemirror-model';

const MARKERS: ReadonlyArray<{ readonly start: string; readonly end: string }> = [
  { start: '<!-- note-assistant:index:start -->', end: '<!-- note-assistant:index:end -->' },
  { start: '<!-- note-assistant:start -->', end: '<!-- note-assistant:end -->' },
];

export interface IndexItem {
  /** What the link points at, as written between the brackets. */
  readonly target: string | null;
  readonly title: string;
  /** What followed the link: a count like `（4 篇）`, or a reason. */
  readonly trailing: string;
  /** Nesting depth in the source list; 0 at the top. */
  readonly depth: number;
}

export interface IndexSection {
  readonly title: string;
  readonly items: readonly IndexItem[];
}

export interface IndexBlock {
  readonly title: string;
  readonly sections: readonly IndexSection[];
  /** Items that link somewhere; a label with no link is not counted. */
  readonly linkCount: number;
}

export interface IndexRegion {
  /** Index of the first top-level block, the start marker, inclusive. */
  readonly from: number;
  /** Index of the last top-level block, the end marker, inclusive. */
  readonly to: number;
  readonly block: IndexBlock;
}

const WIKI = /\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/;

/** A marker block: raw HTML holding exactly one of the comments. */
function markerOf(node: ProseNode): { kind: 'start' | 'end'; family: number } | null {
  if (node.type.name !== 'html_block') return null;
  const text = node.textContent.trim();
  for (let family = 0; family < MARKERS.length; family += 1) {
    if (text === MARKERS[family].start) return { kind: 'start', family };
    if (text === MARKERS[family].end) return { kind: 'end', family };
  }
  return null;
}

/**
 * One list item as one line of the index.
 *
 * The link is the first `[[...]]` in the item's own paragraph; whatever
 * follows it is the trailing note. An item with no link is a label, the way
 * `- 供应商（2 篇）` heads the notes under it. Nested lists are walked so a
 * label keeps its children under it, which a flat parse would have lost.
 */
function collectItems(list: ProseNode, depth: number, into: IndexItem[]): void {
  list.forEach((item) => {
    if (item.type.name !== 'list_item' && item.type.name !== 'task_item') return;
    let firstText: string | null = null;
    const nested: ProseNode[] = [];
    item.forEach((child) => {
      if (child.type.name === 'bullet_list' || child.type.name === 'ordered_list') nested.push(child);
      else if (firstText === null && child.isTextblock) firstText = child.textContent;
    });
    const text = (firstText ?? '').trim();
    if (text.length > 0) {
      const match = WIKI.exec(text);
      if (match) {
        const target = match[1].trim();
        const title = (match[2] ?? '').trim() || target.split('/').pop() || target;
        into.push({ target, title, trailing: text.slice(match.index + match[0].length).trim(), depth });
      } else {
        into.push({ target: null, title: text, trailing: '', depth });
      }
    }
    for (const child of nested) collectItems(child, depth + 1, into);
  });
}

/**
 * The block, from the top-level nodes between the markers.
 *
 * The first heading names the block and later headings open sections; every
 * list contributes to whichever section is open. A paragraph of small print
 * ("自动生成，勿手改") is passed over: the rendering says what the region is.
 */
export function parseIndexBlock(nodes: readonly ProseNode[]): IndexBlock {
  let title = '';
  const sections: { title: string; items: IndexItem[] }[] = [];
  let current: { title: string; items: IndexItem[] } | null = null;
  const sectionFor = () => {
    if (!current) {
      current = { title: '', items: [] };
      sections.push(current);
    }
    return current;
  };
  for (const node of nodes) {
    if (node.type.name === 'heading') {
      const text = node.textContent.trim();
      if (!text) continue;
      if (!title) title = text;
      else {
        current = { title: text, items: [] };
        sections.push(current);
      }
      continue;
    }
    if (node.type.name === 'bullet_list' || node.type.name === 'ordered_list') {
      collectItems(node, 0, sectionFor().items);
    }
  }
  const populated = sections.filter((section) => section.items.length > 0);
  const linkCount = populated.reduce(
    (sum, section) => sum + section.items.filter((item) => item.target !== null).length,
    0,
  );
  return { title: title || '相关笔记', sections: populated, linkCount };
}

/** Every marked region in the document, by top-level block index. */
export function findIndexRegions(doc: ProseNode): IndexRegion[] {
  const regions: IndexRegion[] = [];
  const blocks: ProseNode[] = [];
  doc.forEach((node) => { blocks.push(node); });
  for (let index = 0; index < blocks.length; index += 1) {
    const start = markerOf(blocks[index]);
    if (!start || start.kind !== 'start') continue;
    let end = -1;
    for (let cursor = index + 1; cursor < blocks.length; cursor += 1) {
      const marker = markerOf(blocks[cursor]);
      if (marker && marker.kind === 'end' && marker.family === start.family) { end = cursor; break; }
    }
    if (end < 0) continue;
    regions.push({ from: index, to: end, block: parseIndexBlock(blocks.slice(index + 1, end)) });
    index = end;
  }
  return regions;
}

export const indexBlockKey = new PluginKey<DecorationSet>('noto-index-block');

export interface IndexBlockOptions {
  /** Open the note a line points at, the same way a wiki link is followed. */
  readonly onFollow: (target: string) => void;
}

function render(block: IndexBlock, onFollow: (target: string) => void): HTMLElement {
  const panel = document.createElement('section');
  panel.className = 'noto-index';
  panel.contentEditable = 'false';

  const header = document.createElement('div');
  header.className = 'noto-index-header';
  const title = document.createElement('span');
  title.className = 'noto-index-title';
  title.textContent = block.title;
  const count = document.createElement('span');
  count.className = 'noto-index-count';
  count.textContent = block.linkCount ? `${block.linkCount} 条` : '';
  header.append(title, count);
  panel.append(header);

  for (const section of block.sections) {
    if (section.title) {
      const kicker = document.createElement('div');
      kicker.className = 'noto-index-section';
      kicker.textContent = section.title;
      panel.append(kicker);
    }
    const list = document.createElement('div');
    list.className = 'noto-index-list';
    for (const item of section.items) {
      const line = document.createElement(item.target ? 'button' : 'div');
      line.className = item.target ? 'noto-index-item' : 'noto-index-label';
      line.style.setProperty('--index-depth', String(item.depth));
      const target = item.target;
      if (line instanceof HTMLButtonElement && target !== null) {
        line.type = 'button';
        // Not on mousedown: the editor would take the press as a place to put
        // the caret, and the note would open with the caret somewhere else.
        line.addEventListener('mousedown', (event) => event.preventDefault());
        line.addEventListener('click', () => onFollow(target));
      }
      const name = document.createElement('span');
      name.className = 'noto-index-item-title';
      name.textContent = item.title;
      line.append(name);
      const note = item.trailing || (item.target ?? '');
      if (note) {
        const path = document.createElement('span');
        path.className = 'noto-index-item-path';
        path.textContent = note;
        line.append(path);
      }
      list.append(line);
    }
    panel.append(list);
  }
  return panel;
}

/**
 * Decorations for every region the caret is not in: its blocks hidden, and
 * the drawn list after the last of them.
 */
function decorate(doc: ProseNode, selectionFrom: number, selectionTo: number, onFollow: (target: string) => void): DecorationSet {
  const regions = findIndexRegions(doc);
  if (regions.length === 0) return DecorationSet.empty;
  const offsets: { from: number; to: number }[] = [];
  let position = 0;
  doc.forEach((node) => {
    offsets.push({ from: position, to: position + node.nodeSize });
    position += node.nodeSize;
  });
  const decorations: Decoration[] = [];
  for (const region of regions) {
    const from = offsets[region.from].from;
    const to = offsets[region.to].to;
    // The caret inside means the reader is editing it: show the source.
    if (selectionFrom < to && selectionTo > from) continue;
    for (let index = region.from; index <= region.to; index += 1) {
      decorations.push(Decoration.node(offsets[index].from, offsets[index].to, { class: 'noto-index-source' }));
    }
    decorations.push(Decoration.widget(to, () => render(region.block, onFollow), {
      side: 1,
      key: `noto-index:${from}:${region.block.linkCount}`,
    }));
  }
  return DecorationSet.create(doc, decorations);
}

export function indexBlockPlugin(options: IndexBlockOptions): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: indexBlockKey,
    state: {
      init: (_config, state) => decorate(state.doc, state.selection.from, state.selection.to, options.onFollow),
      apply: (transaction, current, _previous, state) => {
        // Only a change to the document or to where the caret is can change
        // what is drawn; anything else keeps the set, so typing elsewhere
        // costs nothing here.
        if (!transaction.docChanged && !transaction.selectionSet) return current;
        return decorate(state.doc, state.selection.from, state.selection.to, options.onFollow);
      },
    },
    props: {
      decorations: (state) => indexBlockKey.getState(state) ?? null,
    },
  });
}
