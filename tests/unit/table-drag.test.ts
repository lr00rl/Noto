import { describe, expect, it } from 'vitest';
import { dropIndex, movesAnything, reorder } from '../../src/renderer/editor/noto/table-drag';

describe('the gap the pointer is in', () => {
  // Three tracks, each 10 wide, starting at 100.
  const edges = [100, 110, 120, 130];

  it('is the nearest edge, so the drop line sits where the eye expects', () => {
    expect(dropIndex(edges, 101)).toBe(0);
    expect(dropIndex(edges, 109)).toBe(1);
    expect(dropIndex(edges, 116)).toBe(2);
    expect(dropIndex(edges, 129)).toBe(3);
  });

  it('clamps to the ends rather than running off them', () => {
    expect(dropIndex(edges, -500)).toBe(0);
    expect(dropIndex(edges, 5000)).toBe(3);
  });

  it('has nowhere to go with fewer than two edges', () => {
    expect(dropIndex([], 5)).toBe(0);
    expect(dropIndex([100], 5)).toBe(0);
  });
});

describe('the order after a drop', () => {
  it('moves a track later, counting gaps in the order before the lift', () => {
    expect(reorder(4, 0, 2)).toEqual([1, 0, 2, 3]);
    expect(reorder(4, 0, 4)).toEqual([1, 2, 3, 0]);
  });

  it('moves a track earlier', () => {
    expect(reorder(4, 3, 0)).toEqual([3, 0, 1, 2]);
    expect(reorder(4, 2, 1)).toEqual([0, 2, 1, 3]);
  });

  it('leaves the order alone for the two gaps beside where it already is', () => {
    expect(reorder(4, 1, 1)).toEqual([0, 1, 2, 3]);
    expect(reorder(4, 1, 2)).toEqual([0, 1, 2, 3]);
    expect(movesAnything(1, 1)).toBe(false);
    expect(movesAnything(1, 2)).toBe(false);
    expect(movesAnything(1, 3)).toBe(true);
    expect(movesAnything(1, 0)).toBe(true);
  });

  it('refuses an index that is not there', () => {
    expect(reorder(3, 5, 0)).toEqual([0, 1, 2]);
    expect(reorder(3, -1, 0)).toEqual([0, 1, 2]);
    expect(reorder(3, 0, 9)).toEqual([0, 1, 2]);
  });
});
