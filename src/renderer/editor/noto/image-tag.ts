/**
 * Writing an `<img>` tag the way Typora writes one.
 *
 * Typora resizes a picture in place by rewriting it as an HTML tag with a
 * zoom in its style, `<img src="a.png" alt="a" style="zoom:50%;" />`, and
 * leaves a markdown image alone until it is resized. The same shape is
 * written here, attribute for attribute, so a note resized in one editor
 * reads the same in the other and a diff shows one line changed.
 */

import { parseImageTag, type HtmlImage } from './html-image';

const escapeAttribute = (value: string): string => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

/** A whole percentage, as Typora writes it; 100 is left out, since it says nothing. */
export function zoomPercent(zoom: number): number {
  return Math.max(1, Math.round(zoom * 100));
}

export function serializeImageTag(image: HtmlImage): string {
  const parts = [`src="${escapeAttribute(image.src)}"`, `alt="${escapeAttribute(image.alt)}"`];
  if (image.title !== null && image.title.length > 0) parts.push(`title="${escapeAttribute(image.title)}"`);
  if (image.width !== null) parts.push(`width="${image.width}"`);
  if (image.height !== null) parts.push(`height="${image.height}"`);
  const style: string[] = [];
  if (zoomPercent(image.zoom) !== 100) style.push(`zoom:${zoomPercent(image.zoom)}%;`);
  if (image.styleWidth !== null) style.push(`width:${image.styleWidth};`);
  if (style.length > 0) parts.push(`style="${style.join(' ')}"`);
  return `<img ${parts.join(' ')} />`;
}

/** The tag again with a different zoom, or null when the text is not a lone tag. */
export function zoomedTag(value: string, zoom: number): string | null {
  const image = parseImageTag(value);
  return image ? serializeImageTag({ ...image, zoom }) : null;
}

/** A markdown image, once resized, becomes the tag: markdown has nowhere to put a size. */
export function tagForImage(src: string, alt: string, title: string | null, zoom: number): string {
  return serializeImageTag({ src, alt, title, width: null, height: null, zoom, styleWidth: null });
}
