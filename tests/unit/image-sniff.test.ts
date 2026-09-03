import { describe, expect, it } from 'vitest';
import { sniffImageExtension } from '../../src/shared/assets/v1/sniff';

const bytes = (...values: number[]) => new Uint8Array(values);
const text = (value: string) => new TextEncoder().encode(value);

describe('sniffImageExtension', () => {
  it('reads each format the asset protocol serves', () => {
    expect(sniffImageExtension(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2))).toBe('.png');
    expect(sniffImageExtension(bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0))).toBe('.jpg');
    expect(sniffImageExtension(text('GIF89a and then anything'))).toBe('.gif');
    expect(sniffImageExtension(text('GIF87a and then anything'))).toBe('.gif');
    expect(sniffImageExtension(text('RIFF____WEBPVP8 '))).toBe('.webp');
    expect(sniffImageExtension(text('____ftypavif____'))).toBe('.avif');
    expect(sniffImageExtension(text('BM and a header'))).toBe('.bmp');
    expect(sniffImageExtension(bytes(0x00, 0x00, 0x01, 0x00, 1, 0))).toBe('.ico');
  });

  it('reads an SVG through the things that come before the element', () => {
    expect(sniffImageExtension(text('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBe('.svg');
    expect(sniffImageExtension(text('<?xml version="1.0"?>\n<svg viewBox="0 0 1 1"/>'))).toBe('.svg');
    expect(sniffImageExtension(text('<!-- drawn by hand -->\n<svg/>'))).toBe('.svg');
    expect(sniffImageExtension(text('\n  <svg width="10"/>'))).toBe('.svg');
  });

  it('refuses a document that merely mentions an svg element later on', () => {
    expect(sniffImageExtension(text(`A note about SVG.\n\n${'x'.repeat(200)}\n<svg/>`))).toBeNull();
  });

  it('refuses what the protocol would not serve', () => {
    expect(sniffImageExtension(text('%PDF-1.7'))).toBeNull();
    expect(sniffImageExtension(bytes(0x50, 0x4b, 0x03, 0x04))).toBeNull();
    expect(sniffImageExtension(text('# just a note'))).toBeNull();
    expect(sniffImageExtension(bytes(1, 2))).toBeNull();
    expect(sniffImageExtension(new Uint8Array())).toBeNull();
  });

  it('refuses a RIFF container that is not a WEBP', () => {
    expect(sniffImageExtension(text('RIFF____WAVEfmt '))).toBeNull();
  });

  it('refuses an ISO container whose brand is not one it serves', () => {
    expect(sniffImageExtension(text('____ftypheic____'))).toBeNull();
  });
});
