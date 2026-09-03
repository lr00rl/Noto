/**
 * Footnote references and the table of contents marker survive re-serialization.
 *
 * Both begin with a `[`, which the serializer escapes because a bare one can
 * open a link reference. Blocks are parsed one at a time, so a footnote
 * reference arrives at the serializer as ordinary text whatever the rest of the
 * document says, and editing the paragraph around it wrote `\[^1]`, which is no
 * longer a footnote. `[TOC]` had the same fate. These pin both halves: the
 * exemption works, and it stays narrow enough that ordinary bracket text is
 * still escaped.
 */

import { describe, expect, it } from 'vitest';
import { parseMarkdown, renderMarkdown } from '../../src/shared/markdown/v3/syntax';

const roundTrip = (markdown: string): string => {
  const tree = parseMarkdown(markdown);
  return renderMarkdown(tree.children[0]).trim();
};

describe('footnote references through the serializer', () => {
  it('writes a reference back unescaped', () => {
    expect(roundTrip('A claim worth sourcing.[^1]')).toBe('A claim worth sourcing.[^1]');
    expect(roundTrip('Two of them.[^first][^second]')).toBe('Two of them.[^first][^second]');
    expect(roundTrip('A named one.[^why-it-matters]')).toBe('A named one.[^why-it-matters]');
  });

  it('leaves a definition alone, which already worked', () => {
    expect(roundTrip('[^1]: The note itself.')).toBe('[^1]: The note itself.');
  });

  it('still escapes a bracket that is not a footnote reference', () => {
    // A label cannot hold a space, so this is ordinary text and a bare `[`
    // there really can open a link reference.
    expect(roundTrip('Not one: [^a label] here.')).toBe('Not one: \\[^a label] here.');
    expect(roundTrip('An empty one: [^] here.')).toBe('An empty one: \\[^] here.');
    expect(roundTrip('See [1] in the list.')).toBe('See \\[1] in the list.');
  });
});

describe('the table of contents marker', () => {
  it('writes back unescaped, in either case', () => {
    expect(roundTrip('[TOC]')).toBe('[TOC]');
    expect(roundTrip('[toc]')).toBe('[toc]');
    expect(roundTrip('[Toc]')).toBe('[Toc]');
  });

  it('still escapes a bracket that only looks like it', () => {
    expect(roundTrip('See [TOCS] for the list.')).toBe('See \\[TOCS] for the list.');
    expect(roundTrip('See [TO C] for the list.')).toBe('See \\[TO C] for the list.');
  });
});
