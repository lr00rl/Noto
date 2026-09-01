import { access, readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const source = (relative: string) => readFile(new URL(relative, import.meta.url), 'utf8');

describe('G005 production lifecycle cutover', () => {
  it('composes the full main-owned lifecycle and does not start the service eagerly', async () => {
    const main = await source('../../src/main/main.ts');

    expect(main).toContain("from './plugins/local-plugin-state-store';");
    expect(main).toContain("from './plugins/plugin-registry';");
    expect(main).toContain("from './plugins/renderer-lease-bridge';");
    expect(main).toContain("from './plugins/bundled-plugin-discovery';");
    expect(main).toContain('await discoverBundledPluginCatalog(pluginResourceRoot);');
    expect(main).toContain("new LocalPluginStateStore(");
    expect(main).toContain('new RendererLeaseBridge(');
    expect(main).toContain('new PluginRegistry(');
    expect(main).toContain('catalog: pluginCatalog');
    expect(main).toContain('initialDiscoveryFailure: pluginDiscoveryFailure');
    expect(main).not.toContain('bundledPluginCatalog,\n  );');
    expect(main).toContain('await pluginRegistry.hydrate();');
    expect(main).not.toContain('await serviceHost.start();');
    expect(main).toContain('.finally(() => {');
    expect(main).toContain('rendererLeaseBridge.rendererDisposed();');
    expect(main).toContain('app.quit();');
  });

  it('gates service requests and test controls through registry lifecycle truth', async () => {
    const handlers = await source('../../src/main/ipc/register-handlers.ts');
    const serviceHandler = handlers.slice(
      handlers.indexOf('IPC_CHANNELS.service'),
      handlers.indexOf('IPC_CHANNELS.diagnostics'),
    );
    expect(handlers).toContain('pluginRegistry: PluginRegistry');
    // Service work goes through the registry, which owns generation and
    // capability truth, never straight to the service host.
    expect(serviceHandler).toContain('pluginRegistry.performServiceOperation(request)');
    expect(serviceHandler).not.toContain('serviceHost.request');
    expect(handlers).not.toContain('serviceHost.restart()');
    expect(handlers).not.toContain('serviceHost.stop()');
  });

  it('routes renderer plugin controls through authoritative preload lifecycle methods', async () => {
    const [app, pluginCenter] = await Promise.all([
      source('../../src/renderer/App.tsx'),
      source('../../src/renderer/plugins/PluginCenter.tsx'),
    ]);

    expect(app).toContain('window.notoDesktop.plugins.getSnapshots(');
    expect(app).toContain('window.notoDesktop.plugins.executeCommand(');
    expect(app).toContain('window.notoDesktop.plugins.triggerHotkey(');
    expect(app).toContain('<PluginCenter api={window.notoDesktop} snapshots={pluginSnapshots}');
    expect(pluginCenter).toContain('api.plugins.enable(');
    expect(pluginCenter).toContain('api.plugins.disable(');
    expect(pluginCenter).toContain('api.plugins.setSetting(');
    expect(pluginCenter).toContain('api.plugins.replaceGeneration(');
    expect(pluginCenter).not.toMatch(/setPluginSnapshots|reply\.value\.snapshots/);
    expect(app).not.toMatch(/pluginHostRef\.current\?\.(execute|executeHotkey|setSetting|retry|exerciseActivationFailure)/);
    expect(app).not.toContain('pluginActiveRef');
    expect(app).not.toContain('deactivatePluginHost');
    // One shell, so there is no second renderer entry point to keep in sync.
    await expect(access(new URL('../../src/renderer/FileTruthApp.tsx', import.meta.url))).rejects.toThrow();
  });

  it('exposes only a frozen validated plugin namespace and renderer transport path', async () => {
    const preload = await source('../../src/preload/preload.ts');

    expect(preload).toContain('const pluginsApi: NotoPluginsApi = Object.freeze({');
    expect(preload).toContain('plugins: pluginsApi');
    expect(preload).toContain('isPluginLifecycleRequest');
    expect(preload).toContain('isPluginLifecycleResult');
    expect(preload).toContain('isPluginSnapshotEvent');
    expect(preload).toContain('isRendererTransportRequest');
    expect(preload).toContain('isRendererTransportAck');
    expect(preload).toContain('isRendererReadyMessage');
    expect(preload).toContain('({ ...request, action })');
    expect(preload).not.toMatch(/send\([^,]+,\s*channel|invoke\([^,]+,\s*channel/);
  });
});
