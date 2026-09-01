import { describe, expect, it, vi } from 'vitest';
import {
  PluginRegistry,
  toPublicPluginFailure,
  type PluginRegistryStateStore,
  type RendererLeaseHost,
  type ServicePluginHost,
} from '../../src/main/plugins/plugin-registry';
import { createPluginCatalog } from '../../src/shared/plugins/catalog';
import type {
  RendererLeaseMaterialization,
  RendererLeaseRequest,
} from '../../src/shared/plugins/lifecycle';
import {
  filesystemProofManifest,
  rendererProofManifest,
} from '../../src/shared/plugins/proof-manifests';
import {
  cloneLocalPluginState,
  createDefaultLocalPluginState,
  type LocalPluginState,
} from '../../src/shared/plugins/state';

const catalog = createPluginCatalog([rendererProofManifest, filesystemProofManifest]);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function memoryStore(initial: LocalPluginState = createDefaultLocalPluginState(catalog)) {
  let state = cloneLocalPluginState(initial);
  const saves: LocalPluginState[] = [];
  const store: PluginRegistryStateStore = {
    load: vi.fn(async () => cloneLocalPluginState(state)),
    save: vi.fn(async (next) => {
      state = cloneLocalPluginState(next);
      saves.push(cloneLocalPluginState(next));
      return { status: 'durable' as const, health: 'healthy' as const, state: cloneLocalPluginState(next) };
    }),
  };
  return { read: () => cloneLocalPluginState(state), saves, store };
}

function rendererHost(
  openLease: RendererLeaseHost['openLease'] = async (request) => ({
    leaseId: request.leaseId,
    generation: request.generation,
    registrations: 5,
  }),
): RendererLeaseHost & {
  opened: RendererLeaseRequest[];
  closed: string[];
  commands: Array<{ leaseId: string; commandId: string; signal: AbortSignal }>;
  settingUpdates: Array<{
    leaseId: string;
    key: string;
    value: boolean;
    signal: AbortSignal;
  }>;
  updateLeaseSetting(
    leaseId: string,
    key: string,
    value: boolean,
    signal: AbortSignal,
  ): Promise<void>;
} {
  const opened: RendererLeaseRequest[] = [];
  const closed: string[] = [];
  const commands: Array<{ leaseId: string; commandId: string; signal: AbortSignal }> = [];
  const settingUpdates: Array<{
    leaseId: string;
    key: string;
    value: boolean;
    signal: AbortSignal;
  }> = [];
  return {
    opened,
    closed,
    commands,
    settingUpdates,
    openLease: async (request) => {
      opened.push(request);
      return openLease(request);
    },
    closeLease: async (leaseId) => {
      closed.push(leaseId);
      return { leaseId, complete: true, failures: [], registrations: 0 };
    },
    executeLeaseCommand: async (leaseId, commandId, signal) => {
      commands.push({ leaseId, commandId, signal });
      return true;
    },
    updateLeaseSetting: async (leaseId, key, value, signal) => {
      settingUpdates.push({ leaseId, key, value, signal });
    },
  };
}

function serviceHost(): ServicePluginHost & { starts: AbortSignal[]; stops: number } {
  const host = {
    starts: [] as AbortSignal[],
    stops: 0,
    activate: async (signal: AbortSignal) => { host.starts.push(signal); return host.starts.length; },
    deactivate: async () => { host.stops += 1; },
    executeCommand: async () => true,
  };
  return host;
}

