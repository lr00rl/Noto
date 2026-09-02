/**
 * The single definition of which markdown dialect Noto speaks.
 *
 * Both the main process parser and the renderer's ProseMirror bridge import
 * from here, so a construct can never be editable on one side of the IPC
 * boundary and opaque on the other. Nothing in this module touches Node
 * builtins, because the renderer runs sandboxed without Node integration.
 */

import { fromMarkdown } from 'mdast-util-from-markdown';
import { defaultHandlers, toMarkdown, type Options as ToMarkdownOptions } from 'mdast-util-to-markdown';
import { gfm } from 'micromark-extension-gfm';
import { cjkFriendlyExtension } from 'micromark-extension-cjk-friendly';
import { cjkFriendlyToMarkdown } from 'mdast-util-to-markdown-cjk-friendly';
import { gfmFromMarkdown, gfmToMarkdown } from 'mdast-util-gfm';
import { math } from 'micromark-extension-math';
import { mathFromMarkdown, mathToMarkdown } from 'mdast-util-math';
import { frontmatter } from 'micromark-extension-frontmatter';
import { frontmatterFromMarkdown, frontmatterToMarkdown } from 'mdast-util-frontmatter';
import type { Nodes, Root, RootContent } from 'mdast';

// YAML only. TOML frontmatter has no mdast node type and no meaningful adoption
// in the editors Noto has to interoperate with.
const micromarkExtensions = [
  // One tilde is Typora's subscript, drawn in the editor; only a pair strikes.
  gfm({ singleTilde: false }),
  /*
   * Emphasis next to Chinese text.
   *
   * CommonMark decides whether `**` can close by what sits either side of it,
   * and it counts CJK punctuation as punctuation, so `**注意：**一定` does not
   * close and the whole run stays as literal asterisks. Typora closes it, and
   * so does anyone reading the file. A census of the vault found 596 of 3,220
   * bold runs unparsed for this reason, in a quarter of its files: the reader
   * saw asterisks where they had written bold, and editing the paragraph
   * escaped them into the file for good measure.
   *
   * This is the CommonMark community's own CJK-friendly amendment to the
   * flanking rules rather than a rule invented here.
   */
  cjkFriendlyExtension(),
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
/**
 * One tilde is text.
 *
 * The parser reads `~2~` as the two characters and the digit, which is what
 * Typora does and what the vault writes for a subscript. The strikethrough
 * serializer, though, escapes every tilde in phrasing, so editing a paragraph
 * holding `H~2~O` saved it as `H\~2\~O`. Only a pair can strike now, so
 * only a tilde followed by another needs the escape.
 */
function tildeOnlyInPairs(extension: ToMarkdownOptions): ToMarkdownOptions {
  return {
    ...extension,
    unsafe: extension.unsafe?.map((rule) =>
      rule.character === '~' && rule.after === undefined ? { ...rule, after: '~' } : rule,
    ),
    extensions: extension.extensions?.map(tildeOnlyInPairs),
  };
}


/*
 * Runs the serializer must emit exactly as they are.
 *
 * `[[wiki links]]`, and the `[!NOTE]` marker that opens a GitHub alert. Both
 * begin with a `[`, which the serializer escapes because a bare `[` can open
 * a link reference and it cannot know whether a matching definition exists.
 * That is right in general and wrong for these two: escaping a wiki link
 * stops it being one, and escaping an alert's marker stops the quote being an
 * alert at all, so editing a callout would quietly turn it into a plain
 * quote. Both are recognised only in the shapes that cannot mean anything
 * else, and everything around them still goes through the escaping.
 */
/**
 * A word character for CommonMark's flanking rules: letters, digits, and the
 * CJK ideographs these notes are mostly written in. Spelled out rather than as
 * a unicode property, because the pattern is built without the unicode flag.
 */
const WORD = `[0-9A-Za-z\u00C0-\u024F\u3400-\u4DBF\u4E00-\u9FFF]`;

/*
 * An identifier is the third: a run of word characters joined by underscores,
 * `mcp__claude_api` or `search_mcp_register`. CommonMark will not open or
 * close emphasis on an underscore with a word character on either side, which
 * is the rule that lets snake_case be written plainly, but the serializer
 * escapes every underscore in phrasing regardless. Editing any paragraph
 * naming an identifier turned it into `mcp\_\_claude\_api`. The run holds
 * nothing but word characters and underscores, so emitting it whole escapes
 * nothing that needed escaping.
 */
const VERBATIM_RUN = new RegExp(
  [
    '\\[\\[[^[\\]\\n|]+(?:\\|[^[\\]\\n]*)?\\]\\]',
    '\\[!(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION)\\]',
    `${WORD}+(?:_+${WORD}+)+`,
  ].join('|'),
  'g',
);

/**
 * A URL written on its own stays written on its own.
 *
 * The serializer writes any link whose text is its own address as `<url>`,
 * which is correct markdown and not what these files say. The author's vault
 * holds 6,200 bare URLs against 145 in angle brackets, so re-serializing an
 * edited paragraph put brackets around six thousand addresses that never had
 * them, for a construct that appears in ordinary prose all the time.
 *
 * Only where it is unambiguous. The address has to be http or https, hold no
 * whitespace or angle brackets, and not end in punctuation, because GFM's own
 * autolink rule trims a trailing full stop or bracket off the end of a bare
 * URL and the address would come back shorter than it went in. Anything else
 * falls through to the serializer's own handler.
 */
const BARE_URL = /^https?:\/\/[^\s<>]*[^\s<>.,:;!?)\]]$/;

