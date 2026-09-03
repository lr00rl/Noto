import { describe, expect, it } from 'vitest';
import { imageFromTransfer, looksLikeImageAddress } from '../../src/renderer/editor/noto/image-drop';

/** Enough of a DataTransfer for the branch order to be exercised. */
function transfer(options: {
  files?: { type: string; name: string }[];
  types?: string[];
  text?: string;
}): DataTransfer {
  const files = (options.files ?? []) as unknown as File[];
  return {
    files,
    types: options.types ?? [],
    getData: (kind: string) => (kind === 'text/plain' ? options.text ?? '' : ''),
  } as unknown as DataTransfer;
}

describe('imageFromTransfer', () => {
  it('takes the file when a copied picture also carries its page URL, which is the usual case', () => {
    const found = imageFromTransfer(transfer({
      files: [{ type: 'image/png', name: 'a.png' }],
      types: ['Files', 'text/html', 'text/plain'],
      text: 'https://example.com/article',
    }));
    expect(found?.kind).toBe('file');
  });

  it('allows a file whose type the source did not state, and lets the bytes decide', () => {
    const found = imageFromTransfer(transfer({ files: [{ type: '', name: 'a.png' }], types: ['Files'] }));
    expect(found?.kind).toBe('file');
  });

  it('refuses a dropped file that says it is something other than a picture', () => {
    expect(imageFromTransfer(transfer({ files: [{ type: 'application/pdf', name: 'a.pdf' }], types: ['Files'] }))).toBeNull();
  });

  it('takes a bare address that names a picture', () => {
    const found = imageFromTransfer(transfer({ types: ['text/plain'], text: 'https://example.com/a.png' }));
    expect(found).toEqual({ kind: 'remote', href: 'https://example.com/a.png' });
  });

  it('leaves an ordinary link paste alone', () => {
    expect(imageFromTransfer(transfer({ types: ['text/plain'], text: 'https://example.com/article' }))).toBeNull();
  });

  it('leaves a paste that carries HTML to the ordinary paste path', () => {
    expect(imageFromTransfer(transfer({
      types: ['text/html', 'text/plain'],
      text: 'https://example.com/a.png',
    }))).toBeNull();
  });

  it('is null for nothing at all', () => {
    expect(imageFromTransfer(null)).toBeNull();
    expect(imageFromTransfer(transfer({}))).toBeNull();
  });
});

describe('looksLikeImageAddress', () => {
  it('reads the path and ignores what a CDN puts after it', () => {
    expect(looksLikeImageAddress('https://example.com/a.png?w=200&h=100')).toBe(true);
    expect(looksLikeImageAddress('https://example.com/deep/b.JPEG')).toBe(true);
    expect(looksLikeImageAddress('https://example.com/photo')).toBe(false);
    expect(looksLikeImageAddress('not a url')).toBe(false);
  });
});
