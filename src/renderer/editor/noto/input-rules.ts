/**
 * Markdown input rules.
 *
 * This is most of what makes an editor feel like Typora: you type markdown and
 * it becomes the thing, immediately, without a preview pane. Block rules use
 * ProseMirror's built in helpers; inline mark rules need a custom handler
 * because `prosemirror-inputrules` only rewrites text and node types.
 */

import {
  InputRule,
  ellipsis,
  emDash,
  inputRules,
  smartQuotes,
  textblockTypeInputRule,
  wrappingInputRule,
} from 'prosemirror-inputrules';
import type { MarkType, NodeType } from 'prosemirror-model';
import type { EditorState, Plugin, Transaction } from 'prosemirror-state';
import { notoSchema } from '../../../shared/markdown/v3/pm/schema';

export interface InputRuleOptions {
  /**
   * Rewrite straight quotes, `...` and `--` as typographic characters.
   *
   * Off by default, unlike Typora. These rules change the bytes the user's file
   * ends up holding, which is a frequent complaint when writing technical
   * documents, so it is a setting rather than a default.
   */
  /** A function so the setting can change while the editor is open. */
  /** Each substitution answers for itself, as it does in Typora's Edit menu. */
  readonly smartQuotes?: () => boolean;
  readonly smartDashes?: () => boolean;
  readonly smartEllipsis?: () => boolean;
}

/**
 * Apply a mark to the text captured by `pattern`, then delete the markers.
 *
 * The single capture group is the content. Markers are removed back to front so
 * the earlier offsets stay valid.
 */
function markInputRule(pattern: RegExp, markType: MarkType): InputRule {
  return new InputRule(pattern, (state, match, start, end) => {
    const content = match[1];
    if (content === undefined || content.length === 0) return null;

    const contentStart = start + match[0].indexOf(content);
    const contentEnd = contentStart + content.length;

    const tr = state.tr;
    if (end > contentEnd) tr.delete(contentEnd, end);
    if (contentStart > start) tr.delete(start, contentStart);
    tr.addMark(start, start + content.length, markType.create());
    // Otherwise the mark would keep applying to whatever is typed next.
    tr.removeStoredMark(markType);
    return tr;
  });
}

/** `$x$` becomes a real inline math node, not code-marked text. */
function inlineMathRule(): InputRule {
  return new InputRule(/\$([^$\s][^$]*)\$$/, (state, match, start, end) => {
    const content = match[1];
    if (content === undefined || content.length === 0) return null;
    return state.tr.replaceRangeWith(
      start,
      end,
      notoSchema.nodes.math_inline.create(null, notoSchema.text(content)),
    );
  });
}

/**
 * `[ ] ` or `[x] ` at the start of a list item turns it into a task.
 *
 * This cannot be one rule matching `- [ ] `, because typing the space after the
 * bullet already converts the paragraph into a list; by the time the brackets
 * arrive the `- ` is list structure rather than text. So the marker is matched
 * on its own and applied to the item that already exists.
 */
function taskMarkerRule(itemType: NodeType): InputRule {
  return new InputRule(/^\[([ xX])\]\s$/, (state, match, start, end) => {
    const $start = state.doc.resolve(start);
    for (let depth = $start.depth; depth > 0; depth -= 1) {
      const node = $start.node(depth);
      if (node.type !== itemType) continue;
      // The item's position precedes the deleted marker, so it stays valid.
      const itemPosition = $start.before(depth);
      const tr = state.tr.delete(start, end);
      tr.setNodeMarkup(itemPosition, undefined, { ...node.attrs, checked: match[1] !== ' ' });
      return tr;
    }
    return null;
  });
}

const { nodes, marks } = notoSchema;

/**
 * Wrap rules so they only fire while `enabled` is true.
 *
 * The rules stay registered either way. Rebuilding the plugin list to add or
 * remove them would replace the history plugin along with it, which would cost
 * the user their undo stack for a typography preference.
 */
function gatedRules(rules: readonly InputRule[], enabled: () => boolean): InputRule[] {
  return rules.map((rule) => new InputRule(
    // The match expression is reachable on the rule; only the handler is gated.
    (rule as unknown as { match: RegExp }).match,
    (state, match, start, end) => {
      if (!enabled()) return null;
      const handler = (rule as unknown as {
        handler: (
          state: EditorState, match: RegExpMatchArray, start: number, end: number,
        ) => Transaction | null;
      }).handler;
      return handler(state, match, start, end);
    },
  ));
}

export function notoInputRules(options: InputRuleOptions = {}): Plugin {
  const quotes = options.smartQuotes ?? (() => false);
  const dashes = options.smartDashes ?? (() => false);
  const dots = options.smartEllipsis ?? (() => false);
  return inputRules({
    rules: [
      ...gatedRules([...smartQuotes], quotes),
      ...gatedRules([emDash], dashes),
      ...gatedRules([ellipsis], dots),

      // Blocks
      textblockTypeInputRule(/^(#{1,6})\s$/, nodes.heading, (match) => ({ level: match[1].length })),
      textblockTypeInputRule(/^```([a-zA-Z0-9+#.-]*)\s$/, nodes.code_block,
        (match) => ({ lang: match[1] ?? '', fenced: true })),
      textblockTypeInputRule(/^\$\$\s$/, nodes.math_block),
      wrappingInputRule(/^\s*>\s$/, nodes.blockquote),
      wrappingInputRule(/^\s*([-+*])\s$/, nodes.bullet_list, () => ({ spread: false })),
      taskMarkerRule(nodes.list_item),
      wrappingInputRule(
        /^(\d+)\.\s$/,
        nodes.ordered_list,
        (match) => ({ start: Number(match[1]), spread: false }),
        (match, node) => node.childCount + (node.attrs.start as number) === Number(match[1]),
      ),
      new InputRule(/^(?:---|___|\*\*\*)$/, (state, _match, start, end) =>
        state.tr.replaceRangeWith(start, end, nodes.horizontal_rule.create())),

      // Inline. Strong is tried before emphasis so `**x**` is not read as `*` plus `*x*`.
      markInputRule(/\*\*([^*]+)\*\*$/, marks.strong),
      markInputRule(/__([^_]+)__$/, marks.strong),
      markInputRule(/(?:^|[^*])\*([^*\s][^*]*)\*$/, marks.emphasis),
      markInputRule(/(?:^|[^_])_([^_\s][^_]*)_$/, marks.emphasis),
      markInputRule(/~~([^~]+)~~$/, marks.strikethrough),
      markInputRule(new RegExp('`([^`]+)`$'), marks.inline_code),
      inlineMathRule(),
    ],
  });
}
