import { describe, expect, it } from 'vitest';
import { detectIndentUnit, guideRanges, indentColumns, indentGuideStyle, indentLength } from '../../src/renderer/editor/noto/indent-guides';

describe('measuring a line s indentation', () => {
  it('counts columns with tabs expanded to the next stop', () => {
    expect(indentColumns('    x', 4)).toBe(4);
    expect(indentColumns('\tx', 4)).toBe(4);
    expect(indentColumns('  \tx', 4)).toBe(4);
    expect(indentColumns('x', 4)).toBe(0);
  });

  it('counts the characters that make it up', () => {
    expect(indentLength('    x')).toBe(4);
    expect(indentLength('\t\tx')).toBe(2);
    expect(indentLength('x')).toBe(0);
  });
});

describe('the block s own indent step', () => {
  it('is the common divisor of the indents it uses', () => {
    expect(detectIndentUnit(['a', '  b', '    c'], 4)).toBe(2);
    expect(detectIndentUnit(['a', '   b', '      c'], 4)).toBe(3);
    expect(detectIndentUnit(['a', '    b', '        c'], 4)).toBe(4);
  });

  it('is the tab size for a block led by tabs, or one with no indent at all', () => {
    expect(detectIndentUnit(['a', '\tb', '\t\tc'], 4)).toBe(4);
    expect(detectIndentUnit(['a', 'b'], 4)).toBe(4);
  });

  it('ignores blank lines', () => {
    expect(detectIndentUnit(['a', '', '  b', '   ', '    c'], 4)).toBe(2);
  });
});

describe('the guides drawn on a line', () => {
  it('marks each step below the line s own indent, and not the text s edge', () => {
    const style = indentGuideStyle(4, 2, 'red');
    expect(style).toContain('2ch');
    expect(style).not.toContain('4ch');
  });

  it('draws nothing for a line at or below one step', () => {
    expect(indentGuideStyle(2, 2, 'red')).toBeNull();
    expect(indentGuideStyle(0, 2, 'red')).toBeNull();
  });
});

describe('the ranges in a whole block', () => {
  it('covers the leading whitespace of a line with a step to its left', () => {
    const text = 'def f():\n    if x:\n        return 1\n';
    const ranges = guideRanges(text, 4, 'red');
    // The first indented line has nothing to its left to mark: its own step is
    // the page edge. The second sits one step in from it and gets a rule.
    expect(ranges).toHaveLength(1);
    expect(text.slice(ranges[0].from, ranges[0].to)).toBe('        ');
  });

  it('draws a rule at every step of a deeper line', () => {
    const text = 'a\n  b\n    c\n      d\n';
    const ranges = guideRanges(text, 4, 'red');
    expect(ranges).toHaveLength(2);
    expect(ranges[1].style.match(/red/g)).toHaveLength(4);
  });

  it('skips a line that is only whitespace', () => {
    expect(guideRanges('a\n    \n        b\n', 4, 'red')).toHaveLength(0);
  });

  it('gives nothing for a block with no indentation', () => {
    expect(guideRanges('one\ntwo\n', 4, 'red')).toEqual([]);
  });
});
