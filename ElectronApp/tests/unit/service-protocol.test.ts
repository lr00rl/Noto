import { describe, expect, it } from 'vitest';
import {
  FILESYSTEM_PLUGIN_ID,
  isServiceReadMessage,
  isServiceReplyMessage,
} from '../../src/shared/plugins/protocol';

describe('utility-process service protocol', () => {
  const request = {
    version: 1,
    type: 'read',
    pluginId: FILESYSTEM_PLUGIN_ID,
    correlationId: 'service-3-abc123',
    generation: 3,
    grantId: 'grant:00000000-0000-4000-8000-000000000000',
    absolutePath: '/tmp/noto-g001/fixture.md',
  };

  it('accepts the exact bundled plugin read protocol', () => {
    expect(isServiceReadMessage(request)).toBe(true);
    expect(isServiceReplyMessage({
      version: 1,
      type: 'ready',
      generation: 3,
      pid: 42,
      permissionOutsideDenied: true,
    })).toBe(true);
    expect(isServiceReplyMessage({
      version: 1,
      type: 'read-result',
      correlationId: 'service-3-abc123',
      generation: 3,
      ok: true,
      sha256: 'a'.repeat(64),
      size: 12,
      received: 1,
    })).toBe(true);
  });

  it('rejects wrong plugins, versions, operations, and oversized paths', () => {
    expect(isServiceReadMessage({ ...request, pluginId: 'unknown' })).toBe(false);
    expect(isServiceReadMessage({ ...request, version: 2 })).toBe(false);
    expect(isServiceReadMessage({ ...request, type: 'shell' })).toBe(false);
    expect(isServiceReadMessage({ ...request, absolutePath: `/${'x'.repeat(4097)}` })).toBe(false);
    expect(isServiceReplyMessage({
      version: 1,
      type: 'read-result',
      correlationId: 'service-3-abc123',
      generation: 2,
      ok: true,
      sha256: 'bad',
      size: -1,
      received: -1,
    })).toBe(false);
  });
});
