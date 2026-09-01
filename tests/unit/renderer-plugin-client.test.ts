import { describe, expect, it, vi } from 'vitest';
import type { NotoPluginsApi } from '../../src/shared/ipc/contracts';
import type {
  RendererReadyMessage,
  RendererTransportAck,
  RendererTransportRequest,
} from '../../src/shared/plugins/lifecycle';
import { RendererPluginClient } from '../../src/renderer/plugins/RendererPluginClient';
import type { RendererPluginHost } from '../../src/renderer/plugins/RendererPluginHost';

const PLUGIN_ID = 'dev.lr00rl.noto.renderer-proof';
const LEASE_ID = 'lease:privacy';

function harness(host: Partial<RendererPluginHost>) {
  const acknowledgements: RendererTransportAck[] = [];
  let listener: ((request: RendererTransportRequest) => void) | null = null;
  let ready: RendererReadyMessage | null = null;
  const api = {
    acknowledgeRenderer: (ack: RendererTransportAck) => { acknowledgements.push(ack); },
    onRendererRequest: (next: (request: RendererTransportRequest) => void) => {
      listener = next;
      return () => { listener = null; };
    },
    rendererReady: (message: RendererReadyMessage) => { ready = message; },
  } as unknown as NotoPluginsApi;
  // One host per plugin, so the double is registered under the id the
  // requests carry.
  const client = new RendererPluginClient(
    new Map([[PLUGIN_ID, host as RendererPluginHost]]),
    api,
  );
  client.start();
  if (!listener || !ready) throw new Error('test renderer client did not start');
  return {
    acknowledgements,
    dispatch: listener as (request: RendererTransportRequest) => void,
    rendererSessionId: (ready as RendererReadyMessage).rendererSessionId,
  };
}

function requestBase(rendererSessionId: string) {
  return {
    version: 1 as const,
    rendererSessionId,
    pluginId: PLUGIN_ID,
    leaseId: LEASE_ID,
    generation: 1,
  };
}

describe('renderer plugin client failure privacy', () => {
  it('maps arbitrary thrown details to a public code before negative acknowledgement', async () => {
    const privateDetail = '/Users/private/secret.md token=abc password=hunter2';
    const { acknowledgements, dispatch, rendererSessionId } = harness({
      openLease: vi.fn(async () => { throw new Error(privateDetail); }),
    });

    dispatch({
      ...requestBase(rendererSessionId),
      requestId: 'renderer:privacy:1',
      action: 'open',
      settings: {},
    });

    await vi.waitFor(() => expect(acknowledgements).toHaveLength(1));
    expect(acknowledgements[0]).toMatchObject({ ok: false, error: 'PLUGIN_FAILED' });
    expect(JSON.stringify(acknowledgements[0])).not.toContain('/Users/private/secret.md');
    expect(JSON.stringify(acknowledgements[0])).not.toContain('token=abc');
    expect(JSON.stringify(acknowledgements[0])).not.toContain('password=hunter2');
  });

  it('preserves known stale, abort, and disposed classifications without their details', async () => {
    for (const code of [
      'PLUGIN_GENERATION_STALE',
      'PLUGIN_GENERATION_ABORTED',
      'PLUGIN_RENDERER_DISPOSED',
    ] as const) {
      const acknowledgements: RendererTransportAck[] = [];
      const result = harness({
        openLease: vi.fn(async () => {
          throw new Error(`${code}: /Users/private/secret.md token=password`);
        }),
      });
      result.dispatch({
        ...requestBase(result.rendererSessionId),
        requestId: `renderer:privacy:${code}`,
        action: 'open',
        settings: {},
      });
      await vi.waitFor(() => expect(result.acknowledgements).toHaveLength(1));
      acknowledgements.push(...result.acknowledgements);
      expect(acknowledgements[0]).toMatchObject({ ok: false, error: code });
      expect(JSON.stringify(acknowledgements[0])).not.toContain('/Users/private/secret.md');
    }
  });

  it('maps arbitrary close failures before acknowledging cleanup retry state', async () => {
    const host = {
      openLease: vi.fn(async () => ({ leaseId: LEASE_ID, generation: 1, registrations: 1 })),
      closeLease: vi.fn(async () => ({
        leaseId: LEASE_ID,
        complete: false,
        failures: ['/Users/private/secret.md token=abc password=hunter2'],
        registrations: 0 as const,
      })),
    };
    const { acknowledgements, dispatch, rendererSessionId } = harness(host);
    dispatch({
      ...requestBase(rendererSessionId),
      requestId: 'renderer:privacy:open',
      action: 'open',
      settings: {},
    });
    await vi.waitFor(() => expect(acknowledgements).toHaveLength(1));

    dispatch({
      ...requestBase(rendererSessionId),
      requestId: 'renderer:privacy:close',
      action: 'close',
    });
    await vi.waitFor(() => expect(acknowledgements).toHaveLength(2));

    expect(acknowledgements[1]).toMatchObject({
      action: 'close',
      ok: true,
      complete: false,
      failures: ['PLUGIN_FAILED'],
    });
    expect(JSON.stringify(acknowledgements[1])).not.toContain('/Users/private/secret.md');
    expect(JSON.stringify(acknowledgements[1])).not.toContain('token=abc');
    expect(JSON.stringify(acknowledgements[1])).not.toContain('password=hunter2');
  });
});
