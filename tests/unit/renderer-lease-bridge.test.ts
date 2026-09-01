import { describe, expect, it, vi } from 'vitest';
import { RendererLeaseBridge } from '../../src/main/plugins/renderer-lease-bridge';
import type { RendererTransportRequest } from '../../src/shared/plugins/lifecycle';

const BRIDGE_SESSION = '11111111-1111-4111-8111-111111111111';
const RENDERER_SESSION = '22222222-2222-4222-8222-222222222222';

function bridge() {
  const dispatched: RendererTransportRequest[] = [];
  const instance = new RendererLeaseBridge({
    dispatch: (request) => { dispatched.push(request); },
    bridgeSessionId: BRIDGE_SESSION,
    timeoutMs: 25,
  });
  instance.rendererReady(RENDERER_SESSION);
  return { dispatched, instance };
}

describe('main renderer lease bridge', () => {
  it('does not dispatch before a trusted renderer ready handshake', async () => {
    const dispatched: RendererTransportRequest[] = [];
    const instance = new RendererLeaseBridge({
      dispatch: (request) => { dispatched.push(request); },
      bridgeSessionId: BRIDGE_SESSION,
    });
    await expect(instance.openLease({
      pluginId: 'dev.lr00rl.noto.renderer-proof',
      leaseId: 'lease:not-ready',
      generation: 1,
      settings: {},
      signal: new AbortController().signal,
    })).rejects.toThrow('PLUGIN_RENDERER_DISPOSED');
    expect(dispatched).toEqual([]);
  });

  it('serializes open requests without crossing AbortSignal and accepts one exact terminal ack', async () => {
    const { dispatched, instance } = bridge();
    const signal = new AbortController().signal;
    const pending = instance.openLease({
      pluginId: 'dev.lr00rl.noto.renderer-proof',
      leaseId: 'lease:renderer-proof',
      generation: 1,
      settings: Object.freeze({ focusEnabled: true }),
      signal,
    });

    expect(dispatched).toEqual([{
      version: 1,
      requestId: `renderer:${BRIDGE_SESSION}:1`,
      rendererSessionId: RENDERER_SESSION,
      action: 'open',
      pluginId: 'dev.lr00rl.noto.renderer-proof',
      leaseId: 'lease:renderer-proof',
      generation: 1,
      settings: { focusEnabled: true },
    }]);
    expect(JSON.stringify(dispatched[0])).not.toContain('signal');

    const ack = {
      version: 1 as const,
      requestId: `renderer:${BRIDGE_SESSION}:1`,
      rendererSessionId: RENDERER_SESSION,
      action: 'open' as const,
      ok: true as const,
      pluginId: 'dev.lr00rl.noto.renderer-proof',
      leaseId: 'lease:renderer-proof',
      generation: 1,
      registrations: 5,
    };
    expect(instance.acknowledge(ack)).toBe(true);
    await expect(pending).resolves.toEqual({ leaseId: 'lease:renderer-proof', generation: 1, registrations: 5 });
    expect(instance.acknowledge(ack)).toBe(false);
  });

  it('rejects stale or wrong-lease acknowledgements without settling the live request', async () => {
    const controller = new AbortController();
    const { instance } = bridge();
    const pending = instance.openLease({
      pluginId: 'dev.lr00rl.noto.renderer-proof',
      leaseId: 'lease:new',
      generation: 2,
      settings: Object.freeze({ focusEnabled: false }),
      signal: controller.signal,
    });

    expect(instance.acknowledge({
      version: 1,
      requestId: `renderer:${BRIDGE_SESSION}:1`,
      rendererSessionId: RENDERER_SESSION,
      action: 'open',
      ok: true,
      pluginId: 'dev.lr00rl.noto.renderer-proof',
      leaseId: 'lease:old',
      generation: 1,
      registrations: 5,
    })).toBe(false);

    controller.abort();
    await expect(pending).rejects.toThrow('PLUGIN_GENERATION_ABORTED');
  });

  it('rejects unclassified renderer failures and propagates only an allowlisted code', async () => {
    const { instance } = bridge();
    const pending = instance.openLease({
      pluginId: 'dev.lr00rl.noto.renderer-proof',
      leaseId: 'lease:private-failure',
      generation: 2,
      settings: {},
      signal: new AbortController().signal,
    });
    const privateFailure = {
      version: 1 as const,
      requestId: `renderer:${BRIDGE_SESSION}:1`,
      rendererSessionId: RENDERER_SESSION,
      action: 'open' as const,
      ok: false as const,
      pluginId: 'dev.lr00rl.noto.renderer-proof',
      leaseId: 'lease:private-failure',
      generation: 2,
      error: 'PLUGIN_FAILED: /Users/private/secret.md token=password',
    };

    expect(instance.acknowledge(privateFailure)).toBe(false);
    expect(instance.acknowledge({ ...privateFailure, error: 'PLUGIN_FAILED' })).toBe(true);
    await expect(pending).rejects.toThrow(/^PLUGIN_FAILED$/);
    await pending.catch((cause: unknown) => {
      expect(JSON.stringify(cause)).not.toContain('/Users/private/secret.md');
      expect(String(cause)).not.toContain('token=password');
    });
  });

  it('rejects pending work on renderer disposal and ignores late acknowledgements', async () => {
    const { instance } = bridge();
    const pending = instance.openLease({
      pluginId: 'dev.lr00rl.noto.renderer-proof',
      leaseId: 'lease:disposed',
      generation: 3,
      settings: Object.freeze({ focusEnabled: true }),
      signal: new AbortController().signal,
    });

    instance.rendererDisposed();
    await expect(pending).rejects.toThrow('PLUGIN_RENDERER_DISPOSED');
    expect(instance.acknowledge({
      version: 1,
      requestId: `renderer:${BRIDGE_SESSION}:1`,
      rendererSessionId: RENDERER_SESSION,
      action: 'open',
      ok: true,
      pluginId: 'dev.lr00rl.noto.renderer-proof',
      leaseId: 'lease:disposed',
      generation: 3,
      registrations: 5,
    })).toBe(false);
  });

  it('fences acknowledgements from a previous renderer session epoch', async () => {
    const { instance } = bridge();
    const pending = instance.openLease({
      pluginId: 'dev.lr00rl.noto.renderer-proof',
      leaseId: 'lease:epoch',
      generation: 4,
      settings: {},
      signal: new AbortController().signal,
    });
    instance.rendererReady('33333333-3333-4333-8333-333333333333');
    await expect(pending).rejects.toThrow('PLUGIN_RENDERER_DISPOSED');
    expect(instance.acknowledge({
      version: 1,
      requestId: `renderer:${BRIDGE_SESSION}:1`,
      rendererSessionId: RENDERER_SESSION,
      action: 'open',
      ok: true,
      pluginId: 'dev.lr00rl.noto.renderer-proof',
      leaseId: 'lease:epoch',
      generation: 4,
      registrations: 1,
    })).toBe(false);
  });

  it('uses monotonic session-scoped request IDs and bounds requests that never acknowledge', async () => {
    vi.useFakeTimers();
    try {
      const { instance } = bridge();
      const opened = instance.openLease({
        pluginId: 'dev.lr00rl.noto.renderer-proof',
        leaseId: 'lease:first',
        generation: 1,
        settings: { focusEnabled: true },
        signal: new AbortController().signal,
      });
      instance.acknowledge({
        version: 1,
        requestId: `renderer:${BRIDGE_SESSION}:1`,
        rendererSessionId: RENDERER_SESSION,
        action: 'open',
        ok: true,
        pluginId: 'dev.lr00rl.noto.renderer-proof',
        leaseId: 'lease:first',
        generation: 1,
        registrations: 5,
      });
      await opened;
      const first = instance.closeLease('lease:first');
      const second = instance.closeLease('lease:first');
      const timedOut = Promise.all([
        expect(first).rejects.toThrow('PLUGIN_RENDERER_TIMEOUT'),
        expect(second).rejects.toThrow('PLUGIN_RENDERER_TIMEOUT'),
      ]);
      await vi.advanceTimersByTimeAsync(25);
      await timedOut;
    } finally {
      vi.useRealTimers();
    }
  });
});
