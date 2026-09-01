/**
 * Line ending conversion.
 *
 * Its own module because both the main process parser and the sandboxed
 * renderer need it, and the renderer must not reach anything that imports
 * `node:crypto`.
 *
 * The convention: editors, plugins and every in-memory representation use LF.
 * The original ending is restored only when bytes are written back to disk.
 */

import type { NotoLineEnding } from './contracts';

export function toLf(text: string): string {
  return text.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
}

export function fromLf(text: string, lineEnding: NotoLineEnding): string {
  return lineEnding === 'crlf' ? text.replaceAll('\n', '\r\n') : text;
}
