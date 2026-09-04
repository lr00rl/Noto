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
  selectionCell,
  TableMap,
  isInTable,
} from 'prosemirror-tables';
import { findWrapping } from 'prosemirror-transform';
import type { ResolvedPos } from 'prosemirror-model';
import { moveBlock, moveColumn } from './move-block';
import { enterInTable, tableFromRows, unwrapAtStart } from './block-edges';
import { openLinkEditor } from './link-plugin';
import { TextSelection, type Command, type Plugin, type Transaction } from 'prosemirror-state';
import { notoSchema } from '../../../shared/markdown/v3/pm/schema';
import {
  insertFootnote,
  insertFrontmatter,
  insertLinkReference,
  copyTable,
  insertTableOfContents,
  prettifyTable,
} from './insert-blocks';

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
 * Tick or untick the task the caret is in.
 *
 * Different from making a task list, which is what `toggleTaskList` does: that
 * one turns the state on and off, so an item that was ticked came back as no
 * task at all. This flips ticked and unticked and never leaves the list.
 *
 * Without it a box could only be ticked by putting the caret at the head of the
 * item and retyping `[x] ` so the input rule fires, which is not something
 * anybody would guess.
 */
export const toggleTaskStatus = (to?: boolean): Command => (state, dispatch) => {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    if (node.type !== nodes.list_item) continue;
    // Only an item that is already a task has a state to flip.
    if (node.attrs.checked === null) return false;
    const checked = to ?? !node.attrs.checked;
    if (checked === node.attrs.checked) return true;
    if (dispatch) {
      dispatch(state.tr.setNodeMarkup($from.before(depth), undefined, { ...node.attrs, checked }));
    }
    return true;
  }
  return false;
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

/** Typora's Select Word: the word around the caret, by letters and digits. */
export const selectWord: Command = (state, dispatch) => {
  const { $from } = state.selection;
  if (!$from.parent.isTextblock) return false;
  const text = $from.parent.textBetween(0, $from.parent.content.size, '\n', '\n');
  const offset = $from.parentOffset;
  const isWord = (character: string) => /[\p{L}\p{N}_]/u.test(character);
  let start = offset;
  while (start > 0 && isWord(text[start - 1])) start -= 1;
  let end = offset;
  while (end < text.length && isWord(text[end])) end += 1;
  if (start === end) return false;
  if (dispatch) {
    const base = $from.start();
    dispatch(state.tr.setSelection(TextSelection.create(state.doc, base + start, base + end)));
  }
  return true;
};

/** Typora's Select Line: the whole of the block the caret is in. */
export const selectLine: Command = (state, dispatch) => {
  const { $from } = state.selection;
  if (!$from.parent.isTextblock) return false;
  if (dispatch) {
    dispatch(state.tr.setSelection(TextSelection.create(state.doc, $from.start(), $from.end())));
  }
  return true;
};

/** Typora's Jump to Selection: bring the caret back into view after scrolling away. */
export const jumpToSelection: Command = (state, dispatch) => {
  if (dispatch) dispatch(state.tr.scrollIntoView());
  return true;
};

export type ColumnAlign = 'left' | 'center' | 'right' | null;

/**
 * Align the caret's column, header and every cell in it at once.
 *
 * Alignment in a markdown table belongs to the column, in the rule row, so
 * setting one cell would be a lie the file could not hold. Typora's toolbar
 * sets it the same way.
 */
export function alignColumn(align: ColumnAlign): Command {
  return (state, dispatch) => {
    if (!isInTable(state)) return false;
    const $cell = selectionCell(state);
    const table = $cell.node(-1);
    const start = $cell.start(-1);
    const map = TableMap.get(table);
    const index = map.map.indexOf($cell.pos - start);
    if (index < 0) return false;
    const column = index % map.width;
    if (dispatch) {
      const tr = state.tr;
      for (let row = 0; row < map.height; row += 1) {
        const pos = start + map.map[row * map.width + column];
        const cell = table.nodeAt(map.map[row * map.width + column]);
        if (cell && cell.attrs.align !== align) tr.setNodeMarkup(pos, undefined, { ...cell.attrs, align });
      }
      if (tr.docChanged) dispatch(tr);
    }
    return true;
  };
}

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
/**
 * Enter on an empty list item climbs out one level.
 *
 * Without this, `liftEmptyBlock` got there first and lifted the empty paragraph
 * clean out of its item, so pressing Enter at the end of a nested list dropped
 * you onto a line with no bullet instead of onto the level above. The author's
 * vault has 23,022 nested bullet lines across 1,340 notes, and climbing back
 * out of a nest is how every one of them was written.
 *
 * Guarded on the item being empty, or Enter in the middle of a list item would
 * outdent it rather than splitting it in two.
 */
