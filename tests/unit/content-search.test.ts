/**
 * Searching inside the notes.
 *
 * The reads are stubbed, so what is pinned here is the part that decides what
 * the reader sees: which lines are kept, how a file is ranked, and that the
 * bounds actually bound. The cost of the real scan is measured, not asserted:
 * 7,066 notes and 82.5 MB take about 1.3 seconds cold and 274 ms warm.
 */

import { describe, expect, it } from 'vitest';
import {
  matchesIn, searchContent, MAX_PER_FILE,
} from '../../src/main/workspace/content-search';
import type { WorkspaceIndexEntryV1 } from '../../src/shared/workspace/v1/contracts';

const entry = (relativePath: string): WorkspaceIndexEntryV1 => ({
  path: `/vault/${relativePath}`,
  name: relativePath.split('/').pop() ?? relativePath,
  relativePath,
});

/** A search over a fixed set of files, with no disk involved. */
const search = (files: Record<string, string>, query: string, options = {}) =>
  searchContent(Object.keys(files).map(entry), query, {
    read: async (path: string) => files[path.replace('/vault/', '')],
    ...options,
  });

describe('finding lines', () => {
  it('reports the line, its number, and where the match starts', () => {
    expect(matchesIn('alpha\nbeta gamma\ndelta', 'gamma')).toEqual([
      { line: 'beta gamma', lineNumber: 2, column: 5 },
    ]);
  });

  it('ignores case, including across a CJK and Latin mix', () => {
    expect(matchesIn('See ProseMirror here', 'prosemirror')).toHaveLength(1);
    expect(matchesIn('用 ProseMirror 重写', 'prosemirror')).toHaveLength(1);
    expect(matchesIn('知识按主题归类', '知识按主题')).toHaveLength(1);
  });

  it('is literal, so punctuation is not a pattern', () => {
    // A regex search would read these as a group and an any-character.
    expect(matchesIn('config (旧) v1.2', '(旧)')).toHaveLength(1);
    expect(matchesIn('a-b', 'a.b')).toHaveLength(0);
  });

  it('keeps only a few lines per file', () => {
    const text = Array.from({ length: 20 }, () => 'hit').join('\n');
    expect(matchesIn(text, 'hit')).toHaveLength(MAX_PER_FILE);
  });

  it('shows a very long line around its match rather than from the start', () => {
    const text = `${'x'.repeat(900)}NEEDLE${'y'.repeat(900)}`;
    const [found] = matchesIn(text, 'NEEDLE');
    expect(found.line.length).toBeLessThan(500);
    expect(found.line.slice(found.column, found.column + 6)).toBe('NEEDLE');
  });

  it('finds nothing for an empty query rather than everything', () => {
    expect(matchesIn('anything', '')).toEqual([]);
  });
});

describe('searching a set of notes', () => {
  const files = {
    'often.md': 'term\nterm\nterm\nterm',
    'once.md': 'a term here',
    'never.md': 'nothing relevant',
  };

  it('returns only the notes that contain the query', async () => {
    const reply = await search(files, 'term');
    expect(reply.matches.map((match) => match.name)).toEqual(['often.md', 'once.md']);
  });

  it('ranks by how often the query appears in the whole file', async () => {
    const reply = await search(files, 'term');
    expect(reply.matches[0].occurrences).toBe(4);
    expect(reply.matches[1].occurrences).toBe(1);
  });

  it('is stable, so the same search does not reshuffle', async () => {
    const twins = { 'b.md': 'term', 'a.md': 'term' };
    const once = await search(twins, 'term');
    const twice = await search(twins, 'term');
    expect(once.matches.map((m) => m.relativePath)).toEqual(twice.matches.map((m) => m.relativePath));
    // Equal scores fall through to the path, not to filesystem order.
    expect(once.matches.map((m) => m.relativePath)).toEqual(['a.md', 'b.md']);
  });

  it('answers an empty query with nothing rather than with everything', async () => {
    const reply = await search(files, '   ');
    expect(reply.matches).toEqual([]);
    expect(reply.scanned).toBe(0);
  });

  it('says when it reported fewer files than matched', async () => {
    const many = Object.fromEntries(
      Array.from({ length: 12 }, (_, index) => [`n${index}.md`, 'term']),
    );
    const reply = await search(many, 'term', { maxFiles: 5 });
    expect(reply.matches).toHaveLength(5);
    expect(reply.truncated).toBe(true);
  });

  it('stops on its time budget and says so', async () => {
    let clock = 0;
    const reply = await searchContent(
      Array.from({ length: 50 }, (_, index) => entry(`n${index}.md`)),
      'term',
      { budgetMs: 5, now: () => { clock += 4; return clock; }, read: async () => 'term' },
    );
    expect(reply.timedOut).toBe(true);
  });

  it('skips a file it cannot read instead of losing the rest', async () => {
    const reply = await searchContent([entry('bad.md'), entry('good.md')], 'term', {
      read: async (path: string) => {
        if (path.endsWith('bad.md')) throw new Error('EACCES');
        return 'term';
      },
    });
    expect(reply.matches.map((match) => match.name)).toEqual(['good.md']);
  });
});
