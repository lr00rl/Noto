import { describe, expect, it } from 'vitest';
import { notoSchema } from '../../src/shared/markdown/v3/pm/schema';
import { splitBlocks, parseSingleBlock } from '../../src/shared/markdown/v3/blocks';
import { blockFromSpan } from '../../src/shared/markdown/v3/pm/from-mdast';
import { blockToMarkdown } from '../../src/shared/markdown/v3/pm/to-mdast';

/**
 * The per-block source toggle, exercised at the level that decides whether it
 * is correct: a block turned into raw markdown and back must be the same block,
 * and must serialize identically while it is open in source.
 *
 * The `EditorView` wiring is covered by the packaged e2e suite; the round trip
 * is pure and belongs here.
 */

function blockFor(markdown: string) {
  const span = splitBlocks(markdown).spans[0];
  if (!span) throw new Error('fixture produced no block');
  return blockFromSpan(span);
}

/** What the editor does when the caret's block is switched to source. */
function toSource(markdown: string) {
  const node = blockFor(markdown);
  const text = blockToMarkdown(node);
  return notoSchema.nodes.source_block.create(
    { originalKind: node.type.name },
    text.length > 0 ? notoSchema.text(text) : undefined,
  );
}

describe('per-block source toggle', () => {
  const constructs: Record<string, string> = {
    heading: '## A heading',
    paragraph: 'Body text with _emphasis_.',
    table: '| a | b |\n| --- | --- |\n| 1 | 2 |',
    'task list': '- [ ] open\n- [x] done',
    'fenced code': '```ts\nconst a = 1;\n```',
    math: '$$\nx = 1\n$$',
    quote: '> quoted',
    frontmatter: '---\ntitle: t\n---',
  };

  for (const [name, markdown] of Object.entries(constructs)) {
    it(`round trips ${name} through source mode unchanged`, () => {
      const source = toSource(markdown);
      // While in source mode the block still serializes to its own markdown, so
      // a save taken mid-toggle writes exactly what it would have written.
      expect(blockToMarkdown(source)).toBe(blockToMarkdown(blockFor(markdown)));

      // Toggling back reproduces the same rendered node.
      const span = parseSingleBlock(source.textContent);
      expect(span, `${name} should reparse`).not.toBeNull();
      expect(blockFromSpan(span!).eq(blockFor(markdown))).toBe(true);
    });
  }

  it('remembers what the block was, so the toggle can be labelled', () => {
    expect(toSource('## A heading').attrs.originalKind).toBe('heading');
    expect(toSource('| a |\n| --- |\n| 1 |').attrs.originalKind).toBe('table');
    expect(toSource('```ts\nx\n```').attrs.originalKind).toBe('code_block');
  });

  it('refuses to render text that is no longer exactly one block', () => {
    // The editor turns this refusal into a visible message rather than silently
    // splitting the user's block in two.
    expect(parseSingleBlock('First para.\n\nSecond para.')).toBeNull();
    expect(parseSingleBlock('')).toBeNull();
  });

  it('accepts a block the user rewrote into a different construct', () => {
    // Editing source is allowed to change what the block is; it just has to
    // stay one block.
    const span = parseSingleBlock('## Now a heading');
    expect(span).not.toBeNull();
    expect(blockFromSpan(span!).type.name).toBe('heading');
  });

  it('keeps a source block out of the serializer so hand formatting survives', () => {
    // Deliberately non-canonical spacing the serializer would normalise away.
    const awkward = '|a|b|\n|-|-|\n|1|2|';
    const source = notoSchema.nodes.source_block.create(
      { originalKind: 'table' },
      notoSchema.text(awkward),
    );
    expect(blockToMarkdown(source)).toBe(awkward);
  });
});
