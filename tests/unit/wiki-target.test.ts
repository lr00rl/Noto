import { describe, expect, it } from 'vitest';
import { normalisePath, wikiCandidates, type WikiCandidate } from '../../src/renderer/wiki-target';

const entry = (relativePath: string): WikiCandidate => ({
  path: `/vault/${relativePath}`,
  relativePath,
  name: relativePath.split('/').at(-1)!,
});

// The shapes the author's vault actually holds.
const VAULT = [
  entry('E000_Works/Openjobs-ai/00_索引.md'),
  entry('E000_Works/Openjobs-ai/vpn网络搭建规划/00_索引.md'),
  entry('E000_Works/Openjobs-ai/vpn网络搭建规划/方案demo.md'),
  entry('E000_Works/Openjobs-ai/数据部门/00_索引.md'),
  entry('A000_Theoretical_Knowledge/00_索引.md'),
  entry('00_索引.md'),
];

const from = 'E000_Works/Openjobs-ai/00_索引.md';
const found = (target: string, source: string | null = from) =>
  wikiCandidates(target, source, VAULT).map((candidate) => candidate.relativePath);

describe('a path a wiki link names', () => {
  it('is resolved against the folder the link was written in first', () => {
    expect(found('vpn网络搭建规划/00_索引')[0]).toBe('E000_Works/Openjobs-ai/vpn网络搭建规划/00_索引.md');
    expect(found('数据部门/00_索引')[0]).toBe('E000_Works/Openjobs-ai/数据部门/00_索引.md');
  });

  it('is resolved against the vault root when the folder holds nothing like it', () => {
    expect(found('A000_Theoretical_Knowledge/00_索引')[0]).toBe('A000_Theoretical_Knowledge/00_索引.md');
  });

  it('reads a written extension, and a heading after it, as neither', () => {
    expect(found('vpn网络搭建规划/方案demo.md')[0]).toBe('E000_Works/Openjobs-ai/vpn网络搭建规划/方案demo.md');
    expect(found('vpn网络搭建规划/方案demo#结论')[0]).toBe('E000_Works/Openjobs-ai/vpn网络搭建规划/方案demo.md');
  });

  it('walks up out of the folder when the link says to', () => {
    expect(wikiCandidates('../../00_索引', 'E000_Works/Openjobs-ai/00_索引.md', VAULT)[0].relativePath)
      .toBe('00_索引.md');
  });
});

describe('a bare name a wiki link gives', () => {
  it('means the nearest note with that name', () => {
    expect(found('00_索引')[0]).toBe('E000_Works/Openjobs-ai/00_索引.md');
    expect(found('00_索引', 'E000_Works/Openjobs-ai/vpn网络搭建规划/方案demo.md')[0])
      .toBe('E000_Works/Openjobs-ai/vpn网络搭建规划/00_索引.md');
    expect(found('00_索引', 'A000_Theoretical_Knowledge/anything.md')[0])
      .toBe('A000_Theoretical_Knowledge/00_索引.md');
  });

  it('still offers the others, so the caller can choose between them', () => {
    expect(found('00_索引')).toHaveLength(5);
  });

  it('is nothing when no note is called that', () => {
    expect(found('nowhere at all')).toEqual([]);
    expect(found('')).toEqual([]);
  });
});

describe('the path arithmetic', () => {
  it('resolves the dots and keeps the rest', () => {
    expect(normalisePath('a/./b/../c')).toBe('a/c');
    expect(normalisePath('/a//b/')).toBe('a/b');
    expect(normalisePath('../../x')).toBe('x');
  });
});