export const outdentEmptyListItem: Command = (state, dispatch) => {
  const { $from, empty } = state.selection;
  if (!empty || $from.parent.content.size !== 0) return false;
  if ($from.depth < 2 || $from.node(-1).type !== nodes.list_item) return false;
  return liftListItem(nodes.list_item)(state, dispatch);
};

const enter: Command = chainCommands(
  tableFromRows,
  enterInTable,
  newlineInCode,
  createParagraphNear,
  outdentEmptyListItem,
  liftEmptyBlock,
  splitListItem(nodes.list_item),
  splitBlock,
);

/**
 * Every block-shaping command by name, so a menu can offer what the keyboard
 * already does. The keys and the menu run the same code rather than two
 * implementations that drift.
 */
/**
 * Take every inline mark off the selection.
 *
 * Typora calls this Clear Format. Passing no mark type removes them all, which
 * is what the reader means: the words stay and everything drawn around them
 * goes. Block type is left alone, because a heading that stopped being a
 * heading would be a different command.
 */
export const clearFormat: Command = (state, dispatch) => {
  const { from, to, empty } = state.selection;
  if (empty) return false;
  if (dispatch) dispatch(state.tr.removeMark(from, to));
  return true;
};

const ALERT_MARKER = /^\[!(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/;

/** The depth of the innermost blockquote around `$pos`, or null. */
function alertQuoteDepth($pos: ResolvedPos): number | null {
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    if ($pos.node(depth).type === nodes.blockquote) return depth;
  }
  return null;
}

/**
 * Write the marker at the head of the quote's first paragraph, in `transaction`.
 *
 * A quote that already carries one has it replaced rather than gaining a
 * second, so the five commands switch a callout between kinds.
 */
function writeMarker(transaction: Transaction, quotePos: number, kind: string): void {
  const quote = transaction.doc.nodeAt(quotePos);
  const first = quote?.firstChild;
  if (!quote || !first || !first.isTextblock) return;
  // Past the quote and into its first paragraph.
  const head = quotePos + 2;
  const existing = ALERT_MARKER.exec(first.textContent);
  if (existing) {
    transaction.replaceWith(head, head + existing[0].length, notoSchema.text(`[!${kind}]`));
  } else {
    // The break after the marker is the soft one the file has, a bare newline.
    // A hard break would be written as two trailing spaces, which is not what
    // `> [!NOTE]` looks like in anybody's note.
    transaction.insert(head, notoSchema.text(`[!${kind}]\n`));
  }
}

/**
 * Turn the block the caret is in into a GitHub alert.
 *
 * The alert is a quote whose first paragraph opens with `[!NOTE]` and a line
 * break, which is exactly what the file holds and what the editor draws a
 * title chip for. Nothing about it is a node type of its own, so this wraps in
 * a quote and writes the marker as text, the same two steps a reader would
 * take by hand, in one transaction so one undo takes both back.
 */
export function insertAlert(kind: 'NOTE' | 'TIP' | 'IMPORTANT' | 'WARNING' | 'CAUTION'): Command {
  return (state, dispatch) => {
    const { $from } = state.selection;
    const inside = alertQuoteDepth($from);
    if (inside !== null) {
      if (dispatch) {
        const transaction = state.tr;
        writeMarker(transaction, $from.before(inside), kind);
        dispatch(transaction);
      }
      return true;
    }

    const range = $from.blockRange();
    const wrapping = range && findWrapping(range, nodes.blockquote);
    if (!range || !wrapping) return false;
    if (dispatch) {
      const transaction = state.tr.wrap(range, wrapping);
      const $wrapped = transaction.doc.resolve(transaction.mapping.map($from.pos));
      const depth = alertQuoteDepth($wrapped);
      if (depth !== null) writeMarker(transaction, $wrapped.before(depth), kind);
      dispatch(transaction);
    }
    return true;
  };
}

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
  'task-toggle': toggleTaskStatus(),
  'task-complete': toggleTaskStatus(true),
  'task-incomplete': toggleTaskStatus(false),
  'block-rule': insertRule,
  'insert-footnote': insertFootnote,
  'insert-toc': insertTableOfContents,
  'insert-frontmatter': insertFrontmatter,
  'insert-link-reference': insertLinkReference,
  'mark-strong': toggleMark(marks.strong),
  'mark-emphasis': toggleMark(marks.emphasis),
  'mark-code': toggleMark(marks.inline_code),
  'mark-strike': toggleMark(marks.strikethrough),
  'mark-underline': surroundTag('u'),
  'mark-highlight': surround('==', '=='),
  'mark-math': wrapInMath,
  'table-insert': insertTable(2, 3),
  'table-prettify': prettifyTable,
  'table-copy': copyTable,
  'table-row-above': addRowBefore,
  'table-row-below': addRowAfter,
  'table-column-before': addColumnBefore,
  'table-column-after': addColumnAfter,
  'table-row-delete': deleteRow,
  'table-column-delete': deleteColumn,
  'table-delete': deleteTable,
  'table-align-left': alignColumn('left'),
  'table-align-center': alignColumn('center'),
  'table-align-right': alignColumn('right'),
  'table-align-none': alignColumn(null),
  'move-up': moveBlock(true),
  'move-down': moveBlock(false),
  'move-column-left': moveColumn(true),
  'move-column-right': moveColumn(false),
  'insert-link': openLinkEditor,
  'select-word': selectWord,
  'select-line': selectLine,
  'jump-to-selection': jumpToSelection,
  'clear-format': clearFormat,
  'block-alert-note': insertAlert('NOTE'),
  'block-alert-tip': insertAlert('TIP'),
  'block-alert-important': insertAlert('IMPORTANT'),
  'block-alert-warning': insertAlert('WARNING'),
  'block-alert-caution': insertAlert('CAUTION'),
};

