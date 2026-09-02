/**
 * Syntax highlighting for fenced code, as ProseMirror decorations.
 *
 * Typora runs a CodeMirror instance per fence, so a document with fifty code
 * blocks carries fifty editors. Noto tokenises the text and paints decorations
 * over the one editor it already has, which costs nothing at rest.
 *
 * Tokenisation results are cached against the ProseMirror node itself. Nodes are
 * immutable and persistent, so an untouched fence is the same object after an
 * edit elsewhere and is never re-tokenised. Editing one block in a document full
 * of code re-highlights that block alone.
 */

import Prism from 'prismjs';
import { Plugin, PluginKey, type EditorState, type Transaction } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import type { Node as ProseNode } from 'prosemirror-model';

// Prism resolves languages from a registry its component files write into, and
// the order matters: several build on `clike` or `javascript`.
import 'prismjs/components/prism-markup';
import 'prismjs/components/prism-css';
import 'prismjs/components/prism-clike';
import 'prismjs/components/prism-javascript';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-jsx';
import 'prismjs/components/prism-tsx';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-yaml';
import 'prismjs/components/prism-markdown';
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-rust';
import 'prismjs/components/prism-go';
import 'prismjs/components/prism-java';
import 'prismjs/components/prism-c';
import 'prismjs/components/prism-cpp';
import 'prismjs/components/prism-sql';
import 'prismjs/components/prism-diff';
import 'prismjs/components/prism-toml';
// The rest follows the languages the author's vault actually fences, by count.
import 'prismjs/components/prism-haskell';
import 'prismjs/components/prism-docker';
import 'prismjs/components/prism-nginx';
import 'prismjs/components/prism-ini';
import 'prismjs/components/prism-lua';
import 'prismjs/components/prism-ruby';
import 'prismjs/components/prism-markup-templating';
import 'prismjs/components/prism-php';
import 'prismjs/components/prism-csharp';
import 'prismjs/components/prism-powershell';
import 'prismjs/components/prism-http';
import 'prismjs/components/prism-vim';
import 'prismjs/components/prism-makefile';
import 'prismjs/components/prism-swift';
import 'prismjs/components/prism-kotlin';
import 'prismjs/components/prism-scss';
import 'prismjs/components/prism-lisp';
import 'prismjs/components/prism-json5';
import 'prismjs/components/prism-properties';
import 'prismjs/components/prism-latex';
import 'prismjs/components/prism-r';
import 'prismjs/components/prism-perl';
import 'prismjs/components/prism-regex';
import 'prismjs/components/prism-elixir';
import 'prismjs/components/prism-erlang';
import 'prismjs/components/prism-scala';
import 'prismjs/components/prism-dart';
import 'prismjs/components/prism-groovy';
import 'prismjs/components/prism-zig';
import 'prismjs/components/prism-protobuf';
import 'prismjs/components/prism-graphql';
import 'prismjs/components/prism-objectivec';

export const highlightKey = new PluginKey<DecorationSet>('noto-syntax-highlight');

/** Names users actually write in a fence, mapped to Prism's registry names. */
const ALIASES: Readonly<Record<string, string>> = {
  ts: 'typescript',
  js: 'javascript',
  jsx: 'jsx',
  tsx: 'tsx',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  console: 'bash',
  py: 'python',
  rs: 'rust',
  golang: 'go',
  yml: 'yaml',
  html: 'markup',
  xml: 'markup',
  svg: 'markup',
  vue: 'markup',
  md: 'markdown',
  'c++': 'cpp',
  cs: 'csharp',
  'c#': 'csharp',
  kt: 'kotlin',
  kts: 'kotlin',
  dockerfile: 'docker',
  jsonc: 'json',
  elisp: 'lisp',
  el: 'lisp',
  hs: 'haskell',
  rb: 'ruby',
  ps1: 'powershell',
  pwsh: 'powershell',
  pl: 'perl',
  tex: 'latex',
  mk: 'makefile',
  make: 'makefile',
  objc: 'objectivec',
  ex: 'elixir',
  exs: 'elixir',
  proto: 'protobuf',
  gql: 'graphql',
};

interface TokenRange {
  readonly from: number;
  readonly to: number;
  readonly className: string;
}

/**
 * Ranges are stored relative to the start of the block, because a fence keeps
 * its tokens when unrelated text before it shifts every absolute position.
 */
const cache = new WeakMap<ProseNode, readonly TokenRange[]>();

function grammarFor(lang: string): Prism.Grammar | null {
  const normalized = ALIASES[lang.toLowerCase()] ?? lang.toLowerCase();
  return Prism.languages[normalized] ?? null;
}

function classesOf(token: Prism.Token): string {
  const alias = Array.isArray(token.alias) ? token.alias : token.alias ? [token.alias] : [];
  return ['token', token.type, ...alias].join(' ');
}

