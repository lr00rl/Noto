import { describe, expect, it } from 'vitest';
import { backspaceTakesPair, pairActionFor } from '../../src/renderer/editor/noto/auto-pair';

const act = (typed: string, before = '', after = '', selection = false) =>
  pairActionFor(typed, before, after, selection);

describe('deciding what a typed bracket should do', () => {
  it('closes an opening bracket at an empty spot', () => {
    expect(act('(')).toEqual({ kind: 'pair', open: '(', close: ')' });
    expect(act('[', ' ', ' ')).toEqual({ kind: 'pair', open: '[', close: ']' });
    expect(act('（', '：')).toEqual({ kind: 'pair', open: '（', close: '）' });
  });

  it('wraps whatever is selected', () => {
    expect(act('"', 'a', 'b', true)).toEqual({ kind: 'wrap', open: '"', close: '"' });
    expect(act('x', 'a', 'b', true)).toEqual({ kind: 'none' });
  });

  it('leaves an apostrophe alone in the middle of a word', () => {
    expect(act("'", 'n', 't')).toEqual({ kind: 'none' });
    expect(act("'", ' ', ' ')).toEqual({ kind: 'pair', open: "'", close: "'" });
  });

  it('does not open a bracket in front of a word', () => {
    expect(act('(', ' ', 'w')).toEqual({ kind: 'none' });
    expect(act('(', ' ', '好')).toEqual({ kind: 'none' });
  });

  it('steps over a closing bracket that is already there', () => {
    expect(act(')', 'a', ')')).toEqual({ kind: 'step-over' });
    expect(act('】', 'a', '】')).toEqual({ kind: 'step-over' });
    expect(act('"', 'a', '"')).toEqual({ kind: 'step-over' });
  });

  it('types an ordinary closing bracket where there is none to step over', () => {
    expect(act(')', 'a', 'b')).toEqual({ kind: 'none' });
  });

  it('ignores anything that is not a bracket', () => {
    expect(act('a')).toEqual({ kind: 'none' });
    expect(act('好')).toEqual({ kind: 'none' });
  });
});

describe('backspace between a pair', () => {
  it('takes both halves', () => {
    expect(backspaceTakesPair('(', ')')).toBe(true);
    expect(backspaceTakesPair('《', '》')).toBe(true);
    expect(backspaceTakesPair('"', '"')).toBe(true);
  });

  it('takes one where they are not a pair', () => {
    expect(backspaceTakesPair('(', ']')).toBe(false);
    expect(backspaceTakesPair('a', 'b')).toBe(false);
    expect(backspaceTakesPair('', ')')).toBe(false);
  });
});

describe('a bracket typed after a word', () => {
  it('closes, because that is the commonest bracket there is', () => {
    // The rule used to refuse whenever a word character sat before the caret.
    // In the author's vault that position holds about 105,000 brackets against
    // 60,000 in the positions that did pair, so it refused in the majority of
    // the cases it saw: every function call written in prose, every index.
    expect(pairActionFor('(', 'o', '', false)).toEqual({ kind: 'pair', open: '(', close: ')' });
    expect(pairActionFor('[', '组', '', false)).toEqual({ kind: 'pair', open: '[', close: ']' });
    expect(pairActionFor('{', '1', '', false)).toEqual({ kind: 'pair', open: '{', close: '}' });
    expect(pairActionFor('（', '文', '', false)).toEqual({ kind: 'pair', open: '（', close: '）' });
  });

  it('still refuses a quote after a word, which is what the rule was for', () => {
    // `don` then an apostrophe must not become `don''`.
    expect(pairActionFor("'", 'n', '', false)).toEqual({ kind: 'none' });
    expect(pairActionFor('"', 'd', '', false)).toEqual({ kind: 'none' });
    expect(pairActionFor('`', 'x', '', false)).toEqual({ kind: 'none' });
  });

  it('still refuses any opener typed directly before a word', () => {
    // Which is nearly always meant as the one character.
    expect(pairActionFor('(', '', 'a', false)).toEqual({ kind: 'none' });
    expect(pairActionFor('[', ' ', 'x', false)).toEqual({ kind: 'none' });
    expect(pairActionFor("'", '', 'a', false)).toEqual({ kind: 'none' });
  });

  it('still pairs a quote where no word precedes it', () => {
    expect(pairActionFor("'", ' ', '', false)).toEqual({ kind: 'pair', open: "'", close: "'" });
    expect(pairActionFor('"', '', '', false)).toEqual({ kind: 'pair', open: '"', close: '"' });
  });
});
