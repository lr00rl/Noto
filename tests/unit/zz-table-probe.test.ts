import { describe, expect, it } from 'vitest';
import { parseSingleBlock } from '../../src/shared/markdown/v3/blocks';
import { blockFromSpan } from '../../src/shared/markdown/v3/pm/from-mdast';
import { blockToMarkdown } from '../../src/shared/markdown/v3/pm/to-mdast';

describe('probe', () => {
  it('table', () => {
    const ragged = '| Name | Description |\n|---|---|\n| a | A very long description here |\n| bb | Short |';
    const span = parseSingleBlock(ragged)!;
    console.log('PROBE-IN\n' + ragged);
    console.log('PROBE-OUT\n' + blockToMarkdown(blockFromSpan(span)));
    expect(true).toBe(true);
  });
});