/**
 * Flatten Prism's nested tokens into leaf ranges.
 *
 * Only leaves are emitted. Painting parents as well would stack decorations
 * over the same text for no visual gain and more work for the view.
 */
function flatten(
  tokens: readonly (string | Prism.Token)[],
  start: number,
  out: TokenRange[],
): number {
  let offset = start;
  for (const token of tokens) {
    if (typeof token === 'string') {
      offset += token.length;
      continue;
    }
    if (Array.isArray(token.content)) {
      offset = flatten(token.content as (string | Prism.Token)[], offset, out);
      continue;
    }
    const text = typeof token.content === 'string' ? token.content : String(token.content);
    if (text.length > 0) out.push({ from: offset, to: offset + text.length, className: classesOf(token) });
    offset += text.length;
  }
  return offset;
}

export function rangesFor(node: ProseNode): readonly TokenRange[] {
  const cached = cache.get(node);
  if (cached) return cached;

  const lang = String(node.attrs.lang ?? '');
  const grammar = lang ? grammarFor(lang) : null;
  const ranges: TokenRange[] = [];
  // An unknown or absent language stays plain rather than being guessed at.
  if (grammar) flatten(Prism.tokenize(node.textContent, grammar), 0, ranges);

  cache.set(node, ranges);
  return ranges;
}

/** Decorations for every code block overlapping a range of the document. */
function decorationsIn(doc: ProseNode, from: number, to: number): Decoration[] {
  const decorations: Decoration[] = [];
  doc.nodesBetween(from, to, (node, position) => {
    if (node.type.name !== 'code_block') return true;
    for (const range of rangesFor(node)) {
      // `position + 1` steps past the node's own opening token into its text.
      decorations.push(Decoration.inline(
        position + 1 + range.from,
        position + 1 + range.to,
        { class: range.className },
      ));
    }
    // Nothing inside a code block needs visiting.
    return false;
  });
  return decorations;
}

function buildDecorations(doc: ProseNode): DecorationSet {
  return DecorationSet.create(doc, decorationsIn(doc, 0, doc.content.size));
}

/**
 * The span of the new document a transaction touched, widened to whole top
 * level blocks.
 *
 * Widening matters because a keystroke inside a fence reports only the
 * inserted character, while the tokens that have to be recomputed belong to
 * the entire fence: typing a quote can change how the rest of the line reads.
 */
function changedRange(transaction: Transaction, doc: ProseNode): { from: number; to: number } | null {
  let from = Infinity;
  let to = -Infinity;

  transaction.mapping.maps.forEach((map, index) => {
    const rest = transaction.mapping.slice(index + 1);
    map.forEach((_oldStart, _oldEnd, newStart, newEnd) => {
      from = Math.min(from, rest.map(newStart, -1));
      to = Math.max(to, rest.map(newEnd, 1));
    });
  });
  if (from > to) return null;

  const limit = doc.content.size;
  const $from = doc.resolve(Math.max(0, Math.min(from, limit)));
  const $to = doc.resolve(Math.max(0, Math.min(to, limit)));
  return {
    from: $from.depth > 0 ? $from.before(1) : Math.max(0, from),
    to: $to.depth > 0 ? $to.after(1) : Math.min(limit, to),
  };
}

export function syntaxHighlightPlugin(): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: highlightKey,
    state: {
      init: (_config, state: EditorState) => buildDecorations(state.doc),
      /**
       * Rebuild only what changed.
       *
       * Existing decorations are moved to their new positions rather than
       * recomputed, so the cost of a keystroke follows the size of the edit
       * instead of the size of the document. Rebuilding the whole set made
       * every keystroke walk every node, which is unusable once a document
       * holds thousands of blocks.
       */
      apply: (transaction, previous, _oldState, newState) => {
        if (!transaction.docChanged) return previous;
        const range = changedRange(transaction, newState.doc);
        if (!range) return previous.map(transaction.mapping, newState.doc);

        const moved = previous.map(transaction.mapping, newState.doc);
        const stale = moved.find(range.from, range.to);
        return moved
          .remove(stale)
          .add(newState.doc, decorationsIn(newState.doc, range.from, range.to));
      },
    },
    props: {
      decorations: (state) => highlightKey.getState(state),
    },
  });
}

/** Grammars other grammars are built on; nobody fences code as one of these. */
const SCAFFOLDING = new Set(['clike', 'markup-templating']);

/** The languages the editor can highlight, which is also what a fence's language field offers. */
export const supportedLanguages = (): readonly string[] =>
  Object.keys(Prism.languages).filter((name) => typeof Prism.languages[name] === 'object' && !SCAFFOLDING.has(name));
