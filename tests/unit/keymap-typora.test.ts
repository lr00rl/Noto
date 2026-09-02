import { describe, expect, it } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { splitBlocks } from '../../src/shared/markdown/v3/blocks';
import { docFromSpans } from '../../src/shared/markdown/v3/pm/from-mdast';
import { blockToMarkdown } from '../../src/shared/markdown/v3/pm/to-mdast';
import {
  insertRule, insertTable, shiftHeading, surround, surroundTag, toggleTaskList, wrapInMath,
} from '../../src/renderer/editor/noto/keymap';
import type { Command } from 'prosemirror-state';

/** A state with the caret, or a range, placed in the document. */
function stateFor(markdown: string, from: number, to = from): EditorState {
  const state = EditorState.create({ doc: docFromSpans(splitBlocks(markdown).spans) });
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, from, to)));
}

/** Run a command and give back the markdown of the first block, or null if it declined. */
function run(state: EditorState, command: Command): string | null {
  let next: EditorState | null = null;
  const handled = command(state, (tr) => { next = state.apply(tr); });
  if (!handled || next === null) return null;
  return blockToMarkdown((next as EditorState).doc.firstChild!);
}

const highlight = surround('==', '==');

describe("Typora's own bindings", () => {
  it('wraps a selection in the delimiters it is given', () => {
    expect(run(stateFor('one two', 5, 8), highlight)).toBe('one ==two==');
    expect(run(stateFor('one two', 5, 8), wrapInMath)).toBe('one $two$');
  });

  it('writes an underline as a tag, not as text a save would escape', () => {
    expect(run(stateFor('one two', 5, 8), surroundTag('u'))).toBe('one <u>two</u>');
  });

  it('inserts the pair around the caret when nothing is selected', () => {
    expect(run(stateFor('one', 4), highlight)).toBe('one====');
  });

  it('leaves a fence alone, where the characters would be code', () => {
    expect(run(stateFor('```\nconst a = 1;\n```', 2, 5), highlight)).toBeNull();
  });

  it('walks a paragraph up to a first-level heading and back down', () => {
    expect(run(stateFor('one two', 2), shiftHeading(true))).toBe('# one two');
    expect(run(stateFor('## one', 3), shiftHeading(true))).toBe('# one');
    expect(run(stateFor('## one', 3), shiftHeading(false))).toBe('### one');
    expect(run(stateFor('###### one', 3), shiftHeading(false))).toBe('one');
  });

  it('stops at the ends of the scale', () => {
    expect(run(stateFor('# one', 3), shiftHeading(true))).toBeNull();
    expect(run(stateFor('one', 2), shiftHeading(false))).toBeNull();
  });
});

describe("Typora's block types, on Option and Command", () => {
  it('marks a list item as a task, and unmarks it', () => {
    expect(run(stateFor('- one', 3), toggleTaskList)).toBe('- [ ] one');
    expect(run(stateFor('- [ ] one', 7), toggleTaskList)).toBe('- one');
  });

  it('makes a list out of a paragraph that is not one yet', () => {
    expect(run(stateFor('one', 2), toggleTaskList)).toBe('- one');
  });

  it('puts a rule where the caret is', () => {
    const state = stateFor('one', 4);
    let next: EditorState | null = null;
    expect(insertRule(state, (tr) => { next = state.apply(tr); })).toBe(true);
    expect((next as unknown as EditorState).doc.childCount).toBe(2);
    expect((next as unknown as EditorState).doc.child(1).type.name).toBe('horizontal_rule');
  });
});

describe('inserting a table', () => {
  it('makes one with a header row and the shape asked for', () => {
    const state = stateFor('one', 2);
    let next: EditorState | null = null;
    expect(insertTable(2, 3)(state, (tr) => { next = state.apply(tr); })).toBe(true);
    // Inserted at the caret, which splits the paragraph it was in.
    const doc = (next as unknown as EditorState).doc;
    let table = doc.child(0);
    doc.forEach((node) => { if (node.type.name === 'table') table = node; });
    expect(table.type.name).toBe('table');
    expect(table.childCount).toBe(3);
    expect(table.child(0).child(0).type.name).toBe('table_header');
    expect(table.child(1).child(0).type.name).toBe('table_cell');
    expect(table.child(0).childCount).toBe(3);
  });

  it('writes as a markdown table', () => {
    const state = stateFor('one', 2);
    let next: EditorState | null = null;
    insertTable(1, 2)(state, (tr) => { next = state.apply(tr); });
    const doc = (next as unknown as EditorState).doc;
    let table = doc.child(0);
    doc.forEach((node) => { if (node.type.name === 'table') table = node; });
    const markdown = blockToMarkdown(table);
    expect(markdown.split('\n')).toHaveLength(3);
    expect(markdown).toContain('| - | - |');
  });
});
