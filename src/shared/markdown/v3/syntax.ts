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
/**
 * `[[wiki links]]` survive a re-serialize.
 *
 * The serializer escapes `[` in text, because a bare `[` can open a link
 * reference and it cannot know whether a matching definition exists elsewhere.
 * That is right in general and wrong here: it turns `[[note]]` into
 * `\[\[note]]`, so editing any paragraph containing a wiki link rewrites it,
 * and the link stops being one. The bug predates wiki links being rendered; it
 * was simply invisible while nothing looked for them.
 *
 * The exemption is narrow on purpose. Only a complete `[[...]]` with no
 * brackets, pipes or newlines inside is emitted verbatim; every other character
 * of the text still goes through the serializer's own escaping. A document
 * that also defines `[note]: …` would have its meaning changed by this, which
 * is the case the blanket escape defends. That collision needs a definition
 * whose label is exactly a wiki link's target, in a vault where `[[note]]` is
 * already being written as a link; between breaking that and breaking every
 * wiki link in the vault, this is the better trade, and it is recorded here so
 * the trade is visible rather than discovered.
 */
const WIKI_LINK_RUN = /\[\[[^[\]\n|]+(?:\|[^[\]\n]*)?\]\]/g;

const wikiLinkSafeText: ToMarkdownOptions = {
  handlers: {
    text(node, _parent, state, info) {
      const value = node.value;
      WIKI_LINK_RUN.lastIndex = 0;
      if (!WIKI_LINK_RUN.test(value)) return state.safe(value, info);

      /*
       * Each ordinary segment is escaped with its real neighbours.
       *
       * `safe` decides from `before` and `after` whether a character sits at a
       * boundary that needs escaping, so a segment escaped as though it were
       * the whole string gets its leading and trailing spaces turned into
       * `&#x20;`. The neighbours here are known exactly: a segment before a
       * link is followed by `[`, one after a link is preceded by `]`.
       */
      WIKI_LINK_RUN.lastIndex = 0;
      let out = '';
      let last = 0;
      for (;;) {
        const match = WIKI_LINK_RUN.exec(value);
        if (match === null) break;
        if (match.index > last) {
          out += state.safe(value.slice(last, match.index), {
            ...info,
            before: last === 0 ? info.before : ']',
            after: '[',
          });
        }
        out += match[0];
        last = match.index + match[0].length;
      }
      if (last < value.length) {
        out += state.safe(value.slice(last), { ...info, before: ']' });
      }
      return out;
    },
  },
};

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
  extensions: [gfmToMarkdown(), mathToMarkdown(), frontmatterToMarkdown(), wikiLinkSafeText],
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
