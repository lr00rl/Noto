/**
 * What Backspace and Enter do at the edges of a block, Typora's way.
 *
 * Typora's model is the markdown source: a heading is a line with `#` in front
 * of it, so Backspace at its start deletes the `#` and leaves a paragraph,
 * and a fence with nothing in it is two lines of backticks that Backspace
 * takes away. ProseMirror's own Backspace joins the block into the one before
 * it instead, which is right for a paragraph and wrong for these, because it
 * makes a heading disappear into the paragraph above it when the writer only
 * meant to demote it.
 *
 * In a table, Enter goes down a column rather than splitting a cell, and at
 * the bottom it makes a row, which is how a table is filled in from the
 * keyboard. And two typed lines that spell a table's header and its rule
 * become the table when Enter is pressed after the rule, which is what a hand
 * that writes markdown by habit expects to happen.
 */

import { TextSelection, type Command } from 'prosemirror-state';
import type { Node as ProseNode } from 'prosemirror-model';
import { TableMap, isInTable, selectionCell } from 'prosemirror-tables';
import { notoSchema } from '../../../shared/markdown/v3/pm/schema';

const { nodes } = notoSchema;

/**
 * Backspace at the start of a heading makes it a paragraph; at the start of
 * an empty fence or maths block, takes the block away. Anywhere else it
 * declines, and the ordinary Backspace runs.
 */
export const unwrapAtStart: Command = (state, dispatch) => {
  const { $from, empty } = state.selection;
  if (!empty || $from.parentOffset !== 0) return false;
  const block = $from.parent;
  if (block.type === nodes.heading) {
    if (dispatch) {
      dispatch(state.tr.setBlockType($from.before(), $from.after(), nodes.paragraph).scrollIntoView());
    }
    return true;
  }
  const codeLike = block.type === nodes.code_block || block.type === nodes.math_block;
  if (codeLike && block.content.size === 0) {
    if (dispatch) {
      const tr = state.tr.replaceWith($from.before(), $from.after(), nodes.paragraph.create());
      tr.setSelection(TextSelection.create(tr.doc, $from.before() + 1));
      dispatch(tr.scrollIntoView());
    }
    return true;
  }
  return false;
};

/**
 * Enter in a cell moves to the same column of the row below, making the row
 * when there is none. The new row's cells take the alignment of the column.
 */
export const enterInTable: Command = (state, dispatch) => {
  if (!isInTable(state)) return false;
  const $cell = selectionCell(state);
  const table = $cell.node(-1);
  const start = $cell.start(-1);
  const map = TableMap.get(table);
  const index = map.map.indexOf($cell.pos - start);
  if (index < 0) return false;
  const row = Math.floor(index / map.width);
  const column = index % map.width;
  if (!dispatch) return true;

  const tr = state.tr;
  let cellPos: number;
  if (row + 1 < map.height) {
    cellPos = start + map.map[(row + 1) * map.width + column];
  } else {
    const cells: ProseNode[] = [];
    for (let at = 0; at < map.width; at += 1) {
      const above = table.nodeAt(map.map[row * map.width + at]);
      cells.push(nodes.table_cell.create({ align: above?.attrs.align ?? null }));
    }
    const end = $cell.end(-1);
    tr.insert(end, nodes.table_row.create(null, cells));
    cellPos = end + 1;
    for (let at = 0; at < column; at += 1) cellPos += cells[at].nodeSize;
  }
  tr.setSelection(TextSelection.near(tr.doc.resolve(cellPos + 1)));
  dispatch(tr.scrollIntoView());
  return true;
};

/** A pipe that is not escaped ends a cell. */
const CELL_SPLIT = /(?<!\\)\|/;
const RULE_CELL = /^:?-+:?$/;

/** The cells of a typed row, or null when the line is not one. */
function cellsOf(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.includes('|')) return null;
  let inner = trimmed.startsWith('|') ? trimmed.slice(1) : trimmed;
  if (inner.endsWith('|') && !inner.endsWith('\\|')) inner = inner.slice(0, -1);
  return inner.split(CELL_SPLIT).map((cell) => cell.trim());
}

function alignOf(rule: string): 'left' | 'center' | 'right' | null {
  const left = rule.startsWith(':');
  const right = rule.endsWith(':');
  if (left && right) return 'center';
  if (right) return 'right';
  if (left) return 'left';
  return null;
}

/**
 * Enter at the end of a paragraph holding a table's rule, straight after a
 * paragraph holding its header, turns the two into the table with one empty
 * row to type into. The header's cells are taken as their text: a header is
 * a few words, and a word typed before its table has no marks to lose.
 */
export const tableFromRows: Command = (state, dispatch) => {
  const { $from, empty } = state.selection;
  const block = $from.parent;
  if (!empty || block.type !== nodes.paragraph) return false;
  if ($from.parentOffset !== block.content.size) return false;
  const rule = cellsOf(block.textContent);
  if (!rule || !rule.every((cell) => RULE_CELL.test(cell))) return false;

  const index = $from.index(-1);
  if (index === 0) return false;
  const previous = $from.node(-1).child(index - 1);
  if (previous.type !== nodes.paragraph) return false;
  const heads = cellsOf(previous.textContent);
  if (!heads || heads.length !== rule.length) return false;
  if (!dispatch) return true;

  const aligns = rule.map(alignOf);
  const header = nodes.table_row.create(null, heads.map((text, at) =>
    nodes.table_header.create({ align: aligns[at] }, text ? notoSchema.text(text) : undefined)));
  const body = nodes.table_row.create(null, aligns.map((align) => nodes.table_cell.create({ align })));
  const table = nodes.table.create(null, [header, body]);

  const from = $from.before() - previous.nodeSize;
  const tr = state.tr.replaceWith(from, $from.after(), table);
  // The first cell of the empty row: past the table and header row openings,
  // past the header row, past the body row's opening, into its first cell.
  tr.setSelection(TextSelection.near(tr.doc.resolve(from + 1 + header.nodeSize + 1 + 1)));
  dispatch(tr.scrollIntoView());
  return true;
};
