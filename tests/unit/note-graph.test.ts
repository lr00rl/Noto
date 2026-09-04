import { describe, expect, it } from 'vitest';
import { linksFor, parseGraph } from '../../src/main/workspace/note-graph';

const GRAPH = JSON.stringify({
  schemaVersion: 2,
  generatedAt: '2026-08-27T13:22:00Z',
  root: '/vault',
  notes: [
    {
      relPath: 'a/one.md', title: 'One',
      explicitLinks: ['a/two.md', 'missing/three.md'],
      backlinks: ['b/four.md'],
      candidates: [
        { relPath: 'a/two.md', title: 'Two', score: 90 },
        { relPath: 'c/five.md', title: 'Five', score: 10 },
        { relPath: 'c/six.md', title: 'Six', score: 40 },
        { relPath: 'a/one.md', title: 'One', score: 99 },
      ],
    },
    { relPath: 'a/two.md', title: 'Two (its own title)' },
    { relPath: 'b/four.md', title: 'Four' },
    { relPath: 'c/six.md', title: 'Six' },
  ],
});

describe("the vault's graph", () => {
  it('reads the file and refuses what is not a graph', () => {
    expect(parseGraph(GRAPH)!.notes.size).toBe(4);
    expect(parseGraph(GRAPH)!.generatedAt).toBe('2026-08-27T13:22:00Z');
    expect(parseGraph('not json')).toBeNull();
    expect(parseGraph('{"notes": "no"}')).toBeNull();
  });

  it('gives a note its links, its backlinks and its related notes, best first', () => {
    const links = linksFor(parseGraph(GRAPH)!, 'a/one.md')!;
    // A linked note is named by its own title; one the graph has not met by its file name.
    expect(links.links).toEqual([
      { relativePath: 'a/two.md', title: 'Two (its own title)' },
      { relativePath: 'missing/three.md', title: 'three' },
    ]);
    expect(links.backlinks).toEqual([{ relativePath: 'b/four.md', title: 'Four' }]);
    // Related leaves out what is already linked either way, and the note itself.
    expect(links.related.map((item) => item.title)).toEqual(['Six', 'Five']);
  });

  it('says when the graph has not met the note', () => {
    expect(linksFor(parseGraph(GRAPH)!, 'nowhere.md')).toBeNull();
  });
});
