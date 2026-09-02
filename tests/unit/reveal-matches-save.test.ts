import { describe, expect, it } from 'vitest';
import { EditorState } from 'prosemirror-state';
import { notoSchema } from '../../src/shared/markdown/v3/pm/schema';
import { blockToMarkdown } from '../../src/shared/markdown/v3/pm/to-mdast';
import { DELIMITERS } from '../../src/renderer/editor/noto/active-node-plugin';

/**
 * The editor reveals a mark's delimiters around the caret. What it shows has to
 * be what a save writes, or the reader is being told a small lie about their
 * own file. The two were written out separately once and drifted: the
 * serializer moved emphasis to a star and the reveal went on showing an
 * underscore.
 */
function saved(markName: string): string {
  const mark = notoSchema.marks[markName];
  const paragraph = notoSchema.nodes.paragraph.create(null, notoSchema.text('x', [mark.create()]));
  const state = EditorState.create({ doc: notoSchema.nodes.doc.create(null, paragraph) });
  return blockToMarkdown(state.doc.firstChild!);
}

describe('the delimiters revealed around the caret', () => {
  for (const name of Object.keys(DELIMITERS).filter((key) => key !== 'link')) {
    it(`are what a save writes for ${name}`, () => {
      const { open, close } = DELIMITERS[name];
      expect(saved(name)).toBe(`${open}x${close(notoSchema.marks[name].create())}`);
    });
  }

  it("shows a link's destination, which is the part a reader cannot otherwise see", () => {
    const mark = notoSchema.marks.link.create({ href: 'https://example.com', title: null });
    expect(DELIMITERS.link.open).toBe('[');
    expect(DELIMITERS.link.close(mark)).toBe('](https://example.com)');
  });
});
