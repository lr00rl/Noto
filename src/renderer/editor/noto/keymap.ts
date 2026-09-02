/**
 * Keyboard bindings.
 *
 * Deliberately matches Typora where Typora has an established binding, so
 * muscle memory carries over. `Mod` resolves to Command on macOS and Control
 * elsewhere, which is why the platform is passed in rather than sniffed: the
 * main process already knows it and guessing from the user agent is unreliable.
 */

import { keymap } from 'prosemirror-keymap';
import {
  baseKeymap,
  chainCommands,
  createParagraphNear,
  exitCode,
  liftEmptyBlock,
  newlineInCode,
  setBlockType,
  splitBlock,
  toggleMark,
  wrapIn,
} from 'prosemirror-commands';
import { liftListItem, sinkListItem, splitListItem, wrapInList } from 'prosemirror-schema-list';
import { redo, undo } from 'prosemirror-history';
import {
  addColumnAfter,
  addColumnBefore,
  addRowAfter,
  addRowBefore,
  deleteColumn,
  deleteRow,
  deleteTable,
  goToNextCell,
  isInTable,
} from 'prosemirror-tables';
import { TextSelection, type Command, type Plugin } from 'prosemirror-state';
import { notoSchema } from '../../../shared/markdown/v3/pm/schema';

const { nodes, marks } = notoSchema;

/** Insert a hard break, or leave a code block when the cursor is at its end. */
const insertHardBreak: Command = chainCommands(exitCode, (state, dispatch) => {
  if (dispatch) {
    dispatch(state.tr.replaceSelectionWith(nodes.hard_break.create()).scrollIntoView());
  }
  return true;
});

/**
 * Wrap the selection in a pair of literal delimiters.
 *
 * For the syntaxes markdown has no mark for and Typora has a key for anyway:
 * `==highlight==`, `<u>underline</u>` and `$maths$`. The characters go into
 * the document, which is what makes them survive a save; the editor draws
 * them as the thing they mean and hides them again once the caret leaves.
 *
 * With nothing selected the pair is inserted and the caret placed between
 * them, so the key can be pressed before the words as well as after.
 */
/** Exported so the behaviour can be tested without a DOM to press keys in. */
export function surround(open: string, close: string): Command {
  return (state, dispatch) => {
    const { $from, from, to, empty } = state.selection;
    // Not in a fence: there the characters would be code, not syntax.
    if (!$from.parent.isTextblock || $from.parent.type.spec.code) return false;
    if (!dispatch) return true;
    const tr = state.tr;
    if (empty) {
      tr.insertText(open + close, from);
      tr.setSelection(TextSelection.create(tr.doc, from + open.length));
    } else {
      // The end first, so the start's positions are still the ones measured.
      tr.insertText(close, to);
      tr.insertText(open, from);
      tr.setSelection(TextSelection.create(tr.doc, from + open.length, to + open.length));
    }
    dispatch(tr.scrollIntoView());
    return true;
  };
}

/**
 * Typora's Increase and Decrease Heading Level, which walk the one scale from
 * a paragraph up to a first-level heading and back down again rather than
 * jumping to a level by number.
 */
/**
 * Wrap the selection in an HTML tag, as Typora's Underline does.
 *
 * The tag goes in as `inline_html` nodes rather than as text. Text is escaped
 * on the way back out, since a bare `<` in a paragraph could open anything,
 * so a tag typed as text would be saved as `\<u>` and stop being a tag. As
 * nodes it is what it says it is, and the editor already draws a bare
 * formatting tag as the shape it names.
 */
export function surroundTag(tag: string): Command {
  return (state, dispatch) => {
    const { $from, from, to, empty } = state.selection;
    if (!$from.parent.isTextblock || $from.parent.type.spec.code) return false;
    if (!dispatch) return true;
    const open = nodes.inline_html.create({ value: `<${tag}>` });
    const close = nodes.inline_html.create({ value: `</${tag}>` });
    const tr = state.tr;
    // The end first, so the start's positions are still the ones measured.
    tr.insert(to, close);
    tr.insert(from, open);
    tr.setSelection(empty
      ? TextSelection.create(tr.doc, from + open.nodeSize)
      : TextSelection.create(tr.doc, from + open.nodeSize, to + open.nodeSize));
    dispatch(tr.scrollIntoView());
    return true;
  };
}

