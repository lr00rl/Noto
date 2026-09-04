/**
 * What copying puts on the clipboard: the markdown, not the words without it.
 *
 * The editor draws a document but the document is a text file, and a reader who
 * copies a bold sentence out of it and pastes it into anything else means the
 * bold to come too. Without this, ProseMirror hands over its own plain text and
 * every asterisk, backtick and bracket is dropped on the way out. Typora copies
 * markdown by default and the author has it set that way.
 *
 * Kept apart from the view so the shape of a partial selection can be tested
 * directly, which is the part that is easy to get wrong: a selection inside one
 * paragraph is a fragment of inline nodes with no block around it, and a
 * selection across two is a fragment of blocks.
 */

import { DOMSerializer, type Node, type Slice } from 'prosemirror-model';
import { notoSchema } from '../../../shared/markdown/v3/pm/schema';
import { blockToMarkdown } from '../../../shared/markdown/v3/pm/to-mdast';

/**
 * The markdown for a copied slice.
 *
 * Inline content is wrapped in one paragraph rather than one each, because a
 * mark that runs across two text nodes is one run of markdown and splitting it
 * would close and reopen the delimiters in the middle.
 */
export function sliceToMarkdown(slice: Slice): string {
  const content = slice.content;
  if (content.childCount === 0) return '';

  const first = content.firstChild;
  if (first && first.isInline) {
    return blockToMarkdown(notoSchema.nodes.paragraph.create(null, content));
  }

  const blocks: string[] = [];
  content.forEach((node) => {
    blocks.push(node.isInline
      ? blockToMarkdown(notoSchema.nodes.paragraph.create(null, node))
      : blockToMarkdown(node));
  });
  return blocks.join('\n\n');
}

/**
 * A table as HTML, for pasting somewhere that understands one.
 *
 * Markdown on the clipboard is right for another markdown editor and useless
 * everywhere else: a spreadsheet given `| a | b |` puts the whole row in one
 * cell. So a copied table carries both, and the receiving application takes
 * whichever it understands. This is what Typora's Copy Table does too.
 *
 * The borders are written inline rather than as a stylesheet because a pasted
 * fragment arrives without one, and a table with no rules is not a table on the
 * page it lands on.
 */
