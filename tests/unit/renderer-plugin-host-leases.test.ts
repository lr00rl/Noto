import { describe, expect, it, vi } from 'vitest';
import {
  RendererPluginHost,
  type RendererPluginContribution,
  type RendererPluginContributionContext,
} from '../../src/renderer/plugins/RendererPluginHost';
import type { RendererLeaseRequest } from '../../src/shared/plugins/lifecycle';
import { validatePluginManifest } from '../../src/shared/plugins/manifest';
import { rendererProofManifest } from '../../src/shared/plugins/proof-manifests';

/**
 * The parts of the editor port these tests do not exercise. Only semantic focus
 * matters here; the document methods just have to exist.
 */
const portStub = {
  getMarkdown: () => '',
  replaceMarkdown: () => false,
};

const adapter = Object.freeze({
  ...portStub,
  setSemanticFocus() {},
});

function request(leaseId: string, generation: number): RendererLeaseRequest {
  return {
    pluginId: rendererProofManifest.id,
    leaseId,
    generation,
    settings: { focusEnabled: true },
    signal: new AbortController().signal,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe('renderer lease materialization', () => {
  it('fences retained contexts after activation failure, retry, replacement, disable, and shutdown', async () => {
    const contexts: RendererPluginContributionContext[] = [];
    let attempts = 0;
    const plugin: RendererPluginContribution = {
      activate: (context) => {
        contexts.push(context);
        context.registerCommand(rendererProofManifest.commands[0].id, () => undefined);
        attempts += 1;
        if (attempts === 1) throw new Error('injected activation failure');
      },
    };
    const host = new RendererPluginHost(() => undefined, { plugin });
    host.attachAdapter(adapter);

    await expect(host.openLease(request('lease:failed', 1))).rejects.toThrow('injected activation failure');
    expect(() => contexts[0].registerUiExtension(rendererProofManifest.uiExtensions[0]))
      .toThrow('PLUGIN_LEASE_CLOSED');
    expect(host.getSnapshot().registrations).toBe(0);

    await expect(host.openLease(request('lease:retry', 2))).resolves.toMatchObject({ registrations: 1 });
    expect(() => contexts[0].registerUiExtension(rendererProofManifest.uiExtensions[0]))
      .toThrow('PLUGIN_LEASE_CLOSED');

    await expect(host.openLease(request('lease:replacement', 3))).resolves.toMatchObject({ registrations: 1 });
    expect(() => contexts[1].registerUiExtension(rendererProofManifest.uiExtensions[0]))
      .toThrow('PLUGIN_LEASE_CLOSED');

    await host.closeLease('lease:replacement');
    expect(() => contexts[2].registerUiExtension(rendererProofManifest.uiExtensions[0]))
      .toThrow('PLUGIN_LEASE_CLOSED');

    await host.openLease(request('lease:shutdown', 4));
    await host.closeLease('lease:shutdown');
    expect(() => contexts[3].registerUiExtension(rendererProofManifest.uiExtensions[0]))
      .toThrow('PLUGIN_LEASE_CLOSED');

    await host.openLease(request('lease:renderer-disposal', 5));
    await host.disposeRenderer();
    expect(() => contexts[4].registerUiExtension(rendererProofManifest.uiExtensions[0]))
      .toThrow('PLUGIN_LEASE_CLOSED');
    expect(host.getSnapshot().registrations).toBe(0);
  });

  it('requires editor.decorate at registration time even for a structurally valid manifest', async () => {
    const manifestWithoutCapability = {
      ...rendererProofManifest,
      capabilities: [],
    };
    expect(validatePluginManifest(manifestWithoutCapability)).toBe(true);
    const plugin: RendererPluginContribution = {
      activate: (context) => {
        context.registerEditorExtension(rendererProofManifest.editorExtensions[0]);
      },
    };
    const host = new RendererPluginHost(() => undefined, {
      manifest: manifestWithoutCapability,
      plugin,
    });
    host.attachAdapter(adapter);

    await expect(host.openLease(request('lease:no-capability', 1)))
      .rejects.toThrow('PLUGIN_CAPABILITY_DENIED: editor.decorate');
    expect(host.getSnapshot()).toMatchObject({ lifecycle: 'failed', registrations: 0 });
  });

  it('denies a zero-capability plugin that calls a privileged editor port directly', async () => {
    const effects: boolean[] = [];
    const manifestWithoutCapability = {
      ...rendererProofManifest,
      capabilities: [],
    };
    const plugin: RendererPluginContribution = {
      activate: (context) => {
        context.port.setSemanticFocus(true);
      },
    };
    const host = new RendererPluginHost(() => undefined, {
      manifest: manifestWithoutCapability,
      plugin,
    });
    host.attachAdapter({
      ...portStub,
      setSemanticFocus(enabled) { effects.push(enabled); },
    });

    await expect(host.openLease(request('lease:no-port-capability', 1)))
      .rejects.toThrow('PLUGIN_CAPABILITY_DENIED: editor.decorate');
    expect(effects).toEqual([]);
    expect(host.getSnapshot()).toMatchObject({
      lifecycle: 'failed',
      registrations: 0,
      failureDetail: 'PLUGIN_CAPABILITY_DENIED: editor.decorate',
    });
  });

  it('applies main-owned live settings only to the current lease and generation signal', async () => {
    const values: boolean[] = [];
    const plugin: RendererPluginContribution = {
      activate: (context) => {
        context.registerSetting('focusEnabled', true, (value) => { values.push(value); });
      },
    };
    const host = new RendererPluginHost(() => undefined, { plugin });
    host.attachAdapter(adapter);
    const first = request('lease:setting-first', 1);
    await host.openLease(first);

    await expect(host.updateLeaseSetting(
      first.leaseId,
      'focusEnabled',
      false,
      first.signal,
    )).resolves.toBeUndefined();
    expect(values).toEqual([true, false]);

    await expect(host.updateLeaseSetting(
      first.leaseId,
      'focusEnabled',
      true,
      new AbortController().signal,
    )).rejects.toThrow('PLUGIN_GENERATION_STALE');

    const second = request('lease:setting-second', 2);
    await host.openLease(second);
    await expect(host.updateLeaseSetting(
      first.leaseId,
      'focusEnabled',
      true,
      first.signal,
    )).rejects.toThrow('PLUGIN_LEASE_CLOSED');
  });

  it('attempts every disposer, retries only failures, and keeps registrations fenced', async () => {
    const calls: string[] = [];
    let retained!: RendererPluginContributionContext;
    let firstAttempts = 0;
    const plugin: RendererPluginContribution = {
      activate: (context) => {
        retained = context;
        context.registerCommand(rendererProofManifest.commands[0].id, () => undefined);
        context.registerDisposer(() => {
          firstAttempts += 1;
          calls.push(`first:${firstAttempts}`);
          if (firstAttempts === 1) throw new Error('password=cleanup-secret');
        });
        context.registerDisposer(() => { calls.push('second'); });
      },
    };
    const host = new RendererPluginHost(() => undefined, { plugin });
    host.attachAdapter(adapter);
    await host.openLease(request('lease:cleanup', 1));

    const first = await host.closeLease('lease:cleanup');
    expect(first).toMatchObject({ complete: false, registrations: 0 });
    expect(first.failures).toHaveLength(1);
    expect(first.failures[0]).toContain('[REDACTED]');
    expect(first.failures[0]).not.toContain('cleanup-secret');
    expect(calls).toEqual(['second', 'first:1']);
    expect(() => retained.registerUiExtension(rendererProofManifest.uiExtensions[0]))
      .toThrow('PLUGIN_LEASE_CLOSED');

    await expect(host.closeLease('lease:cleanup')).resolves.toMatchObject({
      complete: true,
      failures: [],
      registrations: 0,
    });
    expect(calls).toEqual(['second', 'first:1', 'first:2']);

    await host.closeLease('lease:cleanup');
    expect(calls).toEqual(['second', 'first:1', 'first:2']);
  });
});

describe('renderer publish observer isolation', () => {
  it('keeps successful open independent and records at most eight sanitized diagnostics', async () => {
    const publish = vi.fn(() => { throw new Error('password=observer-open-secret'); });
    const plugin: RendererPluginContribution = {
      activate: (context) => {
        for (let index = 0; index < 12; index += 1) context.onCommand();
      },
    };
    const host = new RendererPluginHost(publish, { plugin });
    host.attachAdapter(adapter);

    await expect(host.openLease(request('lease:observer-open', 1))).resolves.toMatchObject({
      leaseId: 'lease:observer-open',
      generation: 1,
    });

    const diagnostics = host.getDiagnostics();
    expect(diagnostics).toHaveLength(8);
    expect(Object.isFrozen(diagnostics)).toBe(true);
    expect(diagnostics.every((detail) => detail.includes('[REDACTED]'))).toBe(true);
    expect(diagnostics.join(' ')).not.toContain('observer-open-secret');
  });

  it('keeps close outcome independent from a throwing observer', async () => {
    const host = new RendererPluginHost(
      () => { throw new Error('secret=observer-close-secret'); },
      { plugin: { activate: () => undefined } },
    );
    host.attachAdapter(adapter);
    await host.openLease(request('lease:observer-close', 1));

    await expect(host.closeLease('lease:observer-close')).resolves.toMatchObject({
      complete: true,
      registrations: 0,
    });
    expect(host.getSnapshot().lifecycle).toBe('inactive');
  });

  it('preserves the activation failure and its cleanup outcome when observation throws', async () => {
    const host = new RendererPluginHost(
      () => { throw new Error('authorization=observer-activation-secret'); },
      { plugin: { activate: () => { throw new Error('original activation failure'); } } },
    );
    host.attachAdapter(adapter);

    await expect(host.openLease(request('lease:observer-activation-failure', 1)))
      .rejects.toThrow('original activation failure');
    expect(host.getSnapshot()).toMatchObject({
      lifecycle: 'failed',
      failureDetail: 'original activation failure',
      registrations: 0,
    });
  });

  it('keeps late disposer cleanup independent from a throwing observer', async () => {
    const activation = deferred<() => Promise<void>>();
    const controller = new AbortController();
    const host = new RendererPluginHost(
      () => { throw new Error('api_key=observer-late-secret'); },
      { plugin: { activate: () => activation.promise } },
    );
    host.attachAdapter(adapter);

    const opening = host.openLease({
      ...request('lease:observer-late', 1),
      signal: controller.signal,
    });
    controller.abort();
    await expect(opening).rejects.toThrow('PLUGIN_GENERATION_ABORTED');

    activation.resolve(async () => { throw new Error('late disposer failure'); });
    await vi.waitFor(() => expect(host.getSnapshot()).toMatchObject({
      lifecycle: 'failed',
      failureDetail: 'late disposer failure',
      registrations: 0,
    }));
  });

  it('keeps renderer disposal outcome independent from a throwing observer', async () => {
    const host = new RendererPluginHost(
      () => { throw new Error('Bearer observer-disposal-secret'); },
      { plugin: { activate: () => undefined } },
    );
    host.attachAdapter(adapter);
    await host.openLease(request('lease:observer-disposal', 1));

    await expect(host.disposeRenderer()).resolves.toBeUndefined();
    expect(host.getSnapshot()).toMatchObject({ lifecycle: 'inactive', registrations: 0 });
  });
});