/**
 * Turn the selection into inline maths, as Typora's Inline Math does.
 *
 * A `math_inline` node rather than a pair of dollar signs, for the same
 * reason the tag is a node: a `$` written into a paragraph is escaped on the
 * way out and stops being maths.
 */
export const wrapInMath: Command = (state, dispatch) => {
  const { $from, from, to, empty } = state.selection;
  if (!$from.parent.isTextblock || $from.parent.type.spec.code) return false;
  if (empty) return false;
  const text = state.doc.textBetween(from, to);
  if (text.trim().length === 0) return false;
  if (dispatch) {
    const math = nodes.math_inline.create(null, notoSchema.text(text));
    dispatch(state.tr.replaceRangeWith(from, to, math).scrollIntoView());
  }
  return true;
};

/**
 * Turn the block into a task list, which is a bullet list whose items carry a
 * checked state. Already a task list, and the state comes off again, which is
 * what a toggle in a menu is expected to do.
 */
export const toggleTaskList: Command = (state, dispatch) => {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    if (node.type !== nodes.list_item) continue;
    const position = $from.before(depth);
    const checked = node.attrs.checked === null ? false : null;
    if (dispatch) dispatch(state.tr.setNodeMarkup(position, undefined, { ...node.attrs, checked }));
    return true;
  }
  // Not in a list yet: make one, then the next press marks it.
  return wrapInList(nodes.bullet_list)(state, dispatch);
};

/**
 * Tab out of the last cell makes a row, which is what every table editor does
 * and the only way a table grows without leaving the keyboard. Tried after
 * moving between cells, so it only fires where there is nowhere left to go.
 */
export const nextCellOrRow: Command = (state, dispatch, view) => {
  if (goToNextCell(1)(state, dispatch, view)) return true;
  if (!isInTable(state)) return false;
  return addRowAfter(state, dispatch)
    // The caret follows into the row that was just made.
    && goToNextCell(1)(view?.state ?? state, dispatch, view);
};

/** A table of the given shape, with a header row, where the caret is. */
export function insertTable(rows: number, columns: number): Command {
  return (state, dispatch) => {
    if (!state.selection.$from.parent.isTextblock) return false;
    if (dispatch) {
      const cell = (type: typeof nodes.table_cell) => type.createAndFill()!;
      const header = nodes.table_row.create(null, Array.from({ length: columns }, () => cell(nodes.table_header)));
      const body = Array.from({ length: rows }, () =>
        nodes.table_row.create(null, Array.from({ length: columns }, () => cell(nodes.table_cell))));
      dispatch(state.tr.replaceSelectionWith(nodes.table.create(null, [header, ...body])).scrollIntoView());
    }
    return true;
  };
}

/** Put a horizontal rule where the caret is, as Typora's Horizontal Line does. */
export const insertRule: Command = (state, dispatch) => {
  if (!state.selection.$from.parent.isTextblock) return false;
  if (dispatch) {
    dispatch(state.tr.replaceSelectionWith(nodes.horizontal_rule.create()).scrollIntoView());
  }
  return true;
};

/** Exported for the same reason as `surround`. */
export function shiftHeading(towardsTitle: boolean): Command {
  return (state, dispatch) => {
    const { $from } = state.selection;
    const block = $from.parent;
    if (block.type === nodes.paragraph) {
      return towardsTitle ? setBlockType(nodes.heading, { level: 1 })(state, dispatch) : false;
    }
    if (block.type !== nodes.heading) return false;
    const level = (block.attrs.level as number) + (towardsTitle ? -1 : 1);
    if (level < 1) return false;
    if (level > 6) return setBlockType(nodes.paragraph)(state, dispatch);
    return setBlockType(nodes.heading, { level })(state, dispatch);
  };
}

/**
 * Enter inside a list splits the item; everywhere else it behaves normally.
 * Ordering matters: the list case has to be tried before the generic split.
 */
const enter: Command = chainCommands(
  newlineInCode,
  createParagraphNear,
  liftEmptyBlock,
  splitListItem(nodes.list_item),
  splitBlock,
);

/**
 * Every block-shaping command by name, so a menu can offer what the keyboard
 * already does. The keys and the menu run the same code rather than two
 * implementations that drift.
 */
