import { describe, expect, it } from 'vitest';
import { ASSET_ORIGIN, fromAssetUrl, toAssetUrl } from '../../src/shared/assets/v1/contracts';
import { imageName, joinPath, resolveImageSource } from '../../src/renderer/editor/noto/image-source';

const note = { documentDir: '/Users/me/vault/notes', remote: true };
const asset = (absolute: string) => ({ kind: 'url', url: toAssetUrl(absolute) });

describe('resolving an image source', () => {
  it('resolves a relative path against the folder the note is in', () => {
    expect(resolveImageSource('./pics/a.png', note)).toEqual(asset('/Users/me/vault/notes/pics/a.png'));
    expect(resolveImageSource('pics/a.png', note)).toEqual(asset('/Users/me/vault/notes/pics/a.png'));
    // The vault's own habit: a sibling assets folder one level up.
    expect(resolveImageSource('../.gitbook/assets/map.png', note))
      .toEqual(asset('/Users/me/vault/.gitbook/assets/map.png'));
  });

  it('keeps an absolute path and a file URL as the path they name', () => {
    expect(resolveImageSource('/tmp/shot.png', note)).toEqual(asset('/tmp/shot.png'));
    expect(resolveImageSource('file:///Users/me/a%20b.png', note)).toEqual(asset('/Users/me/a b.png'));
    expect(resolveImageSource('file:///C:/pics/a.png', note)).toEqual(asset('C:\\pics\\a.png'));
  });

  it('reads %20 as a space, and leaves a stray percent sign alone', () => {
    expect(resolveImageSource('./my%20pic.png', note)).toEqual(asset('/Users/me/vault/notes/my pic.png'));
    expect(resolveImageSource('./100%.png', note)).toEqual(asset('/Users/me/vault/notes/100%.png'));
  });

  it('follows the folder separator on Windows', () => {
    const windows = { documentDir: 'C:\\vault\\notes', remote: true };
    expect(resolveImageSource('..\\assets\\a.png', windows)).toEqual(asset('C:\\vault\\assets\\a.png'));
    expect(resolveImageSource('C:/shots/b.png', windows)).toEqual(asset('C:\\shots\\b.png'));
  });

  it('gates web images on the setting and passes data URLs through', () => {
    expect(resolveImageSource('https://x.test/a.png', note)).toEqual({ kind: 'url', url: 'https://x.test/a.png' });
    // Plain http is never asked for in the clear.
    expect(resolveImageSource('HTTP://x.test/a.png', note)).toEqual({ kind: 'url', url: 'https://x.test/a.png' });
    expect(resolveImageSource('https://x.test/a.png', { ...note, remote: false }))
      .toEqual({ kind: 'remote-off', url: 'https://x.test/a.png' });
    expect(resolveImageSource('data:image/png;base64,AAAA', { ...note, remote: false }))
      .toEqual({ kind: 'url', url: 'data:image/png;base64,AAAA' });
  });

  it('refuses what it cannot name', () => {
    expect(resolveImageSource('', note)).toEqual({ kind: 'unresolved', reason: 'empty' });
    expect(resolveImageSource('javascript:alert(1)', note)).toEqual({ kind: 'unresolved', reason: 'scheme' });
    expect(resolveImageSource('./a.png', { documentDir: null, remote: true }))
      .toEqual({ kind: 'unresolved', reason: 'no-document' });
  });

  it('never lets a relative path climb past the root', () => {
    expect(joinPath('/a/b', '../../../../etc/passwd.png')).toBe('/etc/passwd.png');
    expect(joinPath('C:\\a', '..\\..\\x.png')).toBe('C:\\x.png');
  });
});

describe('the asset URL', () => {
  it('round-trips a path with every awkward character in it', () => {
    for (const absolute of ['/Users/me/a b/#1 (final).png', '/Users/me/中文/图.png', 'C:\\x\\y.png', '/a/../b.png']) {
      const url = toAssetUrl(absolute);
      expect(url.startsWith(`${ASSET_ORIGIN}/`)).toBe(true);
      expect(fromAssetUrl(new URL(url))).toBe(absolute);
    }
  });

  it('is not read from any other URL', () => {
    expect(fromAssetUrl(new URL('noto://bundle/index.html'))).toBeNull();
    expect(fromAssetUrl(new URL('noto://asset/'))).toBeNull();
    expect(fromAssetUrl(new URL('noto://asset/%E0%A4%A'))).toBeNull();
  });
});

describe('the name a placeholder shows', () => {
  it('is the last segment, decoded, without a query', () => {
    expect(imageName('https://x.test/dir/photo%20one.jpg?raw=1')).toBe('photo one.jpg');
    expect(imageName('../assets/map.png')).toBe('map.png');
    expect(imageName('C:\\pics\\a.png')).toBe('a.png');
  });
});
