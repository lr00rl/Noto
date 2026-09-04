import { describe, expect, it } from 'vitest';
import { blockAtOffset, offsetOfBlock } from '../../src/renderer/source-lines';

const TEXT = '# Head\n\nOne paragraph.\n\n- a\n- b\n\nLast.\n';

describe('the caret between the rendered document and its source', () => {
  it('finds the character a block starts at', () => {
    expect(offsetOfBlock(TEXT, 0)).toBe(0);
    expect(offsetOfBlock(TEXT, 1)).toBe(8);
    expect(offsetOfBlock(TEXT, 2)).toBe(24);
    // Past the end lands at the end rather than nowhere.
    expect(offsetOfBlock(TEXT, 9)).toBe(TEXT.length);
    expect(offsetOfBlock('', 0)).toBe(0);
  });

  it('finds the block a character is in, and the one before a gap', () => {
    expect(blockAtOffset(TEXT, 0)).toBe(0);
    expect(blockAtOffset(TEXT, 10)).toBe(1);
    expect(blockAtOffset(TEXT, 22)).toBe(1);
    expect(blockAtOffset(TEXT, 25)).toBe(2);
    expect(blockAtOffset(TEXT, TEXT.length)).toBe(3);
  });
});
