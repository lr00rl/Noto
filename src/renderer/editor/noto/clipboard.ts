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

import type { Slice } from 'prosemirror-model';
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
