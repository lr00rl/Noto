import { describe, expect, it } from 'vitest';
import { splitBlocks } from '../../src/shared/markdown/v3/blocks';
import { docFromSpans } from '../../src/shared/markdown/v3/pm/from-mdast';
import { findMarkers, headingsOf } from '../../src/renderer/editor/noto/toc-block';

const docOf = (markdown: string) => docFromSpans(splitBlocks(markdown).spans);

describe('the table of contents', () => {
  it('lists the headings in order with their levels and blocks', () => {
    const doc = docOf('# One\n\n[TOC]\n\n## Two\n\nwords\n\n### Three\n\n## Four\n');
    expect(headingsOf(doc)).toEqual([
      { level: 1, text: 'One', blockIndex: 0 },
      { level: 2, text: 'Two', blockIndex: 2 },
      { level: 3, text: 'Three', blockIndex: 4 },
      { level: 2, text: 'Four', blockIndex: 5 },
    ]);
  });

  it('finds the marker whatever its case, and only as a paragraph of its own', () => {
    const doc = docOf('[toc]\n\nSee [TOC] inline.\n\n[TOC]\n');
    expect(findMarkers(doc).map((marker) => marker.index)).toEqual([0, 2]);
  });
});
