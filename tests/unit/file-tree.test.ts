import { describe, expect, it } from 'vitest';
import { sortEntries } from '../../src/main/workspace/file-tree';

describe('the order of a folder', () => {
  const entry = (name: string, kind: 'file' | 'directory', modifiedMs: number) =>
    ({ name, path: `/vault/${name}`, kind, modifiedMs });

  const rows = () => [
    entry('beta.md', 'file', 300),
    entry('Alpha.md', 'file', 100),
    entry('zeta', 'directory', 50),
    entry('mid.md', 'file', 200),
    entry('archive', 'directory', 400),
  ];

  const names = (order: Parameters<typeof sortEntries>[1]) =>
    sortEntries(rows(), order).map((row) => row.name);

  it('keeps folders at the top whatever the order', () => {
    for (const order of ['name', 'name-desc', 'modified', 'modified-old'] as const) {
      expect(names(order).slice(0, 2).sort()).toEqual(['archive', 'zeta']);
    }
  });

  it('sorts by name in both directions, ignoring case', () => {
    expect(names('name')).toEqual(['archive', 'zeta', 'Alpha.md', 'beta.md', 'mid.md']);
    expect(names('name-desc')).toEqual(['zeta', 'archive', 'mid.md', 'beta.md', 'Alpha.md']);
  });

  it('sorts by when a file was last written, newest or oldest first', () => {
    expect(names('modified').slice(2)).toEqual(['beta.md', 'mid.md', 'Alpha.md']);
    expect(names('modified-old').slice(2)).toEqual(['Alpha.md', 'mid.md', 'beta.md']);
  });

  it('falls back to the name when two were written in the same millisecond', () => {
    const same = [entry('b.md', 'file', 7), entry('a.md', 'file', 7)];
    expect(sortEntries(same, 'modified').map((row) => row.name)).toEqual(['a.md', 'b.md']);
  });
});
