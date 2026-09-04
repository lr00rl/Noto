import { describe, expect, it } from 'vitest';
import { parseImageTag } from '../../src/renderer/editor/noto/html-image';
import { serializeImageTag, tagForImage, zoomedTag } from '../../src/renderer/editor/noto/image-tag';

describe("Typora's image tag", () => {
  it('is written with the zoom in its style, as Typora writes it', () => {
    expect(tagForImage('assets/a b.png', 'a "quoted" alt', null, 0.5))
      .toBe('<img src="assets/a b.png" alt="a &quot;quoted&quot; alt" style="zoom:50%;" />');
    // A zoom of one says nothing and is left out.
    expect(tagForImage('a.png', '', null, 1)).toBe('<img src="a.png" alt="" />');
  });

  it('keeps what the tag had and changes only the zoom', () => {
    const tag = '<img src="a.png" alt="x" title="t" width="300" style="zoom: 80%; width: 50%">';
    expect(zoomedTag(tag, 0.333)).toBe('<img src="a.png" alt="x" title="t" width="300" style="zoom:33%; width:50%;" />');
    expect(zoomedTag('<b>not an image</b>', 0.5)).toBeNull();
  });

  it('round-trips through the parser', () => {
    const written = tagForImage('p.png', 'alt & more', 'title', 0.67);
    const back = parseImageTag(written)!;
    expect(back).toMatchObject({ src: 'p.png', alt: 'alt & more', title: 'title', zoom: 0.67 });
    expect(serializeImageTag(back)).toBe(written);
  });
});
