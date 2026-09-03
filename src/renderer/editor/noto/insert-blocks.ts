/**
 * The four things Typora's Paragraph menu inserts that Noto could not: a
 * footnote, a table of contents marker, YAML front matter and a link reference.
 *
 * Every piece already parses and serializes. The schema carries a
 * `footnote_definition`, a `link_definition` and a `frontmatter` node, and the
 * file they come from reads them back unchanged. What was missing was any way
 * to write one without opening the source.
 *
 * Front matter is the odd one and the one that matters most here: 2,835 of the
 * author's 7,131 notes have it. It is not inserted where the caret is. It
 * belongs at the top of the file or it is not front matter at all, so it goes
 * before the first block wherever the caret happens to be, and a document that
 * already has some is left alone rather than given a second block that would
 * serialize as a horizontal rule and a stray paragraph.
 */

import { TextSelection, type Command } from 'prosemirror-state';
import { notoSchema } from '../../../shared/markdown/v3/pm/schema';
import { blockToMarkdown } from '../../../shared/markdown/v3/pm/to-mdast';
import { tableToHtml } from './clipboard';

const nodes = notoSchema.nodes;

/**
 * The next free footnote label, counting the definitions already in the note.
 *
 * Numbered rather than named, because a number is what a reader inserting a
 * footnote from a menu expects, and the alternative is asking them for a label
 * before they have written the note. Existing numeric labels are read so a
 * third footnote is `3` and not a second `1`, which would be two footnotes
 * pointing at one definition.
 */
export function nextFootnoteLabel(labels: readonly string[]): string {
  let highest = 0;
  for (const label of labels) {
    const numeric = /^\d+$/.test(label) ? Number(label) : 0;
    if (numeric > highest) highest = numeric;
  }
  return String(highest + 1);
}

function footnoteLabels(doc: import('prosemirror-model').Node): string[] {
  const labels: string[] = [];
  doc.descendants((node) => {
    if (node.type === nodes.footnote_definition) {
      labels.push(String(node.attrs.label || node.attrs.identifier));
    }
    return true;
  });
  return labels;
}

/**
 * A footnote: the reference where the caret is, and its definition at the foot.
 *
 * Both halves at once, because half a footnote is not a footnote. The
 * definition goes at the end of the document, which is where a reader looks for
 * one and where every note in the vault that has them keeps them.
 */
export const insertFootnote: Command = (state, dispatch) => {
  const { $from, empty } = state.selection;
  if (!$from.parent.isTextblock || $from.parent.type.spec.code === true) return false;
  if (!$from.parent.canReplaceWith($from.index(), $from.index(), nodes.footnote_reference)) return false;

  if (dispatch) {
    const label = nextFootnoteLabel(footnoteLabels(state.doc));
    const reference = nodes.footnote_reference.create({ identifier: label, label });
    const transaction = empty
      ? state.tr.insert($from.pos, reference)
      : state.tr.replaceSelectionWith(reference, false);

    const definition = nodes.footnote_definition.create(
      { identifier: label, label },
      nodes.paragraph.create(),
    );
    const end = transaction.doc.content.size;
    transaction.insert(end, definition);
    // The caret goes into the definition, because the next thing to do is
    // write the note, not to carry on with the sentence.
    const inside = transaction.doc.resolve(Math.min(end + 2, transaction.doc.content.size));
    transaction.setSelection(TextSelection.near(inside));
    dispatch(transaction.scrollIntoView());
  }
  return true;
};

/**
 * The `[TOC]` marker, which stands for a table of contents.
 *
 * A paragraph holding the literal marker, which is what the file says and what
 * every other markdown tool that understands it reads. Noto does not draw the
 * list live, so what the reader gets is the marker itself: honest about the
 * file, and it survives the round trip now that the serializer stopped
 * escaping it.
 */
export const insertTableOfContents: Command = (state, dispatch) => {
  const { $from } = state.selection;
  if (!$from.parent.isTextblock || $from.parent.type.spec.code === true) return false;
  if (dispatch) {
    const marker = nodes.paragraph.create(null, notoSchema.text('[TOC]'));
    const at = $from.after($from.depth);
    dispatch(state.tr.insert(at, marker).scrollIntoView());
  }
  return true;
};