/**
 * Every chord the editor answers to.
 *
 * Exported so a test can set it beside the application menu's accelerators.
 * The two lists collided once: the menu gave Command and a bracket to the page
 * width while these gave the same pair to list indentation, and a native
 * accelerator is handled before the document ever sees the key, so indenting a
 * list item from the keyboard did nothing at all.
 */
export interface KeymapOptions {
  readonly mac: boolean;
  /**
   * Widen or narrow the writing column.
   *
   * Not a document command, so it is handed in rather than imported: the width
   * belongs to the shell, and the editor only knows which key was pressed.
   */
  readonly onWidthStep?: (direction: 1 | -1) => void;
}

export function notoBindings({ mac, onWidthStep }: KeymapOptions): Record<string, Command> {
  const mod = mac ? 'Meta' : 'Ctrl';
  /**
   * The width, when the brackets are not doing something else.
   *
   * Command and a bracket is the page width in the author's own Typora plugin
   * and list indentation in Typora itself, and both are right where they apply.
   * A list wins, because inside a list that is unambiguously what the key means
   * and Tab is not always available there; everywhere else there is no list to
   * indent and the key would otherwise do nothing at all.
   */
  const stepWidth = (direction: 1 | -1): Command => () => {
    if (!onWidthStep) return false;
    onWidthStep(direction);
    return true;
  };
  return {
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
    [`${mod}-k`]: openLinkEditor,
    [`${mod}-Shift-Backspace`]: clearFormat,

    [`${mod}-z`]: undo,
    [`${mod}-Shift-z`]: redo,
    [`${mod}-y`]: redo,

    Enter: enter,
    // Typora's Backspace at the head of a block, tried before the ordinary one.
    Backspace: unwrapAtStart,
    'Shift-Enter': insertHardBreak,
    [`${mod}-Enter`]: insertHardBreak,

    Tab: chainCommands(nextCellOrRow, sinkListItem(nodes.list_item)),
    'Shift-Tab': chainCommands(goToNextCell(-1), liftListItem(nodes.list_item)),
    // Typora's own: one key moves a line of code, a table row, or the block
    // itself, depending on what the caret is in. Columns get their own.
    'Alt-ArrowUp': moveBlock(true),
    'Alt-ArrowDown': moveBlock(false),
    [`${mod}-Ctrl-ArrowLeft`]: moveColumn(true),
    [`${mod}-Ctrl-ArrowRight`]: moveColumn(false),

    // Typora's own chord for it.
    'Ctrl-x': toggleTaskStatus(),
    [`${mod}-]`]: chainCommands(sinkListItem(nodes.list_item), stepWidth(1)),
    [`${mod}-[`]: chainCommands(liftListItem(nodes.list_item), stepWidth(-1)),
  };
}

export function notoKeymap(options: KeymapOptions): Plugin[] {
  return [keymap(notoBindings(options)), keymap(baseKeymap)];
}
