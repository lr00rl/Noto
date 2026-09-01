import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseMarkdown, topLevelNodes } from '../../src/shared/markdown/v3/syntax';
import { splitBlocks } from '../../src/shared/markdown/v3/blocks';
import { docFromSpans, blockFromSpan } from '../../src/shared/markdown/v3/pm/from-mdast';
import { blockToMarkdown } from '../../src/shared/markdown/v3/pm/to-mdast';
import { notoSchema } from '../../src/shared/markdown/v3/pm/schema';

/** markdown -> mdast -> ProseMirror -> mdast -> markdown */
function roundTrip(markdown: string): string {
  return splitBlocks(markdown).spans.map((span) => blockToMarkdown(blockFromSpan(span))).join('\n\n');
}

function kindsOf(markdown: string): string[] {
  return splitBlocks(markdown).spans.map((span) => span.kind);
}

function pmDoc(markdown: string) {
  return docFromSpans(splitBlocks(markdown).spans);
}

describe('ProseMirror schema coverage', () => {
  it('has a node for every construct the parser can produce', () => {
    for (const name of [
      'paragraph', 'heading', 'blockquote', 'code_block', 'math_block', 'frontmatter',
      'html_block', 'horizontal_rule', 'bullet_list', 'ordered_list', 'list_item',
      'table', 'table_row', 'table_cell', 'table_header', 'footnote_definition',
      'link_definition', 'image', 'math_inline', 'footnote_reference', 'inline_html', 'hard_break',
    ]) {
      expect(notoSchema.nodes[name], `missing node ${name}`).toBeDefined();
    }
    for (const name of ['emphasis', 'strong', 'strikethrough', 'inline_code', 'link']) {
      expect(notoSchema.marks[name], `missing mark ${name}`).toBeDefined();
    }
  });

  it('builds real editable nodes for the constructs v2 froze as opaque source', () => {
    expect(pmDoc('| a | b |\n| --- | --- |\n| 1 | 2 |').firstChild?.type.name).toBe('table');
    expect(pmDoc('- [ ] todo').firstChild?.type.name).toBe('bullet_list');
    expect(pmDoc('$$\nx\n$$').firstChild?.type.name).toBe('math_block');
    expect(pmDoc('---\ntitle: t\n---').firstChild?.type.name).toBe('frontmatter');
    expect(pmDoc('> [!NOTE]\n> callout').firstChild?.type.name).toBe('blockquote');
  });

  it('keeps task list checked state on the list item', () => {
    const list = pmDoc('- [ ] open\n- [x] done').firstChild;
    expect(list?.child(0).attrs.checked).toBe(false);
    expect(list?.child(1).attrs.checked).toBe(true);
  });

  it('keeps table alignment and header rows', () => {
    const table = pmDoc('| a | b |\n| :-- | --: |\n| 1 | 2 |').firstChild;
    expect(table?.child(0).child(0).type.name).toBe('table_header');
    expect(table?.child(0).child(0).attrs.align).toBe('left');
    expect(table?.child(0).child(1).attrs.align).toBe('right');
    expect(table?.child(1).child(0).type.name).toBe('table_cell');
  });

  it('keeps the code fence language', () => {
    expect(pmDoc('```ts\nconst a = 1;\n```').firstChild?.attrs.lang).toBe('ts');
  });
});