/**
 * YAML front matter at the top of the document.
 *
 * Never where the caret is. Front matter is only front matter as the first
 * thing in the file, so this goes before the first block whatever is selected,
 * and refuses when the document already has some rather than writing a second
 * block that would serialize as a rule and a stray paragraph.
 */
export const insertFrontmatter: Command = (state, dispatch) => {
  if (state.doc.firstChild?.type === nodes.frontmatter) return false;
  if (dispatch) {
    const seed = 'title: ';
    const block = nodes.frontmatter.create(null, notoSchema.text(seed));
    const transaction = state.tr.insert(0, block);
    // After the seed rather than before it: the reader's next keystroke is the
    // value, and a caret at the start would spell the title backwards into it.
    transaction.setSelection(TextSelection.near(transaction.doc.resolve(1 + seed.length), -1));
    dispatch(transaction.scrollIntoView());
  }
  return true;
};

/**
 * A `[label]: url` reference definition at the foot of the document.
 *
 * Where the others in the vault live, and where one is useful: a definition in
 * the middle of the prose is a line of punctuation in the reader's way.
 */
export const insertLinkReference: Command = (state, dispatch) => {
  if (dispatch) {
    const label = nextLinkLabel(state.doc);
    const definition = nodes.link_definition.create({
      identifier: label, label, url: 'https://', title: null,
    });
    const end = state.doc.content.size;
    dispatch(state.tr.insert(end, definition).scrollIntoView());
  }
  return true;
};

/** The next free `ref-N`, so two inserts do not collide. */
function nextLinkLabel(doc: import('prosemirror-model').Node): string {
  const taken = new Set<string>();
  doc.descendants((node) => {
    if (node.type === nodes.link_definition) {
      taken.add(String(node.attrs.label || node.attrs.identifier));
    }
    return true;
  });
  for (let index = 1; index < 1_000; index += 1) {
    const candidate = `ref-${index}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `ref-${taken.size + 1}`;
}

/**
 * The table the caret is in, as a position and a node.
 *
 * Walks out from the caret rather than relying on a selection type, so it works
 * whether the caret is in a cell, a whole cell is selected, or the table itself
 * is the selection.
 */
export function tableAround(state: import('prosemirror-state').EditorState):
{ from: number; node: import('prosemirror-model').Node } | null {
  const $from = state.selection.$from;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    if (node.type === nodes.table) return { from: $from.before(depth), node };
  }
  return null;
}

/**
 * Line the table's source up into columns.
 *
 * Only ever on request. Two thirds of the tables in the author's vault are
 * written unpadded, and rewriting one nobody asked about is what this editor
 * exists not to do.
 */
export const prettifyTable: Command = (state, dispatch) => {
  const found = tableAround(state);
  if (!found) return false;
  if (found.node.attrs.pretty === true) return false;
  if (dispatch) {
    dispatch(state.tr.setNodeMarkup(found.from, undefined, { ...found.node.attrs, pretty: true }));
  }
  return true;
};

/**
 * Put the table on the clipboard as both markdown and HTML.
 *
 * The write is asynchronous and the command is not, so the promise is started
 * and not waited on. Nothing in the document changes, so there is nothing for a
 * failure to leave half done, and the reader finds out the ordinary way: by
 * pasting and seeing nothing.
 */
export const copyTable: Command = (state, dispatch) => {
  const found = tableAround(state);
  if (!found) return false;
  if (dispatch) {
    const markdown = blockToMarkdown(found.node);
    const html = tableToHtml(found.node);
    void writeClipboard(markdown, html);
  }
  return true;
};

async function writeClipboard(markdown: string, html: string): Promise<void> {
  try {
    await navigator.clipboard.write([new ClipboardItem({
      'text/plain': new Blob([markdown], { type: 'text/plain' }),
      'text/html': new Blob([html], { type: 'text/html' }),
    })]);
  } catch {
    // A browser that will not take two flavours at once still takes one, and
    // the markdown is the one that matters in a markdown editor.
    await navigator.clipboard.writeText(markdown).catch(() => {});
  }
}
