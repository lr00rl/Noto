/**
 * An `<img>` tag written as raw HTML, read as a picture.
 *
 * Raw HTML in a note is kept as source and never rendered live, because
 * rendering it would run it. An image tag is the one exception worth making:
 * 960 pictures in the author's vault are written this way, most of them by
 * Typora itself, which pastes `<img src alt style="zoom:50%" />`. So the tag
 * is not rendered; it is parsed, strictly, into the few attributes a picture
 * needs, and those are handed to the same image frame markdown images use.
 * Anything the parser does not know is dropped, so an `onerror` or a second
 * element in the same text never reaches the DOM.
 *
 * Only a lone tag qualifies: the whole text must be one `<img>` and nothing
 * else, whitespace aside. A tag inside a paragraph of other HTML stays source.
 */

export interface HtmlImage {
  readonly src: string;
  readonly alt: string;
  readonly title: string | null;
  /** Pixel width and height from the attributes, when given as plain numbers. */
  readonly width: number | null;
  readonly height: number | null;
  /** Typora's paste shape carries `style="zoom: 50%"`; a factor, 1 for none. */
  readonly zoom: number;
  /** A width from the style attribute, kept only as a percentage or pixels. */
  readonly styleWidth: string | null;
}

const LONE_TAG = /^\s*<img\b([^<>]*?)\/?>\s*$/i;
const ATTRIBUTE = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

/** Largest zoom factor honoured. Past this the number is a typo, not intent. */
const MAX_ZOOM = 8;

export function parseImageTag(html: string): HtmlImage | null {
  const match = LONE_TAG.exec(html);
  if (!match) return null;

  const attributes = new Map<string, string>();
  for (const found of match[1].matchAll(ATTRIBUTE)) {
    const name = found[1].toLowerCase();
    const value = found[2] ?? found[3] ?? found[4] ?? '';
    if (!attributes.has(name)) attributes.set(name, decodeEntities(value));
  }

  const src = attributes.get('src')?.trim() ?? '';
  if (src.length === 0) return null;

  const style = parseStyle(attributes.get('style') ?? '');
  return {
    src,
    alt: attributes.get('alt') ?? '',
    title: attributes.get('title') ?? null,
    width: dimension(attributes.get('width')),
    height: dimension(attributes.get('height')),
    zoom: style.zoom,
    styleWidth: style.width,
  };
}

/** A plain number of pixels, as the attribute allows, or nothing. */
function dimension(value: string | undefined): number | null {
  if (value === undefined) return null;
  const parsed = /^\s*(\d{1,5})(?:px)?\s*$/.exec(value);
  return parsed ? Number(parsed[1]) : null;
}

/**
 * The two declarations a picture may carry, and nothing else.
 *
 * `zoom` is what Typora writes when a picture is resized in place; a width
 * is what a hand-written tag tends to carry. Both are read as numbers with a
 * unit the frame can apply; the rest of the style is not a picture's business.
 */
function parseStyle(style: string): { zoom: number; width: string | null } {
  let zoom = 1;
  let width: string | null = null;
  for (const declaration of style.split(';')) {
    const colon = declaration.indexOf(':');
    if (colon < 0) continue;
    const property = declaration.slice(0, colon).trim().toLowerCase();
    const value = declaration.slice(colon + 1).trim();
    if (property === 'zoom') {
      const percent = /^(\d+(?:\.\d+)?)%$/.exec(value);
      const factor = percent ? Number(percent[1]) / 100 : Number(value);
      if (Number.isFinite(factor) && factor > 0) zoom = Math.min(MAX_ZOOM, factor);
    } else if (property === 'width') {
      const sized = /^(\d+(?:\.\d+)?)(px|%)$/.exec(value);
      if (sized) width = `${sized[1]}${sized[2]}`;
    }
  }
  return { zoom, width };
}

const ENTITIES: Readonly<Record<string, string>> = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'",
};

function decodeEntities(value: string): string {
  return value.replace(/&(?:amp|lt|gt|quot|#39|apos);/g, (entity) => ENTITIES[entity] ?? entity);
}