/**
 * A table's delimiter row, written the way the vault writes it.
 *
 * The serializer shortens each delimiter cell to a single dash, and pads every
 * cell out to its column's width when it is aligning. The vault does neither:
 * 4,039 of its delimiter rows are written with three dashes and two thirds of
 * its 43,076 table rows are unpadded. Alignment is turned off, which stops the
 * padding, and each delimiter cell is widened back to three dashes, which is
 * what a table looks like when a person writes one.
 *
 * The colons that carry a column's alignment are kept exactly where they were.
 */
export function widenDelimiterCells(line: string): string {
  return line.split('|').map((cell) => {
    const trimmed = cell.trim();
    if (!/^:?-+:?$/.test(trimmed)) return cell;
    const left = trimmed.startsWith(':') ? ':' : '';
    const right = trimmed.endsWith(':') ? ':' : '';
    const dashes = '-'.repeat(Math.max(3, trimmed.length - left.length - right.length));
    const lead = cell.startsWith(' ') ? ' ' : '';
    const tail = cell.endsWith(' ') ? ' ' : '';
    return `${lead}${left}${dashes}${right}${tail}`;
  }).join('|');
}

/** The table handler, with its delimiter row rewritten on the way out. */
function tablesAsTheVaultWritesThem(extension: ToMarkdownOptions): ToMarkdownOptions {
  const table = extension.handlers?.table;
  // The table handler lives in one of the GFM bundle's own sub-extensions
  // rather than at its top level, so the search goes down as well as across.
  const nested = extension.extensions?.map(tablesAsTheVaultWritesThem);
  if (typeof table !== 'function') {
    return nested ? { ...extension, extensions: nested } : extension;
  }
  return {
    ...extension,
    ...(nested ? { extensions: nested } : {}),
    handlers: {
      ...extension.handlers,
      table(node, parent, state, info) {
        const out = table.call(this, node, parent, state, info) as string;
        const lines = out.split('\n');
        if (lines.length < 2) return out;
        lines[1] = widenDelimiterCells(lines[1]);
        return lines.join('\n');
      },
    },
  };
}

const bareAutolink: ToMarkdownOptions = {
  handlers: {
    link(node, parent, state, info) {
      const [only] = node.children;
      if (
        node.children.length === 1
        && only?.type === 'text'
        && only.value === node.url
        && (node.title === null || node.title === undefined)
        && BARE_URL.test(node.url)
      ) {
        return node.url;
      }
      return defaultHandlers.link(node, parent, state, info);
    },
  },
};

const verbatimRunsInText: ToMarkdownOptions = {
  handlers: {
    text(node, _parent, state, info) {
      const value = node.value;
      VERBATIM_RUN.lastIndex = 0;
      if (!VERBATIM_RUN.test(value)) return state.safe(value, info);

      /*
       * Each ordinary segment is escaped with its real neighbours.
       *
       * `safe` decides from `before` and `after` whether a character sits at a
       * boundary that needs escaping, so a segment escaped as though it were
       * the whole string gets its leading and trailing spaces turned into
       * `&#x20;`. The neighbours here are known exactly: a segment before a
       * link is followed by `[`, one after a link is preceded by `]`.
       */
      VERBATIM_RUN.lastIndex = 0;
      let out = '';
      let last = 0;
      for (;;) {
        const match = VERBATIM_RUN.exec(value);
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
  // The vault writes emphasis with a star, 5,280 times against 364 with an
  // underscore, so an edited paragraph keeps the form the file already uses.
  emphasis: '*',
  strong: '*',
  fence: '`',
  fences: true,
  listItemIndent: 'one',
  rule: '-',
  ruleSpaces: false,
  tightDefinitions: true,
  extensions: [
    // The writing half of the CJK amendment. Without it the serializer keeps
    // CommonMark's own flanking rules and, believing the run cannot close,
    // escapes the Chinese character after it into a numeric reference.
    cjkFriendlyToMarkdown(),
    tablesAsTheVaultWritesThem(tildeOnlyInPairs(gfmToMarkdown({ tablePipeAlign: false }))), mathToMarkdown(), frontmatterToMarkdown(), verbatimRunsInText, bareAutolink],
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
