import { describe, expect, it } from 'vitest';
import { alignTableMarkdown, displayWidth } from '../../src/shared/markdown/v3/table-align';

describe('displayWidth', () => {
  it('counts a Chinese character as the two columns it occupies', () => {
    expect(displayWidth('abc')).toBe(3);
    expect(displayWidth('设计')).toBe(4);
    expect(displayWidth('a设计b')).toBe(6);
    expect(displayWidth('，。')).toBe(4);
  });

  it('gives a combining mark no width of its own', () => {
    expect(displayWidth('é')).toBe(1);
  });
});

describe('alignTableMarkdown', () => {
  it('pads every column to its widest cell', () => {
    expect(alignTableMarkdown([
      '| Name | Description |',
      '| --- | --- |',
      '| a | A long description |',
      '| bb | Short |',
    ].join('\n'))).toBe([
      '| Name | Description        |',
      '| ---- | ------------------ |',
      '| a    | A long description |',
      '| bb   | Short              |',
    ].join('\n'));
  });

  it('lines a Chinese table up as a monospaced font draws it, not by character count', () => {
    const aligned = alignTableMarkdown([
      '| 名称 | 说明 |',
      '| --- | --- |',
      '| 编辑器 | 好 |',
    ].join('\n')).split('\n');
    // Every row is the same width on screen, which counting characters would
    // not achieve for a table mixing scripts.
    const widths = aligned.map((line) => displayWidth(line));
    expect(new Set(widths).size).toBe(1);
  });

  it('keeps the alignment colons and the column they belong to', () => {
    expect(alignTableMarkdown([
      '| Left | Middle | Right |',
      '| :--- | :----: | ----: |',
      '| a | b | c |',
    ].join('\n'))).toBe([
      '| Left | Middle | Right |',
      '| :--- | :----: | ----: |',
      '| a    | b      | c     |',
    ].join('\n'));
  });

  it('keeps three dashes under the colons, the width the vault writes', () => {
    // The colons are extra, not carved out of the dashes, so a centred column
    // is five wide and every row in it is five wide too.
    const aligned = alignTableMarkdown('| a |\n| :-: |\n| b |').split('\n');
    expect(aligned).toEqual(['| a     |', '| :---: |', '| b     |']);
  });

  it('fills in a row that is short of cells rather than losing the shape', () => {
    expect(alignTableMarkdown([
      '| a | b |',
      '| --- | --- |',
      '| only one |',
    ].join('\n'))).toBe([
      '| a        | b   |',
      '| -------- | --- |',
      '| only one |     |',
    ].join('\n'));
  });

  it('leaves a pipe inside a code span alone, which is content and not a boundary', () => {
    const aligned = alignTableMarkdown([
      '| Command | Note |',
      '| --- | --- |',
      '| `a | b` | pipes |',
    ].join('\n'));
    expect(aligned).toContain('`a | b`');
    expect(aligned.split('\n')[2].match(/(?<!`[^`]*)\|/g)?.length).toBeGreaterThan(0);
  });

  it('leaves an escaped pipe where it was', () => {
    expect(alignTableMarkdown([
      '| a | b |',
      '| --- | --- |',
      '| x \\| y | z |',
    ].join('\n'))).toContain('x \\| y');
  });

  it('returns anything that is not a table unchanged', () => {
    expect(alignTableMarkdown('Just a paragraph.')).toBe('Just a paragraph.');
    expect(alignTableMarkdown('| not | a table |\n| because | no delimiter |')).toBe(
      '| not | a table |\n| because | no delimiter |');
  });

  it('is stable, so running it twice changes nothing the second time', () => {
    const once = alignTableMarkdown('| a | bbbb |\n| --- | --- |\n| cc | d |');
    expect(alignTableMarkdown(once)).toBe(once);
  });
});
