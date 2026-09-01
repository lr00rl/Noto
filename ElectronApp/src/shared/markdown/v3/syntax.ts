/**
 * The single definition of which markdown dialect Noto speaks.
 *
 * Both the main process parser and the renderer's ProseMirror bridge import
 * from here, so a construct can never be editable on one side of the IPC
 * boundary and opaque on the other. Nothing in this module touches Node
 * builtins, because the renderer runs sandboxed without Node integration.
 */

import { fromMarkdown } from 'mdast-util-from-markdown';
import { toMarkdown, type Options as ToMarkdownOptions } from 'mdast-util-to-markdown';
import { gfm } from 'micromark-extension-gfm';
import { gfmFromMarkdown, gfmToMarkdown } from 'mdast-util-gfm';
import { math } from 'micromark-extension-math';
import { mathFromMarkdown, mathToMarkdown } from 'mdast-util-math';
import { frontmatter } from 'micromark-extension-frontmatter';
import { frontmatterFromMarkdown, frontmatterToMarkdown } from 'mdast-util-frontmatter';
import type { Nodes, Root, RootContent } from 'mdast';

// YAML only. TOML frontmatter has no mdast node type and no meaningful adoption
// in the editors Noto has to interoperate with.
const micromarkExtensions = [
  gfm(),
  math({ singleDollarTextMath: true }),
  frontmatter(),
];

const mdastExtensions = [
  gfmFromMarkdown(),
  mathFromMarkdown(),
  frontmatterFromMarkdown(),
];

/**
 * Serializer settings chosen to match the conventions most markdown files in
 * the wild already use, so that re-serializing a block the user edited produces
 * the smallest possible diff against the rest of their document.
 */
const serializerOptions: ToMarkdownOptions = {
  bullet: '-',
  emphasis: '_',
  strong: '*',
  fence: '`',
  fences: true,
  listItemIndent: 'one',
  rule: '-',
  ruleSpaces: false,
  tightDefinitions: true,
  extensions: [gfmToMarkdown(), mathToMarkdown(), frontmatterToMarkdown()],
};

/**
 * Parse markdown into an mdast tree with source positions.
 *
 * `text` must already have any BOM removed, because micromark treats a leading
 * U+FEFF as content and it would shift every offset by one.
 */
export function parseMarkdown(text: string): Root {
  return fromMarkdown(text, { extensions: micromarkExtensions, mdastExtensions });
}

/**
 * Render a single mdast node back to markdown.
 *
 * Only used for blocks the user actually edited. Untouched blocks are sliced
 * from the original source instead, which is what keeps saves byte exact.
 */
export function renderMarkdown(node: Nodes): string {
  return toMarkdown(node, serializerOptions);
}

/**
 * Top level children of a parsed document, which is the granularity at which
 * Noto tracks source provenance.
 */
export function topLevelNodes(root: Root): readonly RootContent[] {
  return root.children;
}
