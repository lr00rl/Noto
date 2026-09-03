/**
 * Finding a picture in a paste or a drop.
 *
 * Pure, and given the transfer rather than the event, so the awkward part can
 * be tested without an editor: a clipboard almost never holds one thing. Copy a
 * picture out of a web page and the transfer carries the image, an `<img>` tag
 * as HTML, and the page's URL as text, all three at once. Whichever branch runs
 * first decides what the reader gets, so the order here is the feature.
 *
 * A file wins over everything. That is what the reader meant by copying a
 * picture, and falling through to the text would paste an address where they
 * expected the picture itself.
 */

/** A picture found in a transfer, ready to be handed to main. */
export type TransferImage =
  | { readonly kind: 'file'; readonly file: File }
  /** An address, inserted as written and never fetched. */
  | { readonly kind: 'remote'; readonly href: string };

const REMOTE = /^https?:\/\/\S+$/i;

/**
 * A picture in the transfer, or null when there is nothing to insert as one.
 *
 * A remote address only counts when the transfer holds a bare URL and no HTML.
 * Dragging a picture out of a browser gives both, and the HTML is a fragment
 * that the ordinary paste path turns into a picture already, correctly, with
 * whatever the page had around it.
 */
export function imageFromTransfer(data: DataTransfer | null): TransferImage | null {
  if (!data) return null;

  for (const item of Array.from(data.files ?? [])) {
    // The type is what the source claims and is often empty for a drag from
    // some applications, so an empty type is allowed through and the bytes
    // decide. Anything that claims to be something other than an image is not.
    if (item.type === '' || item.type.startsWith('image/')) return { kind: 'file', file: item };
    return null;
  }

  if (data.types.includes('text/html')) return null;
  const text = data.getData('text/plain').trim();
  if (!REMOTE.test(text)) return null;
  if (!looksLikeImageAddress(text)) return null;
  return { kind: 'remote', href: text };
}

/**
 * Whether an address names a picture, by its path alone.
 *
 * Deliberately conservative: pasting any URL at all as a picture would turn
 * every ordinary link paste into a broken image. A query string is ignored,
 * since that is where a CDN puts its resizing parameters.
 */
export function looksLikeImageAddress(href: string): boolean {
  let pathname: string;
  try {
    pathname = new URL(href).pathname;
  } catch {
    return false;
  }
  return /\.(png|jpe?g|gif|webp|svg|avif|bmp|ico)$/i.test(pathname);
}
