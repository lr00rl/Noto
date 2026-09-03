/**
 * What kind of picture a run of bytes is.
 *
 * The extension decides two things that both matter: what the file is called
 * on disk, and whether the asset protocol will serve it back, since that guard
 * reads the name and not the content. So the name has to be derived from the
 * bytes. A clipboard says it holds an `image/png` and is sometimes wrong, and a
 * dropped file's own name is a string that came from outside, so neither is
 * trusted here.
 *
 * Only the types the protocol already serves. Anything else returns null and
 * is refused rather than written under a name that would never load.
 */

const ascii = (bytes: Uint8Array, at: number, text: string): boolean => {
  if (at + text.length > bytes.length) return false;
  for (let i = 0; i < text.length; i += 1) {
    if (bytes[at + i] !== text.charCodeAt(i)) return false;
  }
  return true;
};

const starts = (bytes: Uint8Array, signature: readonly number[]): boolean =>
  bytes.length >= signature.length && signature.every((byte, i) => bytes[i] === byte);

/**
 * SVG is text, so it has no magic number and has to be read.
 *
 * Only the head is examined: a comment or a doctype may come first, but an
 * `<svg` element that appears three kilobytes into a file is not what the file
 * is, and treating it as one would let any text document be written as a
 * picture.
 */
function looksLikeSvg(bytes: Uint8Array): boolean {
  const head = new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(0, 1024));
  if (!/^\s*(<\?xml[\s\S]*?\?>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*</.test(head)) {
    return false;
  }
  return /<svg[\s/>]/i.test(head);
}

/** The extension, with its dot, or null when the bytes are not a picture. */
export function sniffImageExtension(bytes: Uint8Array): string | null {
  if (bytes.length < 4) return null;
  if (starts(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return '.png';
  if (starts(bytes, [0xff, 0xd8, 0xff])) return '.jpg';
  if (ascii(bytes, 0, 'GIF87a') || ascii(bytes, 0, 'GIF89a')) return '.gif';
  if (ascii(bytes, 0, 'RIFF') && ascii(bytes, 8, 'WEBP')) return '.webp';
  // An ISO base media file names its brand right after the box type, and the
  // brand is the only part that says which of the family this is.
  if (ascii(bytes, 4, 'ftyp') && (ascii(bytes, 8, 'avif') || ascii(bytes, 8, 'avis'))) return '.avif';
  if (ascii(bytes, 0, 'BM')) return '.bmp';
  if (starts(bytes, [0x00, 0x00, 0x01, 0x00])) return '.ico';
  if (looksLikeSvg(bytes)) return '.svg';
  return null;
}
