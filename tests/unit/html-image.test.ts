import { describe, expect, it } from 'vitest';
import { parseImageTag } from '../../src/renderer/editor/noto/html-image';

describe('an image tag written as HTML', () => {
  it('reads the shape Typora pastes, zoom and all', () => {
    const tag = '<img src="https://x.test/a.png" alt="image-20240101" style="zoom:50%;" />';
    expect(parseImageTag(tag)).toEqual({
      src: 'https://x.test/a.png', alt: 'image-20240101', title: null,
      width: null, height: null, zoom: 0.5, styleWidth: null,
    });
  });

  it('reads plain width and height, a title, and single quotes', () => {
    const tag = "<img src='./pics/a.png' width=376 height='243' title='A picture'>";
    expect(parseImageTag(tag)).toMatchObject({
      src: './pics/a.png', width: 376, height: 243, title: 'A picture', alt: '',
    });
  });

  it('keeps a width from the style only as pixels or a percentage', () => {
    expect(parseImageTag('<img src="a.png" style="width: 60%">')?.styleWidth).toBe('60%');
    expect(parseImageTag('<img src="a.png" style="width:320px; color:red">')?.styleWidth).toBe('320px');
    expect(parseImageTag('<img src="a.png" style="width: calc(100% - 1px)">')?.styleWidth).toBeNull();
  });

  it('decodes the entities an attribute may carry', () => {
    expect(parseImageTag('<img src="a.png?x=1&amp;y=2" alt="&quot;q&quot;">')).toMatchObject({
      src: 'a.png?x=1&y=2', alt: '"q"',
    });
  });

  it('caps a zoom that is a typo and ignores one that is nonsense', () => {
    expect(parseImageTag('<img src="a.png" style="zoom: 5000%">')?.zoom).toBe(8);
    expect(parseImageTag('<img src="a.png" style="zoom: big">')?.zoom).toBe(1);
  });

  it('is only ever a lone tag', () => {
    expect(parseImageTag('  <img src="a.png">\n')).not.toBeNull();
    expect(parseImageTag('<p><img src="a.png"></p>')).toBeNull();
    expect(parseImageTag('<img src="a.png"> and <img src="b.png">')).toBeNull();
    expect(parseImageTag('<img src="a.png"><script>alert(1)</script>')).toBeNull();
    expect(parseImageTag('<img alt="no source">')).toBeNull();
    // A closing bracket inside a value cannot be told from the tag's end, so
    // the whole thing stays source rather than becoming a truncated picture.
    expect(parseImageTag('<img src="a.png" alt="a>b">')).toBeNull();
    expect(parseImageTag('<div>text</div>')).toBeNull();
  });

  it('drops every attribute it does not know', () => {
    const parsed = parseImageTag('<img src="a.png" onerror="alert(1)" data-path="x" class="y">');
    expect(parsed).toEqual({
      src: 'a.png', alt: '', title: null, width: null, height: null, zoom: 1, styleWidth: null,
    });
  });
});