export const EDITOR_COMMANDS: Readonly<Record<string, Command>> = {
  'block-paragraph': setBlockType(nodes.paragraph),
  'block-heading-1': setBlockType(nodes.heading, { level: 1 }),
  'block-heading-2': setBlockType(nodes.heading, { level: 2 }),
  'block-heading-3': setBlockType(nodes.heading, { level: 3 }),
  'block-heading-4': setBlockType(nodes.heading, { level: 4 }),
  'block-heading-5': setBlockType(nodes.heading, { level: 5 }),
  'block-heading-6': setBlockType(nodes.heading, { level: 6 }),
  'block-heading-up': shiftHeading(true),
  'block-heading-down': shiftHeading(false),
  'block-code': setBlockType(nodes.code_block),
  'block-math': setBlockType(nodes.math_block),
  'block-quote': wrapIn(nodes.blockquote),
  'block-ordered-list': wrapInList(nodes.ordered_list),
  'block-bullet-list': wrapInList(nodes.bullet_list),
  'block-task-list': toggleTaskList,
  'block-rule': insertRule,
  'mark-underline': surroundTag('u'),
  'mark-highlight': surround('==', '=='),
  'mark-math': wrapInMath,
  'table-insert': insertTable(2, 3),
  'table-row-above': addRowBefore,
  'table-row-below': addRowAfter,
  'table-column-before': addColumnBefore,
  'table-column-after': addColumnAfter,
  'table-row-delete': deleteRow,
  'table-column-delete': deleteColumn,
  'table-delete': deleteTable,
};

export function notoKeymap({ mac }: { mac: boolean }): Plugin[] {
  const mod = mac ? 'Meta' : 'Ctrl';
  const bindings: Record<string, Command> = {
    [`${mod}-b`]: toggleMark(marks.strong),
    [`${mod}-i`]: toggleMark(marks.emphasis),
    [`${mod}-Shift-x`]: toggleMark(marks.strikethrough),
    [`${mod}-e`]: toggleMark(marks.inline_code),

    [`${mod}-0`]: setBlockType(nodes.paragraph),
    ...Object.fromEntries([1, 2, 3, 4, 5, 6].map((level) => [
      `${mod}-${level}`,
      setBlockType(nodes.heading, { level }),
    ])),

    [`${mod}-Shift-k`]: setBlockType(nodes.code_block),
    // Typora keeps its block types on Option and Command together.
    [`${mod}-Alt-c`]: setBlockType(nodes.code_block),
    [`${mod}-Alt-b`]: setBlockType(nodes.math_block),
    [`${mod}-Alt-q`]: wrapIn(nodes.blockquote),
    [`${mod}-Alt-o`]: wrapInList(nodes.ordered_list),
    [`${mod}-Alt-u`]: wrapInList(nodes.bullet_list),
    [`${mod}-Alt-x`]: toggleTaskList,
    [`${mod}-Alt--`]: insertRule,
    [`${mod}-Alt-t`]: insertTable(2, 3),
    // Typora's own bindings for the marks markdown has no key for, so a hand
    // that learned them there does not have to learn them again. Its inline
    // code, strike and maths are on Control rather than Command.
    'Ctrl-`': toggleMark(marks.inline_code),
    'Ctrl-Shift-`': toggleMark(marks.strikethrough),
    'Ctrl-m': wrapInMath,
    [`${mod}-u`]: surroundTag('u'),
    [`${mod}-Shift-h`]: surround('==', '=='),
    // Typora names these Command+plus and Command+minus. A keyboard gives the
    // plus only with Shift on most layouts, so both spellings are taken.
    [`${mod}-=`]: shiftHeading(true),
    [`${mod}-+`]: shiftHeading(true),
    [`${mod}--`]: shiftHeading(false),
    [`${mod}-Shift-q`]: wrapIn(nodes.blockquote),

    [`${mod}-z`]: undo,
    [`${mod}-Shift-z`]: redo,
    [`${mod}-y`]: redo,

    Enter: enter,
    'Shift-Enter': insertHardBreak,
    [`${mod}-Enter`]: insertHardBreak,

    Tab: chainCommands(nextCellOrRow, sinkListItem(nodes.list_item)),
    'Shift-Tab': chainCommands(goToNextCell(-1), liftListItem(nodes.list_item)),
    [`${mod}-]`]: sinkListItem(nodes.list_item),
    [`${mod}-[`]: liftListItem(nodes.list_item),
  };

  return [keymap(bindings), keymap(baseKeymap)];
}
