/**
 * Nesting the flat heading list.
 *
 * The rail draws connector lines, and a connector needs to know whether a
 * heading is the last of its siblings. That is a property of the tree, so the
 * tree has to exist.
 */

import { describe, expect, it } from 'vitest';
import { nestOutline, type OutlineEntry, type OutlineNode } from '../../src/renderer/outline';

const entry = (depth: number, text: string, blockIndex: number): OutlineEntry =>
  ({ depth, text, blockIndex });

const shape = (nodes: readonly OutlineNode[]): unknown =>
  nodes.map((node) => (node.children.length === 0 ? node.text : { [node.text]: shape(node.children) }));

describe('nestOutline', () => {
  it('nests each heading under the nearest shallower one', () => {
    expect(shape(nestOutline([
      entry(1, 'Title', 0), entry(2, 'One', 1), entry(3, 'One a', 2), entry(2, 'Two', 3),
    ]))).toEqual([{ Title: [{ One: ['One a'] }, 'Two'] }]);
  });

  it('treats a skipped level as one step rather than inventing empty ancestors', () => {
    expect(shape(nestOutline([entry(1, 'Title', 0), entry(4, 'Deep', 1)])))
      .toEqual([{ Title: ['Deep'] }]);
  });

  it('keeps several top level headings as siblings', () => {
    expect(shape(nestOutline([entry(1, 'A', 0), entry(1, 'B', 1)]))).toEqual(['A', 'B']);
  });

  it('handles a document that starts deeper than it continues', () => {
    expect(shape(nestOutline([entry(3, 'Deep first', 0), entry(1, 'Shallow after', 1)])))
      .toEqual(['Deep first', 'Shallow after']);
  });

  it('returns nothing for a document with no headings', () => {
    expect(nestOutline([])).toEqual([]);
  });
});
