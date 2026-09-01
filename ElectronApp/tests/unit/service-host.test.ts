import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { CapabilityBroker } from '../../src/main/plugins/capability-broker';
import { isPermissionCompatibilityReply, ServiceHost } from '../../src/main/plugins/service-host';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

function readyHost(resolvePath: (candidate: string) => Promise<string>) {
  const fixturePath = '/tmp/noto-g001/fixture.md';
  const broker = new CapabilityBroker();
  const exit = deferred<number>();
  const port = { close: vi.fn(), postMessage: vi.fn() };
  const child = {
    pid: 42,
    kill: vi.fn(() => {
      exit.resolve(0);
      return true;
    }),
  };
  const generation = 7;
  const lease = {
    child,
    port,
    activeGeneration: generation,
    readyGeneration: generation,
    state: 'ready',
  } as const;
  const host = new ServiceHost(
    '/tmp/noto-g001/fs-service.js',
    fixturePath,
    broker,
    { filePath: '/tmp/noto-g001/main.ndjson', log: vi.fn() },
    resolvePath,
  );
  Object.assign(host as object, {
    child,
    port,
    activeGeneration: generation,
    readyGeneration: generation,
    readyLease: lease,
    state: 'ready',
    activeRegistryGeneration: generation,
    exitWaiter: { child, generation, promise: exit.promise, resolve: exit.resolve },
  });
  return { broker, child, fixturePath, generation, host, port };
}

describe('service readiness leases', () => {
  it('keeps registry and utility generations distinct in grants and public events', async () => {
    const context = readyHost(async (candidate) => candidate);
    const events: unknown[] = [];
    Object.assign(context.host as object, { activeRegistryGeneration: 3 });
    context.host.setEventSink((event) => events.push(event));

    const granted = await context.host.request({
      version: 1,
      requestId: 'grant:distinct',
      action: 'grant-read',
      generation: 3,
    });
    expect(granted).toMatchObject({ state: 'granted', root: 'noto-g001', generation: 3 });
    expect(context.broker.current(3, 7)).toMatchObject({
      registryGeneration: 3,
      serviceGeneration: 7,
    });
    expect(events.at(-1)).toMatchObject({
      type: 'capability',
      registryGeneration: 3,
      serviceGeneration: 7,
      capability: { grant: { generation: 3, root: 'noto-g001', state: 'active' } },
    });

    if (granted.state !== 'granted') throw new Error('expected grant');
    await context.host.request({
      version: 1,
      requestId: 'revoke:distinct',
      action: 'revoke-grant',
      generation: 3,
      grantId: granted.grantId,
    });
    expect(context.broker.size).toBe(0);
    expect(events.slice(-2)).toEqual([
      expect.objectContaining({ capability: expect.objectContaining({ grant: expect.objectContaining({ state: 'revoking' }) }) }),
      expect.objectContaining({ capability: expect.objectContaining({ grant: expect.objectContaining({ state: 'revoked' }) }) }),
    ]);
  });
  it('permits compatibility fallback only for an exact ready denial probe result', () => {
    expect(isPermissionCompatibilityReply({
      version: 1,
      type: 'ready',
      generation: 1,
      pid: 42,
      permissionOutsideDenied: false,
    })).toBe(true);
    expect(isPermissionCompatibilityReply({
      version: 1,
      type: 'ready',
      generation: 1,
      pid: 42,
      permissionOutsideDenied: true,
    })).toBe(false);
    expect(isPermissionCompatibilityReply({ type: 'ready', permissionOutsideDenied: false })).toBe(false);
    expect(isPermissionCompatibilityReply(new Error('TIMEOUT'))).toBe(false);
  });
  it('rejects a grant when stop synchronously invalidates the generation during path resolution', async () => {
    const pathStarted = deferred<void>();
    const pathResult = deferred<string>();
    const context = readyHost(async () => {
      pathStarted.resolve();
      return pathResult.promise;
    });
    const request = context.host.request(
      { version: 1, requestId: 'grant:race', action: 'grant-read', generation: context.generation },
    );
    await pathStarted.promise;
    const stopping = context.host.stop();

    expect(context.host.state).toBe('stopping');
    expect(context.host.readyGeneration).toBeNull();
    expect(context.child.kill).toHaveBeenCalledOnce();
    expect(context.host).toMatchObject({ readyLease: null });

    pathResult.resolve(context.fixturePath);
    await expect(request).rejects.toThrow('SERVICE_STOPPED: service readiness lease expired');
    await stopping;
    expect(context.broker.counters.grants).toBe(0);
    expect(context.port.postMessage).not.toHaveBeenCalled();
  });

  it('rejects dispatch when stop invalidates the generation during target resolution', async () => {
    const targetStarted = deferred<void>();
    const targetResult = deferred<string>();
    let call = 0;
    const context = readyHost((candidate) => {
      call += 1;
      if (call === 1) return Promise.resolve(candidate);
      targetStarted.resolve();
      return targetResult.promise;
    });
    const grant = context.broker.grantRead(path.dirname(context.fixturePath), context.generation, context.generation);

    const request = context.host.request({
      version: 1,
      requestId: 'read:race',
      action: 'read-granted',
      grantId: grant.id,
      generation: context.generation,
    });
    await targetStarted.promise;
    const stopping = context.host.stop();

    expect(context.host.state).toBe('stopping');
    expect(context.host.readyGeneration).toBeNull();
    targetResult.resolve(context.fixturePath);

    await expect(request).rejects.toThrow('SERVICE_STOPPED: service readiness lease expired');
    await stopping;
    expect(context.host.counters.dispatched).toBe(0);
    expect(context.port.postMessage).not.toHaveBeenCalled();
  });
});
