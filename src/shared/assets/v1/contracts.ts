/**
 * Local images, and the one URL shape that names them.
 *
 * A note says `![](./pics/a.png)` and the renderer has to show the picture,
 * but the renderer never reads the filesystem. It asks for the file through
 * the app's own protocol instead, at `noto://asset/<encoded absolute path>`,
 * and main serves it only from a root it already trusts: the open folder, or
 * the folder the note in front is in. Both sides build and read the URL from
 * here so they cannot disagree about it.
 *
 * The whole path is one encoded segment rather than a path under the origin,
 * so the URL parser never gets a chance to normalise `..` before main sees it.
 * Main resolves and checks the real path itself.
 */

export const ASSET_HOST = 'asset';
export const ASSET_ORIGIN = `noto://${ASSET_HOST}`;

/** What main will serve as an image. Anything else is refused, whatever the bytes say. */
export const IMAGE_EXTENSIONS: ReadonlySet<string> = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.avif', '.bmp', '.ico',
]);

export function toAssetUrl(absolutePath: string): string {
  return `${ASSET_ORIGIN}/${encodeURIComponent(absolutePath)}`;
}

/** The path an asset URL names, or null when it is not one. */
export function fromAssetUrl(url: URL): string | null {
  if (url.protocol !== 'noto:' || url.hostname !== ASSET_HOST) return null;
  const encoded = url.pathname.slice(1);
  if (encoded.length === 0 || encoded.includes('/')) return null;
  try {
    return decodeURIComponent(encoded);
  } catch {
    return null;
  }
}

export function hasImageExtension(filePath: string): boolean {
  const dot = filePath.lastIndexOf('.');
  if (dot < 0) return false;
  return IMAGE_EXTENSIONS.has(filePath.slice(dot).toLowerCase());
}
