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

/**
 * Writing a picture into the vault.
 *
 * The renderer has bytes, from a paste or a drop, and no way to put them
 * anywhere. It hands them over and main decides everything else: which folder,
 * under what name, and what text goes in the note. The request carries the
 * bytes and nothing else. No filename, no extension, no destination, because
 * every one of those would be a path the renderer chose, and the renderer
 * choosing a path is the thing this boundary exists to prevent.
 */

export const NOTO_ASSETS_VERSION = 1 as const;

export const ASSET_CHANNELS = {
  write: 'noto:v1:assets:write',
  /** Pick a picture with the system dialog and copy it in, for the menu. */
  pick: 'noto:v1:assets:pick',
} as const;

/**
 * The ceiling on one pasted picture, checked on both sides.
 *
 * A frame grabbed from a screen recording is a few megabytes; twenty is past
 * anything a note wants and short of what would stall the process copying it
 * across the IPC boundary.
 */
export const MAX_ASSET_BYTES = 20 * 1024 * 1024;

export interface AssetRequestV1 {
  readonly version: typeof NOTO_ASSETS_VERSION;
  readonly requestId: string;
}

export interface AssetWriteRequestV1 extends AssetRequestV1 {
  readonly bytes: Uint8Array;
}

/** Why a picture was not written. Each one is something to tell the reader. */
export type AssetRefusalV1 =
  | 'no-document'
  | 'unsupported-type'
  | 'too-large'
  | 'outside-root'
  | 'cancelled'
  | 'write-failed';

export type AssetWriteReplyV1 =
  | {
      readonly version: typeof NOTO_ASSETS_VERSION;
      readonly written: true;
      /** What to put between the brackets, ready to insert. */
      readonly reference: string;
      /** The same file as a URL the renderer may show. */
      readonly url: string;
      /** The name without its extension, which is the alt text Typora writes. */
      readonly alt: string;
    }
  | {
      readonly version: typeof NOTO_ASSETS_VERSION;
      readonly written: false;
      readonly reason: AssetRefusalV1;
    };

export type AssetResultV1<T> =
  | { readonly ok: true; readonly requestId: string; readonly value: T }
  | {
      readonly ok: false;
      readonly requestId: string;
      readonly error: { readonly code: 'BAD_REQUEST' | 'ASSET_FAILED'; readonly message: string };
    };

export interface NotoAssetsApiV1 {
  write(request: AssetWriteRequestV1): Promise<AssetResultV1<AssetWriteReplyV1>>;
  pick(request: AssetRequestV1): Promise<AssetResultV1<AssetWriteReplyV1>>;
}
