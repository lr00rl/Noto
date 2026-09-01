import { describe, expect, it } from 'vitest';
import { padCjkSpacing, shiftHeadings } from '../../src/renderer/plugins/bundled/transforms';

describe('heading shift', () => {
  it('moves every heading a level in the requested direction', () => {
    const source = '# One\n\ntext\n\n## Two\n\n### Three\n';
    expect(shiftHeadings(source, 1).markdown).toBe('## One\n\ntext\n\n### Two\n\n#### Three\n');
    expect(shiftHeadings(source, -1)).toMatchObject({ changed: true, clamped: true });
  });

  it('reports when a heading is already at the boundary instead of clamping quietly', () => {
    // `#` cannot go higher, so nothing changes and the caller is told why.
    expect(shiftHeadings('# Top\n', -1)).toEqual({ markdown: '# Top\n', changed: false, clamped: true });
    expect(shiftHeadings('###### Deep\n', 1)).toEqual({ markdown: '###### Deep\n', changed: false, clamped: true });
  });

  it('moves what it can and flags what it cannot', () => {
    const result = shiftHeadings('# One\n\n## Two\n', -1);
    expect(result.markdown).toBe('# One\n\n# Two\n');
    expect(result).toMatchObject({ changed: true, clamped: true });
  });

  it('never edits inside a fenced code block', () => {
    const source = '# Real\n\n```sh\n# not a heading\n```\n\n## Also real\n';
    expect(shiftHeadings(source, 1).markdown)
      .toBe('## Real\n\n```sh\n# not a heading\n```\n\n### Also real\n');
  });

  it('handles tilde fences and nested backticks in the fence marker', () => {
    const source = '~~~\n# inside\n~~~\n\n# outside\n';
    expect(shiftHeadings(source, 1).markdown).toBe('~~~\n# inside\n~~~\n\n## outside\n');
  });

  it('leaves a hash that is not a heading alone', () => {
    expect(shiftHeadings('C# is a language\n', 1).markdown).toBe('C# is a language\n');
    // No space after the hashes means it is not an ATX heading.
    expect(shiftHeadings('#hashtag\n', 1).markdown).toBe('#hashtag\n');
  });

  it('preserves indentation and the original spacing after the hashes', () => {
    expect(shiftHeadings('  ## Indented\n', 1).markdown).toBe('  ### Indented\n');
  });

  it('reports no change for a document without headings', () => {
    expect(shiftHeadings('Just prose.\n', 1)).toEqual({
      markdown: 'Just prose.\n', changed: false, clamped: false,
    });
  });
});

describe('CJK spacing', () => {
  it('inserts a space on both sides of a boundary', () => {
    expect(padCjkSpacing('中文English中文')).toBe('中文 English 中文');
    expect(padCjkSpacing('数字123结尾')).toBe('数字 123 结尾');
  });

  it('is idempotent, so running it twice changes nothing', () => {
    const once = padCjkSpacing('中文English中文');
    expect(padCjkSpacing(once)).toBe(once);
  });

  it('leaves text that needs no spacing alone', () => {
    expect(padCjkSpacing('全部都是中文。')).toBe('全部都是中文。');
    expect(padCjkSpacing('All English here.')).toBe('All English here.');
  });

  it('does not touch inline code, links or math', () => {
    expect(padCjkSpacing('见 `中文code` 处')).toBe('见 `中文code` 处');
    expect(padCjkSpacing('看[中文link](http://a/中文b)吧')).toBe('看 [中文link](http://a/中文b) 吧');
    expect(padCjkSpacing('公式$中文x$结束')).toBe('公式 $中文x$ 结束');
  });

  it('never edits inside a fenced code block', () => {
    const source = '```ts\nconst 中文x = 1;\n```\n\n中文text\n';
    expect(padCjkSpacing(source)).toBe('```ts\nconst 中文x = 1;\n```\n\n中文 text\n');
  });

  it('handles Japanese and Korean, not only Chinese', () => {
    expect(padCjkSpacing('ひらがなabc')).toBe('ひらがな abc');
    expect(padCjkSpacing('カタカナabc')).toBe('カタカナ abc');
  });

  it('spaces around punctuation that reads as part of a word', () => {
    expect(padCjkSpacing('中文(paren)中文')).toBe('中文(paren) 中文');
  });

  it('preserves line structure', () => {
    expect(padCjkSpacing('中文a\n\n中文b\n')).toBe('中文 a\n\n中文 b\n');
  });
});
