import { describe, expect, it } from 'vitest';
import {
  digitsForLineCount,
  gutterText,
  lineCount,
  MAX_DIGITS,
  MIN_DIGITS,
} from '../../src/renderer/editor/noto/fence-gutter';

describe('the fence gutter', () => {
  it('is as wide as the block needs, two digits at least, six at most', () => {
    expect(digitsForLineCount(1)).toBe(MIN_DIGITS);
    expect(digitsForLineCount(9)).toBe(2);
    expect(digitsForLineCount(10)).toBe(2);
    expect(digitsForLineCount(100)).toBe(3);
    expect(digitsForLineCount(1200)).toBe(4);
    expect(digitsForLineCount(10_000_000)).toBe(MAX_DIGITS);
    expect(digitsForLineCount(0)).toBe(MIN_DIGITS);
    expect(digitsForLineCount(Number.NaN)).toBe(MIN_DIGITS);
  });

  it('counts lines the way the caret does', () => {
    expect(lineCount('')).toBe(1);
    expect(lineCount('one')).toBe(1);
    expect(lineCount('one\ntwo')).toBe(2);
    // A trailing newline is a line the caret can be on.
    expect(lineCount('one\ntwo\n')).toBe(3);
  });

  it('writes one number per line', () => {
    expect(gutterText(1)).toBe('1');
    expect(gutterText(3)).toBe('1\n2\n3');
    expect(gutterText(12).split('\n')).toHaveLength(12);
  });
});
