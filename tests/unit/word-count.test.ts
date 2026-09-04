import { describe, expect, it } from 'vitest';
import { countWords } from '../../src/renderer/editor/noto/word-count';

const words = (text: string) => countWords(text).words;

describe('counting the words in a note', () => {
  it('counts a run of letters or digits once', () => {
    expect(words('one two three')).toBe(3);
    expect(words('  spaced   out  ')).toBe(2);
    expect(words('')).toBe(0);
    expect(words('2026 and 40%')).toBe(3);
  });

  it('keeps a word together through the marks that live inside one', () => {
    expect(words("don't")).toBe(1);
    expect(words('mcp__claude_api')).toBe(1);
    expect(words('well-known')).toBe(1);
    expect(words('naïve café')).toBe(2);
  });

  it('does not count punctuation as a word', () => {
    expect(words('...')).toBe(0);
    expect(words('a, b; c.')).toBe(3);
    expect(words('-- —')).toBe(0);
  });

  it('counts a Han, kana or Hangul character on its own', () => {
    // Chinese and Japanese put no spaces between words, so a run would be one
    // word per sentence.
    expect(words('自由度')).toBe(3);
    expect(words('机器性能')).toBe(4);
    expect(words('ひらがな')).toBe(4);
    expect(words('한국어')).toBe(3);
  });

  it('counts each half of a mixed run its own way', () => {
    expect(words('IPQuality测试')).toBe(3);
    expect(words('第2章')).toBe(3);
  });

  it('counts characters as the document draws them, not as bytes', () => {
    expect(countWords('héllo').characters).toBe(5);
    expect(countWords('自由度').characters).toBe(3);
    // An emoji outside the basic plane is one character, not two.
    expect(countWords('a🙂b').characters).toBe(3);
  });
});

describe('the rest of the numbers', () => {
  it('counts characters without spaces, lines and blocks', () => {
    const count = countWords('第一行 one\n\n第二行\n第三行 two', 2);
    expect(count.characters).toBe(20);
    expect(count.charactersNoSpaces).toBe(15);
    expect(count.lines).toBe(3);
    expect(count.blocks).toBe(2);
    expect(countWords('').lines).toBe(0);
  });
});
