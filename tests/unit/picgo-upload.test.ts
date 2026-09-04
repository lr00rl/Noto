/**
 * The PicGo contract, without PicGo.
 *
 * One request, one reply. What is tested is every way the reply can be wrong
 * and what the reader is told in each case, since the failure this feature has
 * to avoid is a paste that appears to do nothing.
 */

import { describe, expect, it } from 'vitest';
import { PICGO_ENDPOINT, acceptableUrl, uploadThroughPicGo } from '../../src/main/workspace/picgo-upload';

const answering = (status: number, body: unknown, capture?: (init: RequestInit) => void): typeof fetch =>
  (async (_url: unknown, init?: RequestInit) => {
    capture?.(init ?? {});
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status, headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;

describe('acceptableUrl', () => {
  it('takes an https address and gives back its parsed form', () => {
    expect(acceptableUrl('https://bucket.example.com/typora/a.png')).toBe('https://bucket.example.com/typora/a.png');
  });

  it('refuses anything the note could not show', () => {
    // The renderer allows pictures over TLS and nothing else, so an http
    // address would be written into the note and then shown as not found.
    expect(acceptableUrl('http://bucket.example.com/a.png')).toBeNull();
    expect(acceptableUrl('/local/a.png')).toBeNull();
    expect(acceptableUrl('not a url')).toBeNull();
    expect(acceptableUrl('')).toBeNull();
  });
});

describe('uploadThroughPicGo', () => {
  it('posts the file path as PicGo expects and returns the address it gives back', async () => {
    let sent: RequestInit = {};
    const outcome = await uploadThroughPicGo('/vault/assets/a.png', {
      fetch: answering(200, { success: true, result: ['https://img.example.com/typora/a.png'] }, (init) => { sent = init; }),
    });
    expect(outcome).toEqual({ uploaded: true, url: 'https://img.example.com/typora/a.png' });
    expect(sent.method).toBe('POST');
    expect(JSON.parse(String(sent.body))).toEqual({ list: ['/vault/assets/a.png'] });
  });

  it('uses the address PicGo.app listens on by default', async () => {
    let asked = '';
    await uploadThroughPicGo('/a.png', {
      fetch: (async (url: unknown) => { asked = String(url); return new Response('{"success":true,"result":["https://x/a.png"]}'); }) as unknown as typeof fetch,
    });
    expect(asked).toBe(PICGO_ENDPOINT);
    expect(PICGO_ENDPOINT).toBe('http://127.0.0.1:36677/upload');
  });

  it('says PicGo is not running when nothing answers', async () => {
    const outcome = await uploadThroughPicGo('/a.png', {
      fetch: (async () => { throw new TypeError('fetch failed'); }) as unknown as typeof fetch,
    });
    expect(outcome).toMatchObject({ uploaded: false, reason: 'unreachable' });
  });

  it('passes on the reason when PicGo refuses', async () => {
    const outcome = await uploadThroughPicGo('/a.png', {
      fetch: answering(200, { success: false, message: 'upload failed: bucket not found' }),
    });
    expect(outcome).toMatchObject({ uploaded: false, reason: 'refused', detail: 'upload failed: bucket not found' });
  });

  it('refuses an address that is not https, rather than writing one the note cannot show', async () => {
    const outcome = await uploadThroughPicGo('/a.png', {
      fetch: answering(200, { success: true, result: ['http://img.example.com/a.png'] }),
    });
    expect(outcome).toMatchObject({ uploaded: false, reason: 'bad-reply' });
  });

  it('treats something that is not PicGo on that port as a bad reply, not a success', async () => {
    expect(await uploadThroughPicGo('/a.png', { fetch: answering(200, '<html>hello</html>') }))
      .toMatchObject({ uploaded: false, reason: 'bad-reply' });
    expect(await uploadThroughPicGo('/a.png', { fetch: answering(200, { hello: 'world' }) }))
      .toMatchObject({ uploaded: false, reason: 'bad-reply' });
  });
});
