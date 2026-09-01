import { describe, expect, it } from 'vitest';
import { docFromSpans } from '../../src/shared/markdown/v3/pm/from-mdast';
import { splitBlocks } from '../../src/shared/markdown/v3/blocks';
import { findMatches, nextMatch, patternFor } from '../../src/renderer/editor/noto/search';
import type { SearchOptions } from '../../src/renderer/editor/noto/search';

function docOf(markdown: string) {
  return docFromSpans(splitBlocks(markdown).spans);
}

function options(query: string, overrides: Partial<SearchOptions> = {}): SearchOptions {
  return { query, caseSensitive: false, wholeWord: false, regex: false, ...overrides };
}

/** The text a match covers, which is what proves the positions are right. */
function textOf(markdown: string, search: SearchOptions): string[] {
  const doc = docOf(markdown);
  return findMatches(doc, search).map((match) => doc.textBetween(match.from, match.to));
}

describe('finding text', () => {
  it('finds every occurrence in document order', () => {
    expect(textOf('one two one\n\nand one more\n', options('one')))
      .toEqual(['one', 'one', 'one']);
  });

  it('finds a match that marks split across several text nodes', () => {
    // "hello world" is one run to the reader but two text nodes to the editor,
    // because half of it is bold. Searching node by node would miss it.
    expect(textOf('hello **world** again\n', options('hello world')))
      .toEqual(['hello world']);
  });

  it('ignores case unless asked not to', () => {
    expect(textOf('One one ONE\n', options('one'))).toHaveLength(3);
    expect(textOf('One one ONE\n', options('one', { caseSensitive: true }))).toEqual(['one']);
  });

  it('respects whole word', () => {
    expect(textOf('cat concatenate cat\n', options('cat'))).toHaveLength(3);
    expect(textOf('cat concatenate cat\n', options('cat', { wholeWord: true }))).toHaveLength(2);
  });

  it('treats the query literally unless regex is on', () => {
    expect(textOf('a.c abc\n', options('a.c'))).toEqual(['a.c']);
    expect(textOf('a.c abc\n', options('a.c', { regex: true }))).toEqual(['a.c', 'abc']);
  });

  it('does not match across a block boundary', () => {
    // "one" and "two" are in different paragraphs, so they are not adjacent.
    expect(textOf('one\n\ntwo\n', options('one two'))).toEqual([]);
  });

  it('returns nothing for a regular expression that does not compile', () => {
    expect(patternFor(options('(unclosed', { regex: true }))).toBeNull();
    expect(textOf('anything\n', options('(unclosed', { regex: true }))).toEqual([]);
  });

  it('terminates on a pattern that can match the empty string', () => {
    // A naive loop would never advance past offset zero.
    expect(textOf('abc\n', options('x*', { regex: true }))).toEqual([]);
  });

  it('finds text inside headings, lists and tables, not only paragraphs', () => {
    const markdown = '# needle here\n\n- needle in a list\n\n| needle | b |\n| --- | --- |\n| 1 | 2 |\n';
    expect(textOf(markdown, options('needle'))).toHaveLength(3);
  });

  it('returns an empty result for an empty query', () => {
    expect(textOf('anything\n', options(''))).toEqual([]);
  });
});

describe('choosing which match to go to', () => {
  const matches = [{ from: 10, to: 13 }, { from: 40, to: 43 }, { from: 80, to: 83 }];

  it('goes forward from the caret and wraps at the end', () => {
    expect(nextMatch(matches, 0, 'forward')).toBe(0);
    expect(nextMatch(matches, 20, 'forward')).toBe(1);
    expect(nextMatch(matches, 100, 'forward')).toBe(0);
  });

  it('goes backward from the caret and wraps at the start', () => {
    expect(nextMatch(matches, 100, 'backward')).toBe(2);
    expect(nextMatch(matches, 45, 'backward')).toBe(1);
    expect(nextMatch(matches, 0, 'backward')).toBe(2);
  });

  it('reports no match when there are none', () => {
    expect(nextMatch([], 0, 'forward')).toBe(-1);
  });
});
