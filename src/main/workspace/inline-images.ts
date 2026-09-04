/**
 * Putting a note's pictures inside the file it is exported to.
 *
 * The editor serializes an image as the address the markdown holds, which is
 * almost always relative to the note: `./assets/a.png`. That is right in the
 * note and wrong everywhere else. An exported page saved to a different folder
 * showed broken pictures, and a PDF was worse: it is printed from a temporary
 * file, so every relative address was resolved against a directory with nothing
 * in it and the pictures were missing every single time.
 *
 * They are read and written into the file as data, rather than rewritten to
 * absolute paths, because an exported page that needs a second file to look
 * right is not one you can send to anybody, which is the whole point of
 * exporting it.
 *
 * The file reading is injected, so the rewriting can be tested without a disk.
 */

import path from 'node:path';
import { readFile } from 'node:fs/promises';

/** Past this, a picture is left as it is rather than bloating the file. */
export const MAX_INLINE_BYTES = 8 * 1024 * 1024;
/** And past this in total, the rest are left alone for the same reason. */
export const MAX_INLINE_TOTAL = 48 * 1024 * 1024;

const MEDIA_TYPES = new Map<string, string>([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp'],
  ['.svg', 'image/svg+xml'],
  ['.avif', 'image/avif'],
  ['.bmp', 'image/bmp'],
  ['.ico', 'image/x-icon'],
]);

export function mediaTypeFor(filePath: string): string | null {
  const dot = filePath.lastIndexOf('.');
  return dot < 0 ? null : MEDIA_TYPES.get(filePath.slice(dot).toLowerCase()) ?? null;
}

/**
 * Whether an address names a file this can read, as opposed to somewhere else.
 *
 * A web address is left alone: it already stands on its own, and fetching it
 * would be this app reaching out to the network on the reader's behalf, which
 * exporting a note is not a reason to do. Anything already inlined is left too.
 */
export function isLocalReference(source: string): boolean {
  const trimmed = source.trim();
  if (trimmed.length === 0) return false;
  return !/^[a-z][a-z0-9+.-]*:/i.test(trimmed);
}

export interface InlineDeps {
  /** The folder the note lives in, which relative addresses are relative to. */
  readonly noteDirectory: string;
  readonly read: (absolute: string) => Promise<Uint8Array>;
}

/** Matches the `src` of an `img` tag, which is the only shape our own serializer emits. */
const IMG_SRC = /(<img\b[^>]*?\bsrc=")([^"]*)(")/gi;

const decodeSource = (value: string): string => {
  // The address in the markdown is percent-encoded where it holds a space or a
  // Chinese character, which is what the editor writes and what the asset
  // protocol decodes on the way back in.
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

/** The five characters an attribute value can be ended or escaped by. */
const decodeEntities = (value: string): string => value
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'")
  .replace(/&amp;/g, '&');

export async function inlineImages(html: string, deps: InlineDeps): Promise<string> {
  const wanted = new Set<string>();
  for (const match of html.matchAll(IMG_SRC)) {
    const source = decodeSource(decodeEntities(match[2]));
    if (isLocalReference(source)) wanted.add(match[2]);
  }
  if (wanted.size === 0) return html;

  const inlined = new Map<string, string>();
  let total = 0;
  for (const raw of wanted) {
    const source = decodeSource(decodeEntities(raw));
    const media = mediaTypeFor(source);
    if (media === null) continue;
    const absolute = path.isAbsolute(source) ? source : path.resolve(deps.noteDirectory, source);
    let bytes: Uint8Array;
    try {
      bytes = await deps.read(absolute);
    } catch {
      // A picture that is not there stays as it was, so the exported file shows
      // the same broken reference the note itself shows, rather than silently
      // dropping something the author may want to fix.
      continue;
    }
    if (bytes.byteLength > MAX_INLINE_BYTES) continue;
    if (total + bytes.byteLength > MAX_INLINE_TOTAL) break;
    total += bytes.byteLength;
    inlined.set(raw, `data:${media};base64,${Buffer.from(bytes).toString('base64')}`);
  }

  return html.replace(IMG_SRC, (whole, before: string, source: string, after: string) => {
    const replacement = inlined.get(source);
    return replacement ? `${before}${replacement}${after}` : whole;
  });
}

/** The reader used in the app, kept apart so the rewriting stays testable. */
export const readFileBytes = async (absolute: string): Promise<Uint8Array> => readFile(absolute);