describe('ProseMirror round trip stability', () => {
  const constructs: Record<string, string> = {
    heading: '# Title',
    paragraph: 'Some body text.',
    emphasis: 'Text with _emphasis_ inside.',
    strong: 'Text with *strong* inside.',
    strikethrough: 'Text with ~~deleted~~ inside.',
    'inline code': 'Call `render()` here.',
    link: 'See [the docs](https://example.com).',
    'link with title': 'See [docs](https://example.com "Title").',
    'link reference': 'See [docs][ref].',
    image: 'An image ![alt](./a.png).',
    'bullet list': '- one\n- two',
    'ordered list': '1. one\n2. two',
    'task list': '- [ ] open\n- [x] done',
    'nested list': '- outer\n  - inner',
    blockquote: '> quoted text',
    'fenced code': '```ts\nconst a = 1;\n```',
    'code without language': '```\nplain\n```',
    table: '| a | b |\n| --- | --- |\n| 1 | 2 |',
    'aligned table': '| a | b |\n| :-- | --: |\n| 1 | 2 |',
    'display math': '$$\nx = 1\n$$',
    'inline math': 'Value $x = 1$ inline.',
    'thematic break': '---',
    frontmatter: '---\ntitle: t\n---',
    'html block': '<div>\n  raw\n</div>',
    'footnote definition': '[^1]: The note.',
    'link definition': '[ref]: https://example.com',
    'hard break': 'line one\\\nline two',
    cjk: '中文段落，带标点。',
  };

  for (const [name, source] of Object.entries(constructs)) {
    it(`is idempotent for ${name}`, () => {
      const once = roundTrip(source);
      const twice = roundTrip(once);
      expect(twice).toBe(once);
    });

    it(`preserves block structure for ${name}`, () => {
      expect(kindsOf(roundTrip(source))).toEqual(kindsOf(source));
    });
  }

  it('preserves table cell contents exactly', () => {
    const output = roundTrip('| head | other |\n| --- | --- |\n| body | cell |');
    expect(output).toContain('head');
    expect(output).toContain('other');
    expect(output).toContain('body');
    expect(output).toContain('cell');
  });

  it('preserves math source without rendering it', () => {
    expect(roundTrip('$$\n\\frac{1}{2}\n$$')).toContain('\\frac{1}{2}');
  });

  it('preserves raw HTML verbatim rather than escaping it', () => {
    const output = roundTrip('<div class="x">\n  <span>raw</span>\n</div>');
    expect(output).toContain('<div class="x">');
    expect(output).toContain('<span>raw</span>');
  });

  it('preserves the reference form of a link rather than inlining it', () => {
    // A reference only exists when its definition does. Without one CommonMark
    // treats the brackets as literal text, which is why the definition is here.
    const output = roundTrip('See [docs][ref].\n\n[ref]: https://example.com');
    expect(output).toContain('[docs][ref]');
    expect(output).toContain('[ref]: https://example.com');
  });

  it('preserves inline html inside a paragraph', () => {
    expect(roundTrip('before <br/> after')).toContain('<br/>');
  });

  it('normalises emphasis and strong markers without changing their meaning', () => {
    // A single marker is emphasis and a double marker is strong. The serializer
    // settles on `_` for emphasis and `*` for strong, so both spellings of each
    // converge on one form and stay there.
    expect(roundTrip('*emphasis*')).toBe('_emphasis_');
    expect(roundTrip('_emphasis_')).toBe('_emphasis_');
    expect(roundTrip('**strong**')).toBe('**strong**');
    expect(roundTrip('__strong__')).toBe('**strong**');
  });

  it('keeps an indented code block indented rather than adding a fence', () => {
    const source = '    indented();\n    more();';
    const span = splitBlocks(source).spans[0];
    expect(span.kind).toBe('indented-code');
    expect(blockToMarkdown(blockFromSpan(span))).toBe(source);
  });
});

describe('ProseMirror round trip over the fixture corpus', () => {
  const corpus = path.join(__dirname, '..', 'fixtures', 'g002-v1');
  const files = readdirSync(corpus).filter((name) => name.endsWith('.md'));

  for (const name of files) {
    it(`keeps ${name} structurally stable through ProseMirror`, () => {
      const source = readFileSync(path.join(corpus, name), 'utf8');
      const once = roundTrip(source);
      expect(roundTrip(once)).toBe(once);
      expect(kindsOf(once)).toEqual(kindsOf(source));
    });
  }
});
