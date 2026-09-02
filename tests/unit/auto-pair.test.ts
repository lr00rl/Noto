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