describe('main-owned plugin registry', () => {
  it('exposes discovered before hydration and adopts persisted disabled truth after hydration', async () => {
    const registry = new PluginRegistry({
      catalog,
      stateStore: memoryStore().store,
      rendererHost: rendererHost(),
      serviceHost: serviceHost(),
    });

    expect(registry.getSnapshots().map((snapshot) => snapshot.lifecycle))
      .toEqual(['discovered', 'discovered']);

    await registry.hydrate();

    expect(registry.getSnapshots().map((snapshot) => snapshot.lifecycle))
      .toEqual(['disabled', 'disabled']);
  });

  it('keeps discovery failure visible and rejects every lifecycle mutation', async () => {
    const store = memoryStore();
    const registry = new PluginRegistry({
      catalog,
      initialDiscoveryFailure: 'PLUGIN_DISCOVERY_MANIFEST_INVALID',
      stateStore: store.store,
      rendererHost: rendererHost(),
      serviceHost: serviceHost(),
    });

    expect(registry.getSnapshots()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        lifecycle: 'failed',
        lastFailure: 'PLUGIN_DISCOVERY_MANIFEST_INVALID',
      }),
    ]));
    await expect(registry.hydrate()).rejects.toThrow('PLUGIN_DISCOVERY_MANIFEST_INVALID');
    expect(() => registry.enable(rendererProofManifest.id)).toThrow('PLUGIN_NOT_HYDRATED');
    expect(store.store.load).not.toHaveBeenCalled();
  });

  it('maps public plugin failures through a finite controlled code set', () => {
    expect(toPublicPluginFailure(new Error('PLUGIN_STALE: /Users/private/secret.md')))
      .toBe('PLUGIN_STALE');
    expect(toPublicPluginFailure(new Error('TIMEOUT: password=secret'))).toBe('TIMEOUT');
    expect(toPublicPluginFailure(new Error('PLUGIN_CLEANUP_TIMEOUT')))
      .toBe('PLUGIN_CLEANUP_TIMEOUT');
    expect(toPublicPluginFailure(new Error('CAPABILITY_DENIED: token=secret')))
      .toBe('CAPABILITY_DENIED');
    expect(toPublicPluginFailure(new Error('PLUGIN_CAPABILITY_DENIED: token=secret')))
      .toBe('PLUGIN_CAPABILITY_DENIED');
    expect(toPublicPluginFailure(
      new Error("ENOENT: no such file or directory, realpath '/Users/private/secret.md'"),
    )).toBe('PLUGIN_FAILED');
  });

  it('does not publish a realpath activation error path or errno text', async () => {
    const service: ServicePluginHost = {
      activate: async () => {
        throw new Error("ENOENT: no such file or directory, realpath '/Users/private/secret.md'");
      },
      deactivate: async () => undefined,
    };
    const registry = new PluginRegistry({
      catalog,
      stateStore: memoryStore().store,
      rendererHost: rendererHost(),
      serviceHost: service,
    });
    await registry.hydrate();
    await registry.enable(filesystemProofManifest.id);

    await expect(registry.triggerEvent('document.opened')).rejects.toThrow('ENOENT');

    const serialized = JSON.stringify(registry.getSnapshot(filesystemProofManifest.id));
    expect(registry.getSnapshot(filesystemProofManifest.id).lastFailure).toBe('PLUGIN_FAILED');
    expect(serialized).not.toMatch(/\/Users\/|private|secret|ENOENT|realpath/);
  });

  it('does not publish state load or mkdir-save EACCES evidence', async () => {
    const loadFailure = new PluginRegistry({
      catalog,
      stateStore: {
        load: async () => {
          throw new Error("EACCES: permission denied, open '/Users/private/profile/plugins/local-state.json'");
        },
        save: async () => { throw new Error('unreachable'); },
      },
      rendererHost: rendererHost(),
      serviceHost: serviceHost(),
    });
    await expect(loadFailure.hydrate()).rejects.toThrow('EACCES');
    for (const snapshot of loadFailure.getSnapshots()) {
      expect(snapshot.lastFailure).toBe('READ_LOCAL_PLUGIN_STATE_FAILED');
      expect(JSON.stringify(snapshot)).not.toMatch(/\/Users\/|private|profile|EACCES|permission denied/);
    }

    const saveFailure = memoryStore();
    saveFailure.store.save = vi.fn(async () => {
      throw new Error("EACCES: permission denied, mkdir '/Users/private/profile/plugins'");
    });
    const registry = new PluginRegistry({
      catalog,
      stateStore: saveFailure.store,
      rendererHost: rendererHost(),
      serviceHost: serviceHost(),
    });
    await registry.hydrate();
    await expect(registry.enable(rendererProofManifest.id)).rejects.toThrow('EACCES');
    const serialized = JSON.stringify(registry.getSnapshot(rendererProofManifest.id));
    expect(registry.getSnapshot(rendererProofManifest.id).lastFailure)
      .toBe('WRITE_LOCAL_PLUGIN_STATE_FAILED');
    expect(serialized).not.toMatch(/\/Users\/|private|profile|EACCES|permission denied|mkdir/);
  });

  it('adopts capability and crash events only for the owned registry and service generations', async () => {
    let sink: Parameters<NonNullable<ServicePluginHost['setEventSink']>>[0] = () => undefined;
    let serviceGeneration = 70;
    const service: ServicePluginHost = {
      activate: async () => ++serviceGeneration,
      deactivate: async () => undefined,
      setEventSink: (next) => { sink = next; },
    };
    const registry = new PluginRegistry({
      stateStore: memoryStore().store,
      rendererHost: rendererHost(),
      serviceHost: service,
    });
    await registry.hydrate();
    await registry.enable(filesystemProofManifest.id);
    await registry.triggerEvent('document.opened');
    const active = registry.getSnapshot(filesystemProofManifest.id);
    expect(active.activeGeneration).toBe(1);

    sink({
      type: 'capability',
      registryGeneration: 1,
      serviceGeneration: 71,
      capability: {
        grant: { id: 'grant:00000000-0000-4000-8000-000000000000', generation: 1, root: 'notes', state: 'active' },
        request: null,
        restartRequired: false,
      },
    });
    expect(registry.getSnapshot(filesystemProofManifest.id).capability.grant?.root).toBe('notes');
    sink({
      type: 'unexpected-exit',
      registryGeneration: 1,
      serviceGeneration: 72,
      detail: 'stale',
    });
    expect(registry.getSnapshot(filesystemProofManifest.id).lifecycle).toBe('active');

    sink({
      type: 'unexpected-exit',
      registryGeneration: 1,
      serviceGeneration: 71,
      detail: 'current',
    });
    expect(registry.getSnapshot(filesystemProofManifest.id)).toMatchObject({
      desiredEnabled: true,
      lifecycle: 'crashed',
      activeGeneration: null,
      capability: { restartRequired: true },
    });

    const restarted = await registry.replaceGeneration(
      filesystemProofManifest.id,
      { type: 'event', event: 'document.opened' },
    );
    expect(restarted.activeGeneration).toBe(2);
    expect(restarted.capability).toEqual({ grant: null, request: null, restartRequired: false });
  });
  it('owns the full catalog, hydrates fail-closed, and enables without activation', async () => {
    const persistence = memoryStore();
    const renderer = rendererHost();
    const service = serviceHost();
    const registry = new PluginRegistry({
      catalog,
      stateStore: persistence.store,
      rendererHost: renderer,
      serviceHost: service,
      leaseId: () => 'lease:renderer-enable-idle',
    });

    await registry.hydrate();
    expect(registry.getSnapshots()).toEqual([
      expect.objectContaining({ id: rendererProofManifest.id, desiredEnabled: false, lifecycle: 'disabled' }),
      expect.objectContaining({ id: filesystemProofManifest.id, desiredEnabled: false, lifecycle: 'disabled' }),
    ]);

    const enabled = await registry.enable(rendererProofManifest.id);

    expect(enabled).toMatchObject({
      desiredEnabled: true,
      lifecycle: 'enabled-idle',
      activeGeneration: null,
      leaseCount: 0,
      rendererRegistrations: 0,
    });
    expect(renderer.opened).toHaveLength(0);
    expect(service.starts).toHaveLength(0);
    expect(persistence.read().plugins[filesystemProofManifest.id].desiredEnabled).toBe(false);
  });

  it('preserves service state when renderer intent changes because only main persists the full catalog', async () => {
    const initial = createDefaultLocalPluginState(catalog);
    initial.plugins[filesystemProofManifest.id].desiredEnabled = true;
    const persistence = memoryStore(initial);
    const registry = new PluginRegistry({
      catalog,
      stateStore: persistence.store,
      rendererHost: rendererHost(),
      serviceHost: serviceHost(),
    });

    await registry.hydrate();
    await registry.enable(rendererProofManifest.id);
    await registry.setSetting(rendererProofManifest.id, 'focusEnabled', false);

    expect(persistence.read()).toEqual({
      schemaVersion: 1,
      plugins: {
        [rendererProofManifest.id]: {
          desiredEnabled: true,
          settings: { focusEnabled: false },
        },
        [filesystemProofManifest.id]: {
          desiredEnabled: true,
          settings: {},
        },
      },
    });
  });

  it('activates only from an explicit declared trigger and coalesces simultaneous triggers', async () => {
    const activation = deferred<RendererLeaseMaterialization>();
    const renderer = rendererHost(() => activation.promise);
    const registry = new PluginRegistry({
      catalog,
      stateStore: memoryStore().store,
      rendererHost: renderer,
      serviceHost: serviceHost(),
      leaseId: () => 'lease:coalesced',
    });
    await registry.hydrate();
    await registry.enable(rendererProofManifest.id);

    expect(renderer.opened).toHaveLength(0);
    const startup = registry.triggerStartup();
    const event = registry.triggerEvent('editor.ready');
    await vi.waitFor(() => expect(renderer.opened).toHaveLength(1));
    expect(renderer.opened[0]).toMatchObject({
      pluginId: rendererProofManifest.id,
      leaseId: 'lease:coalesced',
      generation: 1,
    });

    activation.resolve({ leaseId: 'lease:coalesced', generation: 1, registrations: 5 });
    await Promise.all([startup, event]);

    expect(registry.getSnapshot(rendererProofManifest.id)).toMatchObject({
      lifecycle: 'active',
      activeGeneration: 1,
      leaseCount: 1,
      rendererRegistrations: 5,
    });
  });

  it('aborts a hung activation, closes its lease before persistence, and fences late completion', async () => {
    const order: string[] = [];
    const activation = deferred<RendererLeaseMaterialization>();
    let activationSignal: AbortSignal | null = null;
    const renderer = rendererHost((request) => {
      activationSignal = request.signal;
      order.push('activate');
      return activation.promise;
    });
    renderer.closeLease = async (leaseId) => {
      order.push(`close:${leaseId}`);
      renderer.closed.push(leaseId);
      return { leaseId, complete: true, failures: [], registrations: 0 };
    };
    const persistence = memoryStore();
    persistence.store.save = vi.fn(async (next) => {
      order.push(`save:${String(next.plugins[rendererProofManifest.id].desiredEnabled)}`);
      return { status: 'durable' as const, health: 'healthy' as const, state: cloneLocalPluginState(next) };
    });
    const registry = new PluginRegistry({
      catalog,
      stateStore: persistence.store,
      rendererHost: renderer,
      serviceHost: serviceHost(),
      leaseId: () => 'lease:hung',
      cleanupTimeoutMs: 50,
    });
    await registry.hydrate();
    await registry.enable(rendererProofManifest.id);
    order.splice(0);

    const triggering = registry.triggerStartup();
    await vi.waitFor(() => expect(order).toEqual(['activate']));
    const disabled = await registry.disable(rendererProofManifest.id);

    expect(activationSignal).not.toBeNull();
    expect((activationSignal as unknown as AbortSignal).aborted).toBe(true);
    expect(order).toEqual(['activate', 'close:lease:hung', 'save:false']);
    expect(disabled).toMatchObject({ desiredEnabled: false, lifecycle: 'disabled', activeGeneration: null });
    await expect(triggering).rejects.toThrow('PLUGIN_GENERATION_ABORTED');

    activation.resolve({ leaseId: 'lease:hung', generation: 1, registrations: 5 });
    await Promise.resolve();
    await Promise.resolve();
    expect(registry.getSnapshot(rendererProofManifest.id)).toMatchObject({
      lifecycle: 'disabled',
      activeGeneration: null,
      leaseCount: 0,
      rendererRegistrations: 0,
    });
  });

  it('makes command cancellation terminal even when work resolves after disable', async () => {
    const command = deferred<boolean>();
    const renderer = rendererHost();
    renderer.executeLeaseCommand = async (leaseId, commandId, signal) => {
      renderer.commands.push({ leaseId, commandId, signal });
      return command.promise;
    };
    const registry = new PluginRegistry({
      catalog,
      stateStore: memoryStore().store,
      rendererHost: renderer,
      serviceHost: serviceHost(),
      leaseId: () => 'lease:command',
    });
    await registry.hydrate();
    await registry.enable(rendererProofManifest.id);
    await registry.triggerStartup();

    const running = registry.executeCommand(rendererProofManifest.id, 'semantic-focus.toggle');
    await vi.waitFor(() => expect(renderer.commands).toHaveLength(1));
    await registry.disable(rendererProofManifest.id);

    expect(renderer.commands[0].signal.aborted).toBe(true);
    await expect(running).rejects.toThrow('PLUGIN_GENERATION_ABORTED');
    command.resolve(true);
    await Promise.resolve();
    expect(registry.getSnapshot(rendererProofManifest.id).lifecycle).toBe('disabled');
  });

  it('aborts a hung activation during shutdown and returns enabled plugins to idle', async () => {
    const activation = deferred<RendererLeaseMaterialization>();
    const renderer = rendererHost(() => activation.promise);
    const registry = new PluginRegistry({
      catalog,
      stateStore: memoryStore().store,
      rendererHost: renderer,
      serviceHost: serviceHost(),
      leaseId: () => 'lease:shutdown',
    });
    await registry.hydrate();
    await registry.enable(rendererProofManifest.id);

    const triggering = registry.triggerStartup();
    await vi.waitFor(() => expect(renderer.opened).toHaveLength(1));
    await registry.shutdown();

    expect(renderer.opened[0].signal.aborted).toBe(true);
    expect(renderer.closed).toEqual(['lease:shutdown']);
    expect(registry.getSnapshot(rendererProofManifest.id)).toMatchObject({
      desiredEnabled: true,
      lifecycle: 'enabled-idle',
      activeGeneration: null,
    });
    await expect(triggering).rejects.toThrow('PLUGIN_GENERATION_ABORTED');
  });

  it('bounds cleanup, persists disabled intent, and reports failure instead of false success', async () => {
    const renderer = rendererHost();
    renderer.closeLease = async () => new Promise<never>(() => undefined);
    const persistence = memoryStore();
    const registry = new PluginRegistry({
      catalog,
      stateStore: persistence.store,
      rendererHost: renderer,
      serviceHost: serviceHost(),
      leaseId: () => 'lease:cleanup-timeout',
      cleanupTimeoutMs: 10,
    });
    await registry.hydrate();
    await registry.enable(rendererProofManifest.id);
    await registry.triggerStartup();

    const started = Date.now();
    await expect(registry.disable(rendererProofManifest.id))
      .rejects.toThrow('PLUGIN_DISABLE_CLEANUP_FAILED');

    expect(Date.now() - started).toBeLessThan(500);
    expect(persistence.read().plugins[rendererProofManifest.id].desiredEnabled).toBe(false);
    expect(registry.getSnapshot(rendererProofManifest.id)).toMatchObject({
      desiredEnabled: false,
      lifecycle: 'failed',
      activeGeneration: null,
      rendererRegistrations: 0,
    });
  });

  it('fences every activation path synchronously while disable waits for generation cleanup', async () => {
    const close = deferred<{
      leaseId: string;
      complete: boolean;
      failures: string[];
      registrations: 0;
    }>();
    let leaseNumber = 0;
    const renderer = rendererHost();
    renderer.closeLease = async (leaseId) => {
      renderer.closed.push(leaseId);
      if (leaseId === 'lease:1') return close.promise;
      return { leaseId, complete: true, failures: [], registrations: 0 };
    };
    const registry = new PluginRegistry({
      catalog,
      stateStore: memoryStore().store,
      rendererHost: renderer,
      serviceHost: serviceHost(),
      leaseId: () => `lease:${String(++leaseNumber)}`,
    });
    await registry.hydrate();
    await registry.enable(rendererProofManifest.id);
    await registry.triggerStartup();

    const disabling = registry.disable(rendererProofManifest.id);
    await vi.waitFor(() => expect(renderer.closed).toEqual(['lease:1']));
    const attempts = [
      registry.triggerEvent('editor.ready'),
      registry.triggerHotkey('Mod+Shift+J'),
      registry.executeCommand(rendererProofManifest.id, 'semantic-focus.toggle'),
      registry.triggerStartup(),
      registry.replaceGeneration(rendererProofManifest.id, { type: 'event', event: 'editor.ready' }),
    ];
    await Promise.all(attempts);

    close.resolve({ leaseId: 'lease:1', complete: true, failures: [], registrations: 0 });
    await disabling;

    expect(renderer.opened.map((request) => request.leaseId)).toEqual(['lease:1']);
    expect(renderer.opened.some((request) => request.leaseId === 'lease:2')).toBe(false);
    expect(registry.getSnapshot(rendererProofManifest.id)).toMatchObject({
      desiredEnabled: false,
      lifecycle: 'disabled',
      activeGeneration: null,
      leaseCount: 0,
      rendererRegistrations: 0,
    });
  });

  it('retains cleanup ownership and retries the same lease until cleanup completes', async () => {
    const renderer = rendererHost();
    let closeAttempts = 0;
    renderer.closeLease = async (leaseId) => {
      renderer.closed.push(leaseId);
      closeAttempts += 1;
      return closeAttempts === 1
        ? {
          leaseId,
          complete: false,
          failures: [new Error(
            "EACCES: cleanup '/Users/private/secret.md' password=cleanup-child-secret",
          ) as unknown as string],
          registrations: 0,
        }
        : { leaseId, complete: true, failures: [], registrations: 0 };
    };
    const registry = new PluginRegistry({
      catalog,
      stateStore: memoryStore().store,
      rendererHost: renderer,
      serviceHost: serviceHost(),
      leaseId: () => 'lease:retry-cleanup',
    });
    await registry.hydrate();
    await registry.enable(rendererProofManifest.id);
    await registry.triggerStartup();

    await expect(registry.disable(rendererProofManifest.id))
      .rejects.toThrow('PLUGIN_DISABLE_CLEANUP_FAILED');
    expect(registry.getSnapshot(rendererProofManifest.id)).toMatchObject({
      desiredEnabled: false,
      lifecycle: 'failed',
      activeGeneration: null,
      leaseCount: 1,
      rendererRegistrations: 0,
    });
    expect(registry.getSnapshot(rendererProofManifest.id).lastFailure)
      .toBe('PLUGIN_DISABLE_CLEANUP_FAILED: PLUGIN_FAILED');
    expect(JSON.stringify(registry.getSnapshot(rendererProofManifest.id))).not.toMatch(
      /\/Users\/|secret|password|EACCES|cleanup-child-secret/,
    );

    await expect(registry.disable(rendererProofManifest.id)).resolves.toMatchObject({
      desiredEnabled: false,
      lifecycle: 'disabled',
      activeGeneration: null,
      leaseCount: 0,
    });
    expect(closeAttempts).toBe(2);
    expect(renderer.closed).toEqual(['lease:retry-cleanup', 'lease:retry-cleanup']);
  });

  it('retains timed-out cleanup ownership and retries the same lease on a second disable', async () => {
    const renderer = rendererHost();
    let closeAttempts = 0;
    renderer.closeLease = async (leaseId) => {
      closeAttempts += 1;
      if (closeAttempts === 1) return new Promise<never>(() => undefined);
      return { leaseId, complete: true, failures: [], registrations: 0 };
    };
    const registry = new PluginRegistry({
      catalog,
      stateStore: memoryStore().store,
      rendererHost: renderer,
      serviceHost: serviceHost(),
      leaseId: () => 'lease:retry-timeout',
      cleanupTimeoutMs: 5,
    });
    await registry.hydrate();
    await registry.enable(rendererProofManifest.id);
    await registry.triggerStartup();

    await expect(registry.disable(rendererProofManifest.id))
      .rejects.toThrow('PLUGIN_DISABLE_CLEANUP_FAILED');
    expect(registry.getSnapshot(rendererProofManifest.id).leaseCount).toBe(1);

    await expect(registry.disable(rendererProofManifest.id)).resolves.toMatchObject({
      lifecycle: 'disabled',
      leaseCount: 0,
    });
    expect(closeAttempts).toBe(2);
  });

  it('retries retained cleanup ownership during shutdown instead of taking a clean fast path', async () => {
    const renderer = rendererHost();
    let closeAttempts = 0;
    renderer.closeLease = async (leaseId) => {
      closeAttempts += 1;
      return closeAttempts === 1
        ? { leaseId, complete: false, failures: ['cleanup remained'], registrations: 0 }
        : { leaseId, complete: true, failures: [], registrations: 0 };
    };
    const registry = new PluginRegistry({
      catalog,
      stateStore: memoryStore().store,
      rendererHost: renderer,
      serviceHost: serviceHost(),
      leaseId: () => 'lease:retry-shutdown',
    });
    await registry.hydrate();
    await registry.enable(rendererProofManifest.id);
    await registry.triggerStartup();
    await expect(registry.disable(rendererProofManifest.id))
      .rejects.toThrow('PLUGIN_DISABLE_CLEANUP_FAILED');

    await expect(registry.shutdown()).resolves.toBeUndefined();

    expect(closeAttempts).toBe(2);
    expect(registry.getSnapshot(rendererProofManifest.id)).toMatchObject({
      desiredEnabled: false,
      lifecycle: 'disabled',
      leaseCount: 0,
    });
  });

  it('propagates typed renderer disposal cleanup failure and retains retry truth', async () => {
    const renderer = rendererHost();
    let closeAttempts = 0;
    renderer.closeLease = async (leaseId) => {
      closeAttempts += 1;
      return closeAttempts === 1
        ? {
          leaseId,
          complete: false,
          failures: ['PLUGIN_FAILED'],
          registrations: 0,
        }
        : { leaseId, complete: true, failures: [], registrations: 0 };
    };
    const registry = new PluginRegistry({
      catalog,
      stateStore: memoryStore().store,
      rendererHost: renderer,
      serviceHost: serviceHost(),
      leaseId: () => 'lease:renderer-disposed',
    });
    await registry.hydrate();
    await registry.enable(rendererProofManifest.id);
    await registry.triggerStartup();

    await expect(registry.rendererDisposed(
      rendererProofManifest.id,
      'lease:renderer-disposed',
      1,
    )).rejects.toMatchObject({ code: 'PLUGIN_RENDERER_DISPOSAL_CLEANUP_FAILED' });
    expect(registry.getSnapshot(rendererProofManifest.id)).toMatchObject({
      lifecycle: 'failed',
      activeGeneration: null,
      leaseCount: 1,
    });
    expect(registry.getSnapshot(rendererProofManifest.id).lastFailure).toContain('PLUGIN_FAILED');
    expect(registry.getSnapshot(rendererProofManifest.id).lastFailure).not.toContain('/Users/private/secret.md');
    expect(registry.getSnapshot(rendererProofManifest.id).lastFailure).not.toContain('token=password');

    await expect(registry.rendererDisposed(
      rendererProofManifest.id,
      'lease:renderer-disposed',
      1,
    )).resolves.toBeUndefined();
    expect(closeAttempts).toBe(2);
    expect(registry.getSnapshot(rendererProofManifest.id)).toMatchObject({
      lifecycle: 'failed',
      activeGeneration: null,
      leaseCount: 0,
    });
  });

  it('serializes duplicate renderer disposal and converges idempotently', async () => {
    const renderer = rendererHost();
    const closing = deferred<void>();
    const release = deferred<void>();
    let closeAttempts = 0;
    renderer.closeLease = async (leaseId) => {
      closeAttempts += 1;
      closing.resolve();
      await release.promise;
      return { leaseId, complete: true, failures: [], registrations: 0 };
    };
    const registry = new PluginRegistry({
      catalog,
      stateStore: memoryStore().store,
      rendererHost: renderer,
      serviceHost: serviceHost(),
      leaseId: () => 'lease:renderer-concurrent-disposal',
    });
    await registry.hydrate();
    await registry.enable(rendererProofManifest.id);
    await registry.triggerStartup();

    const first = registry.rendererDisposed(rendererProofManifest.id, 'lease:renderer-concurrent-disposal', 1);
    await closing.promise;
    const duplicate = registry.rendererDisposed(rendererProofManifest.id, 'lease:renderer-concurrent-disposal', 1);
    release.resolve();

    await expect(Promise.all([first, duplicate])).resolves.toEqual([undefined, undefined]);
    expect(closeAttempts).toBe(1);
    expect(registry.getSnapshot(rendererProofManifest.id)).toMatchObject({
      lifecycle: 'failed',
      leaseCount: 0,
    });
  });

  it('returns a rejected shutdown promise before successful hydration', async () => {
    const registry = new PluginRegistry({
      catalog,
      stateStore: memoryStore().store,
      rendererHost: rendererHost(),
      serviceHost: serviceHost(),
    });
    const shutdown = registry.shutdown();
    await expect(shutdown).rejects.toThrow('PLUGIN_NOT_HYDRATED');
  });

  it('persists an active setting before applying the adopted value to the live lease', async () => {
    const order: string[] = [];
    const persistence = memoryStore();
    persistence.store.save = vi.fn(async (next) => {
      order.push(`persist:${String(next.plugins[rendererProofManifest.id].settings.focusEnabled)}`);
      return {
        status: 'durable' as const,
        health: 'healthy' as const,
        state: cloneLocalPluginState(next),
      };
    });
    const renderer = rendererHost();
    renderer.updateLeaseSetting = async (leaseId, key, value, signal) => {
      order.push(`live:${leaseId}:${key}:${String(value)}`);
      renderer.settingUpdates.push({ leaseId, key, value, signal });
    };
    const registry = new PluginRegistry({
      catalog,
      stateStore: persistence.store,
      rendererHost: renderer,
      serviceHost: serviceHost(),
      leaseId: () => 'lease:live-setting',
    });
    await registry.hydrate();
    await registry.enable(rendererProofManifest.id);
    await registry.triggerStartup();
    order.splice(0);

    await registry.setSetting(rendererProofManifest.id, 'focusEnabled', false);

    expect(order).toEqual([
      'persist:false',
      'live:lease:live-setting:focusEnabled:false',
    ]);
    expect(renderer.settingUpdates).toHaveLength(1);
    expect(registry.getSnapshot(rendererProofManifest.id)).toMatchObject({
      lifecycle: 'active',
      settings: { focusEnabled: false },
    });
  });

  it('persists inactive settings without calling the renderer', async () => {
    const renderer = rendererHost();
    const registry = new PluginRegistry({
      catalog,
      stateStore: memoryStore().store,
      rendererHost: renderer,
      serviceHost: serviceHost(),
    });
    await registry.hydrate();
    await registry.enable(rendererProofManifest.id);

    await registry.setSetting(rendererProofManifest.id, 'focusEnabled', false);

    expect(renderer.settingUpdates).toHaveLength(0);
    expect(registry.getSnapshot(rendererProofManifest.id)).toMatchObject({
      lifecycle: 'enabled-idle',
      settings: { focusEnabled: false },
    });
  });

  it('keeps durable setting truth and publishes failure when live application fails', async () => {
    const persistence = memoryStore();
    const renderer = rendererHost();
    renderer.updateLeaseSetting = async () => {
      throw new Error('password=live-apply-secret');
    };
    const registry = new PluginRegistry({
      catalog,
      stateStore: persistence.store,
      rendererHost: renderer,
      serviceHost: serviceHost(),
      leaseId: () => 'lease:setting-failure',
    });
    await registry.hydrate();
    await registry.enable(rendererProofManifest.id);
    await registry.triggerStartup();

    await expect(registry.setSetting(rendererProofManifest.id, 'focusEnabled', false))
      .rejects.toThrow('live-apply-secret');

    expect(persistence.read().plugins[rendererProofManifest.id].settings.focusEnabled).toBe(false);
    expect(registry.getSnapshot(rendererProofManifest.id)).toMatchObject({
      lifecycle: 'failed',
      settings: { focusEnabled: false },
      leaseCount: 1,
    });
    expect(registry.getSnapshot(rendererProofManifest.id).lastFailure).toBe('PLUGIN_FAILED');
    expect(registry.getSnapshot(rendererProofManifest.id).lastFailure).not.toContain('live-apply-secret');
  });

  it('applies the exact adopted setting after a published readback mismatch', async () => {
    const persistence = memoryStore();
    persistence.store.save = vi.fn(async (next) => {
      const adopted = cloneLocalPluginState(next);
      adopted.plugins[rendererProofManifest.id].settings.focusEnabled = true;
      return {
        status: 'published-uncertain' as const,
        health: 'indeterminate' as const,
        state: adopted,
        detail: 'readback-mismatch' as const,
      };
    });
    const renderer = rendererHost();
    const registry = new PluginRegistry({
      catalog,
      stateStore: persistence.store,
      rendererHost: renderer,
      serviceHost: serviceHost(),
      leaseId: () => 'lease:setting-adoption',
    });
    await registry.hydrate();
    await registry.enable(rendererProofManifest.id);
    await registry.triggerStartup();

    await registry.setSetting(rendererProofManifest.id, 'focusEnabled', false);

    expect(renderer.settingUpdates.at(-1)).toMatchObject({
      leaseId: 'lease:setting-adoption',
      key: 'focusEnabled',
      value: true,
    });
    expect(registry.getSnapshot(rendererProofManifest.id)).toMatchObject({
      settings: { focusEnabled: true },
      persistenceHealth: 'indeterminate',
    });
  });

  it('fences same-plugin authority when a setting readback adopts desired false and retains cleanup retry truth', async () => {
    const persistence = memoryStore();
    let reconcileSettingWrite = false;
    persistence.store.save = vi.fn(async (next) => {
      const adopted = cloneLocalPluginState(next);
      if (reconcileSettingWrite) adopted.plugins[rendererProofManifest.id].desiredEnabled = false;
      return reconcileSettingWrite
        ? {
          status: 'published-uncertain' as const,
          health: 'indeterminate' as const,
          state: adopted,
          detail: 'readback-mismatch' as const,
        }
        : { status: 'durable' as const, health: 'healthy' as const, state: adopted };
    });
    const renderer = rendererHost();
    let closeAttempts = 0;
    renderer.closeLease = async (leaseId) => {
      renderer.closed.push(leaseId);
      closeAttempts += 1;
      return closeAttempts === 1
        ? {
          leaseId,
          complete: false,
          failures: ['password=reconciliation-cleanup-secret'],
          registrations: 0,
        }
        : { leaseId, complete: true, failures: [], registrations: 0 };
    };
    const registry = new PluginRegistry({
      catalog,
      stateStore: persistence.store,
      rendererHost: renderer,
      serviceHost: serviceHost(),
      leaseId: () => 'lease:same-plugin-reconciliation',
    });
    await registry.hydrate();
    await registry.enable(rendererProofManifest.id);
    await registry.triggerStartup();
    reconcileSettingWrite = true;

    await expect(registry.setSetting(rendererProofManifest.id, 'focusEnabled', false))
      .rejects.toMatchObject({ code: 'PLUGIN_PERSISTED_RECONCILIATION_CLEANUP_FAILED' });

    expect(renderer.settingUpdates).toHaveLength(0);
    expect(renderer.closed).toEqual(['lease:same-plugin-reconciliation']);
    expect(registry.getSnapshot(rendererProofManifest.id)).toMatchObject({
      desiredEnabled: false,
      lifecycle: 'failed',
      settings: { focusEnabled: false },
      activeGeneration: null,
      leaseCount: 1,
      rendererRegistrations: 0,
      persistenceHealth: 'indeterminate',
    });
    expect(registry.getSnapshot(rendererProofManifest.id).lastFailure)
      .toBe('PLUGIN_PERSISTED_RECONCILIATION_CLEANUP_FAILED: PLUGIN_FAILED');
    expect(registry.getSnapshot(rendererProofManifest.id).lastFailure)
      .not.toContain('reconciliation-cleanup-secret');

    reconcileSettingWrite = false;
    await expect(registry.disable(rendererProofManifest.id)).resolves.toMatchObject({
      desiredEnabled: false,
      lifecycle: 'disabled',
      activeGeneration: null,
      leaseCount: 0,
      rendererRegistrations: 0,
    });
    expect(closeAttempts).toBe(2);
  });

  it('reconciles an active cross-plugin service disabled by another plugin readback mismatch', async () => {
    const persistence = memoryStore();
    let reconcileSettingWrite = false;
    persistence.store.save = vi.fn(async (next) => {
      const adopted = cloneLocalPluginState(next);
      if (reconcileSettingWrite) adopted.plugins[filesystemProofManifest.id].desiredEnabled = false;
      return reconcileSettingWrite
        ? {
          status: 'published-uncertain' as const,
          health: 'indeterminate' as const,
          state: adopted,
          detail: 'readback-mismatch' as const,
        }
        : { status: 'durable' as const, health: 'healthy' as const, state: adopted };
    });
    const service = serviceHost();
    const registry = new PluginRegistry({
      catalog,
      stateStore: persistence.store,
      rendererHost: rendererHost(),
      serviceHost: service,
      leaseId: () => 'lease:cross-plugin-reconciliation',
    });
    await registry.hydrate();
    await registry.enable(rendererProofManifest.id);
    await registry.enable(filesystemProofManifest.id);
    await registry.triggerEvent('document.opened');
    expect(registry.getSnapshot(filesystemProofManifest.id)).toMatchObject({
      desiredEnabled: true,
      lifecycle: 'active',
      activeGeneration: 1,
    });
    reconcileSettingWrite = true;

    await expect(registry.setSetting(rendererProofManifest.id, 'focusEnabled', false))
      .resolves.toMatchObject({ settings: { focusEnabled: false } });

    expect(service.stops).toBe(1);
    expect(registry.getSnapshot(filesystemProofManifest.id)).toMatchObject({
      desiredEnabled: false,
      lifecycle: 'disabled',
      activeGeneration: null,
      leaseCount: 0,
      rendererRegistrations: 0,
      persistenceHealth: 'indeterminate',
    });
  });

  it('publishes failed truth when an active live setting application is aborted', async () => {
    const renderer = rendererHost();
    renderer.updateLeaseSetting = async () => {
      throw new Error('PLUGIN_GENERATION_ABORTED');
    };
    const registry = new PluginRegistry({
      catalog,
      stateStore: memoryStore().store,
      rendererHost: renderer,
      serviceHost: serviceHost(),
      leaseId: () => 'lease:setting-aborted',
    });
    await registry.hydrate();
    await registry.enable(rendererProofManifest.id);
    await registry.triggerStartup();

    await expect(registry.setSetting(rendererProofManifest.id, 'focusEnabled', false))
      .rejects.toThrow('PLUGIN_GENERATION_ABORTED');
    expect(registry.getSnapshot(rendererProofManifest.id)).toMatchObject({
      lifecycle: 'failed',
      settings: { focusEnabled: false },
      lastFailure: 'PLUGIN_GENERATION_ABORTED',
    });
  });

  it('adopts actual desired state when a published readback mismatches enable and disable', async () => {
    const persistence = memoryStore();
    let requestedDesired = false;
    persistence.store.save = vi.fn(async (next) => {
      requestedDesired = next.plugins[rendererProofManifest.id].desiredEnabled;
      const adopted = cloneLocalPluginState(next);
      adopted.plugins[rendererProofManifest.id].desiredEnabled = !requestedDesired;
      return {
        status: 'published-uncertain' as const,
        health: 'indeterminate' as const,
        state: adopted,
        detail: 'readback-mismatch' as const,
      };
    });
    const registry = new PluginRegistry({
      catalog,
      stateStore: persistence.store,
      rendererHost: rendererHost(),
      serviceHost: serviceHost(),
    });
    await registry.hydrate();

    await expect(registry.enable(rendererProofManifest.id)).resolves.toMatchObject({
      desiredEnabled: false,
      lifecycle: 'failed',
      persistenceHealth: 'indeterminate',
    });
    expect(registry.getSnapshot(rendererProofManifest.id).lastFailure).toContain(
      'PLUGIN_PERSISTED_INTENT_MISMATCH',
    );

    const enabledState = createDefaultLocalPluginState(catalog);
    enabledState.plugins[rendererProofManifest.id].desiredEnabled = true;
    const disablePersistence = memoryStore(enabledState);
    disablePersistence.store.save = persistence.store.save;
    const disablingRegistry = new PluginRegistry({
      catalog,
      stateStore: disablePersistence.store,
      rendererHost: rendererHost(),
      serviceHost: serviceHost(),
    });
    await disablingRegistry.hydrate();

    await expect(disablingRegistry.disable(rendererProofManifest.id)).resolves.toMatchObject({
      desiredEnabled: true,
      lifecycle: 'failed',
      persistenceHealth: 'indeterminate',
    });
    expect(disablingRegistry.getSnapshot(rendererProofManifest.id).lifecycle).not.toBe('disabled');
  });

  it('isolates throwing publish observers and records bounded diagnostics', async () => {
    const publish = vi.fn(() => { throw new Error('password=observer-secret'); });
    const registry = new PluginRegistry({
      catalog,
      stateStore: memoryStore().store,
      rendererHost: rendererHost(),
      serviceHost: serviceHost(),
      publish,
    });

    await expect(registry.hydrate()).resolves.toBeUndefined();
    await expect(registry.enable(rendererProofManifest.id)).resolves.toMatchObject({
      lifecycle: 'enabled-idle',
    });
    await expect(registry.disable(rendererProofManifest.id)).resolves.toMatchObject({
      lifecycle: 'disabled',
    });
    expect(publish).toHaveBeenCalled();
    expect(registry.getDiagnostics(rendererProofManifest.id)).toSatisfy((diagnostics: readonly string[]) =>
      diagnostics.length > 0 && diagnostics.length <= 8);
    expect(registry.getDiagnostics(rendererProofManifest.id).at(-1))
      .toBe('PLUGIN_PUBLISH_OBSERVER_FAILED: PLUGIN_FAILED');
    expect(registry.getDiagnostics(rendererProofManifest.id).at(-1)).not.toContain('observer-secret');
  });

  it('publishes manifest semver rather than the manifest schema version', async () => {
    const registry = new PluginRegistry({
      catalog,
      stateStore: memoryStore().store,
      rendererHost: rendererHost(),
      serviceHost: serviceHost(),
    });
    await registry.hydrate();

    expect(registry.getSnapshot(rendererProofManifest.id).manifestVersion)
      .toBe(rendererProofManifest.version);
  });

  it('adopts a published-uncertain persistence outcome instead of keeping runtime old', async () => {
    const persistence = memoryStore();
    persistence.store.save = vi.fn(async (next) => ({
      status: 'published-uncertain' as const,
      health: 'degraded' as const,
      state: cloneLocalPluginState(next),
      detail: 'directory-sync-failed' as const,
    }));
    const registry = new PluginRegistry({
      catalog,
      stateStore: persistence.store,
      rendererHost: rendererHost(),
      serviceHost: serviceHost(),
    });
    await registry.hydrate();

    await expect(registry.enable(rendererProofManifest.id)).resolves.toMatchObject({
      desiredEnabled: true,
      lifecycle: 'enabled-idle',
      persistenceHealth: 'degraded',
    });
  });
});
