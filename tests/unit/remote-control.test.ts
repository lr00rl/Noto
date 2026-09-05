import { describe, expect, it, vi } from 'vitest';
import {
  bearerOf, handleRemote, hostAllowed, looksLikeBrowser, MAX_INSERT_BYTES, REMOTE_COMMANDS, tokenMatches,
  type RemoteDeps, type RemoteRequest,
} from '../../src/main/remote/remote-control';

const TOKEN = 'a'.repeat(43);

const deps = (patch: Partial<RemoteDeps> = {}): RemoteDeps => ({
  token: TOKEN,
  port: 37610,
  status: () => ({ version: '1.2.3', vault: '/vault', note: '/vault/a.md', dirty: false }),
  readCurrent: async () => ({ path: '/vault/a.md', markdown: '# A\n' }),
  open: async () => ({ opened: true }),
  insert: () => ({ inserted: true }),
  run: () => ({ ran: true }),
  ...patch,
});

const request = (patch: Partial<RemoteRequest> = {}): RemoteRequest => ({
  method: 'GET',
  path: '/v1/status',
  headers: { authorization: `Bearer ${TOKEN}`, host: '127.0.0.1:37610' },
  body: '',
  ...patch,
});

describe('who may drive the editor', () => {
  it('refuses a request with no token, and one with the wrong token', async () => {
    expect((await handleRemote(request({ headers: { host: '127.0.0.1' } }), deps())).status).toBe(401);
    expect((await handleRemote(request({
      headers: { authorization: 'Bearer b', host: '127.0.0.1' },
    }), deps())).status).toBe(401);
    expect((await handleRemote(request(), deps())).status).toBe(200);
  });

  it('refuses anything a browser could have sent, token or not', async () => {
    const fromPage = request({
      headers: { authorization: `Bearer ${TOKEN}`, host: '127.0.0.1:37610', origin: 'https://example.com' },
    });
    expect((await handleRemote(fromPage, deps())).status).toBe(403);
    const navigating = request({
      headers: { authorization: `Bearer ${TOKEN}`, host: '127.0.0.1:37610', 'sec-fetch-mode': 'navigate' },
    });
    expect((await handleRemote(navigating, deps())).status).toBe(403);
    expect(looksLikeBrowser({ origin: '' })).toBe(false);
    // The fetch built into Node says this, and it is exactly who this is for.
    expect(looksLikeBrowser({ 'sec-fetch-mode': 'cors' })).toBe(false);
  });

  it('refuses a name pointed at the loopback address, which is what rebinding is', async () => {
    const rebound = request({ headers: { authorization: `Bearer ${TOKEN}`, host: 'evil.example.com:37610' } });
    expect((await handleRemote(rebound, deps())).status).toBe(403);
    expect(hostAllowed('127.0.0.1:37610', 37610)).toBe(true);
    expect(hostAllowed('localhost:37610', 37610)).toBe(true);
    expect(hostAllowed('127.0.0.1', 37610)).toBe(true);
    expect(hostAllowed('127.0.0.1:9999', 37610)).toBe(false);
    expect(hostAllowed('127.0.0.1.nip.io:37610', 37610)).toBe(false);
    expect(hostAllowed(undefined, 37610)).toBe(false);
  });

  it('compares the token without leaking its length by returning early', () => {
    expect(tokenMatches(TOKEN, TOKEN)).toBe(true);
    expect(tokenMatches('short', TOKEN)).toBe(false);
    expect(tokenMatches('', '')).toBe(false);
    expect(bearerOf({ authorization: '  Bearer   xyz ' })).toBe('xyz');
    expect(bearerOf({ authorization: 'Basic xyz' })).toBeNull();
    expect(bearerOf({})).toBeNull();
  });
});

describe('what it will do', () => {
  it('says what is open', async () => {
    const reply = await handleRemote(request(), deps());
    expect(reply.body).toMatchObject({ version: '1.2.3', note: '/vault/a.md', dirty: false });
  });

  it('reads the note in front, and says when there is none', async () => {
    expect((await handleRemote(request({ path: '/v1/document' }), deps())).body)
      .toEqual({ path: '/vault/a.md', markdown: '# A\n' });
    const empty = await handleRemote(request({ path: '/v1/document' }), deps({ readCurrent: async () => null }));
    expect(empty.status).toBe(404);
  });

  it('opens a note by asking main, which is what confines it to the folder', async () => {
    const open = vi.fn(async () => ({ opened: true }));
    const reply = await handleRemote(
      request({ method: 'POST', path: '/v1/open', body: JSON.stringify({ path: '/vault/b.md' }) }),
      deps({ open }),
    );
    expect(reply.status).toBe(200);
    expect(open).toHaveBeenCalledWith('/vault/b.md');
    const refused = await handleRemote(
      request({ method: 'POST', path: '/v1/open', body: JSON.stringify({ path: '/etc/passwd' }) }),
      deps({ open: async () => ({ opened: false, reason: 'That is not in this folder.' }) }),
    );
    expect(refused).toEqual({ status: 404, body: { error: 'That is not in this folder.' } });
  });

  it('inserts text, within a limit', async () => {
    const insert = vi.fn(() => ({ inserted: true }));
    await handleRemote(
      request({ method: 'POST', path: '/v1/insert', body: JSON.stringify({ text: 'hello' }) }),
      deps({ insert }),
    );
    expect(insert).toHaveBeenCalledWith('hello');
    const huge = await handleRemote(
      request({ method: 'POST', path: '/v1/insert', body: JSON.stringify({ text: 'x'.repeat(MAX_INSERT_BYTES + 1) }) }),
      deps(),
    );
    expect(huge.status).toBe(413);
  });

  it('runs only the commands on its own list', async () => {
    const run = vi.fn(() => ({ ran: true }));
    for (const command of REMOTE_COMMANDS) {
      const reply = await handleRemote(
        request({ method: 'POST', path: '/v1/command', body: JSON.stringify({ command }) }),
        deps({ run }),
      );
      expect(reply.status).toBe(200);
    }
    expect(run).toHaveBeenCalledTimes(REMOTE_COMMANDS.length);
    // A command the menu has and this list does not.
    const refused = await handleRemote(
      request({ method: 'POST', path: '/v1/command', body: JSON.stringify({ command: 'export-pdf' }) }),
      deps({ run }),
    );
    expect(refused.status).toBe(400);
    expect(run).toHaveBeenCalledTimes(REMOTE_COMMANDS.length);
  });

  it('refuses what it does not understand', async () => {
    expect((await handleRemote(request({ path: '/v1/nothing' }), deps())).status).toBe(404);
    expect((await handleRemote(request({ method: 'DELETE', path: '/v1/document' }), deps())).status).toBe(404);
    expect((await handleRemote(request({ method: 'POST', path: '/v1/open', body: 'not json' }), deps())).status).toBe(400);
    expect((await handleRemote(request({ method: 'POST', path: '/v1/open', body: '[]' }), deps())).status).toBe(400);
    expect((await handleRemote(request({ method: 'POST', path: '/v1/insert', body: '{}' }), deps())).status).toBe(400);
  });

  it('reads a path with a query or a trailing slash as the same path', async () => {
    expect((await handleRemote(request({ path: '/v1/status?x=1' }), deps())).status).toBe(200);
    expect((await handleRemote(request({ path: '/v1/status/' }), deps())).status).toBe(200);
  });
});
