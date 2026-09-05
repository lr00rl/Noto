import { describe, expect, it } from 'vitest';
import { foldersOf, insideScope, withinScope } from '../../src/renderer/quick-open-folders';

const entry = (relativePath: string) => ({
  path: `/vault/${relativePath}`,
  name: relativePath.split('/').at(-1)!,
  relativePath,
});

const VAULT = [
  entry('00_索引.md'),
  entry('works/a.md'),
  entry('works/b.md'),
  entry('works/jobs/c.md'),
  entry('works/jobs/deep/d.md'),
  entry('other/e.md'),
];

describe('the folders a vault has', () => {
  it('are the directories its notes live in, counted through the whole subtree', () => {
    expect(foldersOf(VAULT)).toEqual([
      { relativePath: 'works', name: 'works', notes: 4 },
      { relativePath: 'works/jobs', name: 'jobs', notes: 2 },
      { relativePath: 'other', name: 'other', notes: 1 },
      { relativePath: 'works/jobs/deep', name: 'deep', notes: 1 },
    ]);
  });

  it('leave out the root, which is not a folder anybody navigates to', () => {
    expect(foldersOf([entry('a.md')])).toEqual([]);
    expect(foldersOf([])).toEqual([]);
  });
});

describe('what a scope leaves', () => {
  it('keeps the notes under it and nothing else', () => {
    expect(withinScope(VAULT, 'works').map((note) => note.relativePath)).toEqual([
      'works/a.md', 'works/b.md', 'works/jobs/c.md', 'works/jobs/deep/d.md',
    ]);
    expect(withinScope(VAULT, 'works/jobs').map((note) => note.relativePath)).toEqual([
      'works/jobs/c.md', 'works/jobs/deep/d.md',
    ]);
  });

  it('is the whole vault when there is none', () => {
    expect(withinScope(VAULT, '')).toHaveLength(VAULT.length);
    expect(insideScope('works/a.md', '')).toBe(true);
  });

  it('does not mistake a folder for one whose name it starts with', () => {
    expect(insideScope('workspace/a.md', 'works')).toBe(false);
    expect(insideScope('works/a.md', 'works')).toBe(true);
  });
});