export function tableToHtml(node: Node): string {
  const cell = 'border: 1px solid #ccc; padding: 4px 8px;';
  const rows: string[] = [];
  node.forEach((row) => {
    const cells: string[] = [];
    row.forEach((child) => {
      const header = child.type.name === 'table_header';
      const align = child.attrs.align ? ` text-align: ${String(child.attrs.align)};` : '';
      const tag = header ? 'th' : 'td';
      cells.push(`<${tag} style="${cell}${align}">${escapeHtml(child.textContent)}</${tag}>`);
    });
    rows.push(`<tr>${cells.join('')}</tr>`);
  });
  return `<table style="border-collapse: collapse;">${rows.join('')}</table>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** The markdown for one block, which for a table is its source. */
export function nodeToMarkdown(node: Node): string {
  return blockToMarkdown(node);
}

/**
 * A copied selection as HTML, for pasting somewhere that draws rather than
 * reads.
 *
 * The schema's own `toDOM` specs are what the editor already draws with, and
 * they are semantic: a heading is an `h2`, a list is a `ul`, a link is an `a`.
 * So the serializer that builds the editor's own DOM builds the clipboard's
 * too, and there is no second description of the document to keep in step.
 */
export function sliceToHtml(slice: Slice): string {
  const fragment = DOMSerializer.fromSchema(notoSchema).serializeFragment(slice.content);
  const holder = document.createElement('div');
  holder.append(fragment);
  return holder.innerHTML;
}

/**
 * The editing chrome, which belongs to the window and not to the document.
 *
 * A line-number gutter, a copy button and a language picker are how a fence is
 * edited. In an exported page they are furniture from another room.
 */
const CHROME = [
  '.noto-fence-gutter',
  '.noto-fence-tools',
  '.noto-math-source',
  '.noto-table-rail',
  '.noto-table-handle',
  '.ProseMirror-separator',
  '.ProseMirror-trailingBreak',
  '.ProseMirror-gapcursor',
  '.noto-block-source-toggle',
].join(',');

/** Attributes that only mean something inside an editor. */
const EDITING_ATTRIBUTES = [
  'contenteditable', 'draggable', 'spellcheck', 'tabindex', 'role',
  'aria-hidden', 'aria-label', 'aria-expanded', 'data-testid', 'title',
];

/**
 * The whole document as HTML, for export.
 *
 * Taken from what the editor has actually drawn rather than re-serialized from
 * the schema. The schema's `toDOM` is honest about structure and says nothing
 * about appearance: it gives a maths block as its TeX source, a fence as its
 * plain text and a diagram as the words that describe it. Exported through
 * that, a note full of formulas arrived as a page of backslashes.
 *
 * The node views have already done the work: KaTeX has rendered the maths,
 * Prism has coloured the code and mermaid has drawn the diagrams. So the
 * drawn tree is cloned and the editing furniture taken out of the copy, which
 * leaves the document and nothing else. The copy is why this cannot disturb
 * what is on screen.
 */
export function documentDomToHtml(root: HTMLElement): string {
  const copy = root.cloneNode(true) as HTMLElement;
  copy.querySelectorAll(CHROME).forEach((node) => node.remove());
  copy.querySelectorAll('*').forEach((node) => {
    for (const attribute of EDITING_ATTRIBUTES) node.removeAttribute(attribute);
  });
  // The classes are kept: they are what the exported stylesheet, and KaTeX's
  // own, hang on. Only the editor's own state classes go, since they describe
  // where a caret happens to be.
  copy.querySelectorAll('.noto-active-block').forEach((node) => node.classList.remove('noto-active-block'));
  reduceMathToMathml(copy);
  return copy.innerHTML;
}

/**
 * Leave the maths as MathML and drop KaTeX's own drawing of it.
 *
 * KaTeX writes both: a MathML tree for anything that reads the page, and a
 * tower of positioned spans for the eye, and its stylesheet is what hides the
 * first and arranges the second. An exported file has no stylesheet of KaTeX's
 * and no KaTeX fonts, so both would show at once and a formula would arrive as
 * the same symbols twice over, jumbled.
 *
 * MathML alone is the better half to keep. Chromium draws it natively, which is
 * what prints the PDF, so the formula arrives as a formula with nothing
 * embedded and no second stylesheet to carry.
 */
function reduceMathToMathml(root: HTMLElement): void {
  for (const rendered of [...root.querySelectorAll('.katex')]) {
    const math = rendered.querySelector('math');
    if (math) rendered.replaceWith(math);
  }
}

/**
 * The document as the schema describes it, for the clipboard.
 *
 * Structure without appearance is the right answer there: what is pasted into
 * another editor should be a heading, not a heading's pixels.
 */
export function documentToHtml(doc: Node): string {
  const fragment = DOMSerializer.fromSchema(notoSchema).serializeFragment(doc.content);
  const holder = document.createElement('div');
  holder.append(fragment);
  return holder.innerHTML;
}

/**
 * A copied selection as the words alone.
 *
 * For pasting into somewhere that would show the markdown as noise: a message,
 * a search field, a commit message. Blocks are separated by a blank line,
 * which is what a reader means by the text of two paragraphs.
 */
export function sliceToPlainText(slice: Slice): string {
  return slice.content.textBetween(0, slice.content.size, '\n\n');
}

/**
 * Copy through a selection and the copy command.
 *
 * Not the asynchronous clipboard API: the app's session refuses every
 * permission a page can ask for, that API asks for one, and a copy that fails
 * quietly is worse than none. The copy command needs no permission and is what
 * the editor's own Cmd+C already goes through. A textarea outside the editor
 * holds the text for the length of one command, so the editor's own selection
 * is never touched.
 *
 * yagni: if the command is ever withdrawn, the upgrade is a small channel to
 * main's clipboard, which is where the file menu's copy would live anyway.
 */
export function copyThroughSelection(text: string): boolean {
  return withTemporarySelection(text, null);
}

/**
 * Copy two flavours at once: the words, and the markup.
 *
 * A table copied as markdown alone is useless in a spreadsheet, which puts the
 * whole row in one cell, and copied as HTML alone is noise in a markdown
 * editor. Both go on the clipboard and the receiving application takes the one
 * it understands, which is what Typora's Copy Table does.
 */
export function copyRichThroughSelection(text: string, html: string): boolean {
  return withTemporarySelection(text, html);
}

function withTemporarySelection(text: string, html: string | null): boolean {
  const holder = document.createElement('textarea');
  holder.value = text;
  holder.setAttribute('aria-hidden', 'true');
  holder.style.position = 'fixed';
  holder.style.opacity = '0';
  document.body.append(holder);
  holder.select();

  // The command fires a copy event before it writes, which is the one moment
  // the clipboard takes more than one flavour without asking permission.
  const onCopy = (event: ClipboardEvent) => {
    if (html === null) return;
    event.clipboardData?.setData('text/plain', text);
    event.clipboardData?.setData('text/html', html);
    event.preventDefault();
  };
  document.addEventListener('copy', onCopy);

  let copied = false;
  try {
    copied = document.execCommand('copy');
  } finally {
    document.removeEventListener('copy', onCopy);
    holder.remove();
  }
  return copied;
}
