/**
 * The reveal channel's shape.
 *
 * This is the one capability in the workspace API that reaches outside the app
 * entirely, so what it will accept matters more than what it does. The renderer
 * names a kind, never a path: main already knows which folder is open and which
 * document is in front, so the whole capability is "open the file manager at
 * something this window is already showing you".
 */

import { describe, expect, it } from 'vitest';
import {
  isWorkspaceRevealReplyV1, isWorkspaceRevealRequestV1, isWorkspaceRevealResultV1,
} from '../../src/shared/workspace/v1/validate';

const request = (patch: Record<string, unknown>) =>
  isWorkspaceRevealRequestV1({ version: 1, requestId: 'reveal:1', ...patch });

describe('a reveal request', () => {
  it('accepts the two kinds it defines', () => {
    expect(request({ target: 'folder' })).toBe(true);
    expect(request({ target: 'document' })).toBe(true);
  });

  it('refuses a kind it does not define', () => {
    expect(request({ target: 'home' })).toBe(false);
    expect(request({ target: '' })).toBe(false);
    expect(request({ target: 1 })).toBe(false);
  });

  it('refuses a path, which is the whole point of taking a kind', () => {
    expect(request({ target: '/etc/passwd' })).toBe(false);
    // A path smuggled alongside a valid kind is refused too, because the
    // request must carry exactly the keys it declares and nothing more.
    expect(request({ target: 'folder', path: '/etc' })).toBe(false);
  });

  it('refuses a malformed envelope', () => {
    expect(isWorkspaceRevealRequestV1(null)).toBe(false);
    expect(isWorkspaceRevealRequestV1({ version: 2, requestId: 'r:1', target: 'folder' })).toBe(false);
    expect(isWorkspaceRevealRequestV1({ version: 1, requestId: 'bad id!', target: 'folder' })).toBe(false);
    expect(isWorkspaceRevealRequestV1({ version: 1, target: 'folder' })).toBe(false);
  });
});

describe('a reveal reply', () => {
  it('says whether there was anything to show', () => {
    expect(isWorkspaceRevealReplyV1({ version: 1, revealed: true })).toBe(true);
    expect(isWorkspaceRevealReplyV1({ version: 1, revealed: false })).toBe(true);
    expect(isWorkspaceRevealReplyV1({ version: 1 })).toBe(false);
    expect(isWorkspaceRevealReplyV1({ version: 1, revealed: 'yes' })).toBe(false);
  });

  it('is only accepted for the request that asked for it', () => {
    const reply = { ok: true, requestId: 'reveal:1', value: { version: 1, revealed: true } };
    expect(isWorkspaceRevealResultV1(reply, 'reveal:1')).toBe(true);
    expect(isWorkspaceRevealResultV1(reply, 'reveal:2')).toBe(false);
  });
});
