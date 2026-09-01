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
import { liftListItem, sinkListItem, splitListItem } from 'prosemirror-schema-list';
import { redo, undo } from 'prosemirror-history';
import { goToNextCell } from 'prosemirror-tables';
import type { Command, Plugin } from 'prosemirror-state';
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
    [`${mod}-Shift-q`]: wrapIn(nodes.blockquote),

    [`${mod}-z`]: undo,
    [`${mod}-Shift-z`]: redo,
    [`${mod}-y`]: redo,

    Enter: enter,
    'Shift-Enter': insertHardBreak,
    [`${mod}-Enter`]: insertHardBreak,

    Tab: chainCommands(goToNextCell(1), sinkListItem(nodes.list_item)),
    'Shift-Tab': chainCommands(goToNextCell(-1), liftListItem(nodes.list_item)),
    [`${mod}-]`]: sinkListItem(nodes.list_item),
    [`${mod}-[`]: liftListItem(nodes.list_item),
  };

  return [keymap(bindings), keymap(baseKeymap)];
}
