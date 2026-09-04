/**
 * Reading a generated index out of the document it sits in.
 *
 * The vault pipeline writes these between two comments and rewrites them on
 * every run; the parser's only job is to say what is between the markers, and
 * to keep saying it after the generator renamed them.
 */

import { describe, expect, it } from 'vitest';
import { parseSingleBlock, splitBlocks } from '../../src/shared/markdown/v3/blocks';
import { blockFromSpan } from '../../src/shared/markdown/v3/pm/from-mdast';
import { notoSchema } from '../../src/shared/markdown/v3/pm/schema';
import { findIndexRegions, parseIndexBlock } from '../../src/renderer/editor/noto/index-block';

const docOf = (markdown: string) => notoSchema.nodes.doc.create(
  null,
  splitBlocks(markdown).spans.map((span) => blockFromSpan(parseSingleBlock(span.markdown)!)),
);

const INDEX = [
  '# Openjobs-ai 索引',
  '',
  '<!-- note-assistant:index:start -->',
  '',
  '## 目录索引',
  '',
  '自动生成，勿手改；由 `node .tools/vault.mjs index` 维护。',
  '',
  '### 子目录',
  '',
  '- 存储数据格式优化对比（4 篇）',
  '  - [[存储数据格式优化对比/编译型语言pod部署CICD|编译型语言pod部署CICD]]',
  '  - [[存储数据格式优化对比/vortex_parquet|vortex parquet]]',
  '- [[供应商/00_索引|供应商]]（2 篇）',
  '',
  '### 日志',
  '',
  '- [[现在的搜索|现在的搜索]]',
  '- [[git_工作流程管理|git 工作流程管理]]',
  '',
  '<!-- note-assistant:index:end -->',
  '',
  'A paragraph after it.',
  '',
].join('\n');

describe('findIndexRegions', () => {
  it('finds the region between the markers, by top-level block', () => {
    const regions = findIndexRegions(docOf(INDEX));
    expect(regions).toHaveLength(1);
    // Block 0 is the H1 before the region; the start marker is block 1.
    expect(regions[0].from).toBe(1);
    expect(docOf(INDEX).child(regions[0].to).textContent.trim()).toBe('<!-- note-assistant:index:end -->');
  });

  it('recognises the older marker pair too, since the generator renamed it once', () => {
    const old = INDEX.replace('note-assistant:index:start', 'note-assistant:start')
      .replace('note-assistant:index:end', 'note-assistant:end');
    expect(findIndexRegions(docOf(old))).toHaveLength(1);
  });

  it('ignores a start with no matching end, rather than swallowing the rest of the note', () => {
    const unclosed = INDEX.replace('<!-- note-assistant:index:end -->', '');
    expect(findIndexRegions(docOf(unclosed))).toHaveLength(0);
  });

  it('is empty for a note with no index in it', () => {
    expect(findIndexRegions(docOf('# Plain\n\nWords.\n'))).toHaveLength(0);
  });
});

describe('parseIndexBlock', () => {
  const region = () => findIndexRegions(docOf(INDEX))[0].block;

  it('names the block after its first heading and sections after the rest', () => {
    const block = region();
    expect(block.title).toBe('目录索引');
    expect(block.sections.map((section) => section.title)).toEqual(['子目录', '日志']);
  });

  it('reads a wiki link into a title and a target, and keeps what followed it', () => {
    const items = region().sections[0].items;
    expect(items[1]).toEqual({
      target: '存储数据格式优化对比/编译型语言pod部署CICD',
      title: '编译型语言pod部署CICD',
      trailing: '',
      depth: 1,
    });
    expect(items[3]).toEqual({ target: '供应商/00_索引', title: '供应商', trailing: '（2 篇）', depth: 0 });
  });

  it('keeps a label with no link, with its children under it', () => {
    const items = region().sections[0].items;
    expect(items[0]).toEqual({ target: null, title: '存储数据格式优化对比（4 篇）', trailing: '', depth: 0 });
    expect(items[1].depth).toBe(1);
    expect(items[2].depth).toBe(1);
  });

  it('counts the lines that link somewhere, not the labels', () => {
    expect(region().linkCount).toBe(5);
  });

  it('uses the last path segment as the title when none was written', () => {
    const block = parseIndexBlock(docOf('- [[a/b/c]]\n').content.content);
    expect(block.sections[0].items[0]).toMatchObject({ target: 'a/b/c', title: 'c' });
  });
});
