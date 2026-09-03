import path from 'node:path';
import { statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { app, BrowserWindow } from 'electron';
import { FileTruthStoreV1 } from './file-truth/v1/file-truth-store';
import { registerFileTruthHandlers } from './file-truth/v1/register-file-truth-handlers';
import { registerIpcHandlers } from './ipc/register-handlers';
import { createLogger } from './logger';
import { CapabilityBroker } from './plugins/capability-broker';
import { LocalPluginStateStore } from './plugins/local-plugin-state-store';
import { PluginRegistry, bundledPluginCatalog } from './plugins/plugin-registry';
import {
  bundledPluginResourceRoot,
  discoverBundledPluginCatalog,
} from './plugins/bundled-plugin-discovery';
import { RendererLeaseBridge } from './plugins/renderer-lease-bridge';
import { ServiceHost } from './plugins/service-host';
import { ExperimentalPluginRuntimeHost } from './plugins/experimental-plugin-runtime-host';
import { installNotoProtocol, isAllowedRendererUrl, registerNotoScheme } from './protocol/register-app-protocol';
import { IPC_CHANNELS } from '../shared/ipc/contracts';
import type { PluginCatalog } from '../shared/plugins/catalog';
import { PLUGIN_LIFECYCLE_VERSION } from '../shared/plugins/lifecycle';
import { createEditorWindow, type RendererConsoleState } from './windows/create-editor-window';
import { RecentFiles } from './workspace/recent-files';
import { SettingsStore } from './workspace/settings-store';
import { registerSettingsHandlers } from './workspace/register-settings-handlers';
import { WorkspaceSession } from './workspace/session';
import { installApplicationMenu } from './workspace/menu';
import { registerWorkspaceHandlers } from './workspace/register-workspace-handlers';
import { registerAssetHandlers } from './workspace/register-asset-handlers';

registerNotoScheme();

const argumentValue = (name: string): string | null => {
  const prefix = `--${name}=`;
  const argument = process.argv.find((value) => value.startsWith(prefix));
  return argument ? argument.slice(prefix.length) : null;
};

const explicitUserData = argumentValue('user-data-dir');
if (explicitUserData) app.setPath('userData', path.resolve(explicitUserData));

/**
 * A document named on the command line, from a file association, or by the
 * `open-file` event. This is a convenience, not the only way in: the
 * application menu opens documents without any of it.
 */
const markdownArgument = (argv: readonly string[]): string | null =>
  argv.find((value) => !value.startsWith('-') && /\.(md|markdown|mdown|mkd|txt)$/i.test(value)) ?? null;

const isDirectory = (candidate: string): boolean => {
  try {
    return statSync(candidate).isDirectory();
  } catch {
    return false;
  }
};

/**
 * A folder named on the command line, as `noto ~/notes`.
 *
 * Resolved against the working directory, since that is what a shell means
 * by a relative path. In development the first argument is the app itself,
 * which is a directory, so the scan starts after it there.
 */
const folderArgument = (argv: readonly string[]): string | null => {
  for (const value of argv) {
    if (value.startsWith('-')) continue;
    const candidate = path.resolve(value);
    if (isDirectory(candidate)) return candidate;
  }
  return null;
};

const launchArguments = app.isPackaged ? process.argv.slice(1) : process.argv.slice(2);
const openArgument = argumentValue('open');
let pendingOpenFolder: string | null = openArgument && isDirectory(openArgument)
  ? path.resolve(openArgument)
  : folderArgument(launchArguments);
let pendingOpenPath: string | null = openArgument && !isDirectory(openArgument)
  ? openArgument
  : markdownArgument(launchArguments);

const evidenceDirectory = path.resolve(
  process.env.NTO_EVIDENCE_DIR ?? path.join(app.getPath('userData'), 'evidence'),
);
const logger = createLogger(evidenceDirectory);
const rendererConsole: RendererConsoleState = { errors: 0, warnings: 0 };
let editorWindow: BrowserWindow | null = null;
let session: WorkspaceSession | null = null;

app.on('open-file', (event, filePath) => {
  event.preventDefault();
  // A folder dropped on the dock icon opens as the workspace, not as a file.
  if (isDirectory(filePath)) {
    if (session) void session.openFolderPath(filePath).catch(() => logger.log('workspace_open_folder_failed', {}));
    else pendingOpenFolder = filePath;
    return;
  }
  if (session) void session.openPath(filePath).catch((error) => logger.log('workspace_open_file_failed', {
    code: error instanceof Error ? error.message.split(':', 1)[0] : 'OPEN_FAILED',
  }));
  else pendingOpenPath = filePath;
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    const folder = folderArgument(argv.slice(1));
    if (folder && session) {
      void session.openFolderPath(folder).catch(() => logger.log('workspace_open_folder_failed', {}));
    }
    const candidate = markdownArgument(argv);
    if (candidate && session) {
      void session.openPath(candidate).catch((error) => logger.log('workspace_open_file_failed', {
        code: error instanceof Error ? error.message.split(':', 1)[0] : 'OPEN_FAILED',
      }));
    }
    if (editorWindow) {
      if (editorWindow.isMinimized()) editorWindow.restore();
      editorWindow.focus();
    }
  });
}

app.on('web-contents-created', (_event, contents) => {
  contents.on('will-attach-webview', (event) => event.preventDefault());
});

function createApplicationWindow(preloadPath: string): BrowserWindow {
  editorWindow = createEditorWindow(preloadPath, logger, rendererConsole);
  editorWindow.on('closed', () => { editorWindow = null; });
  return editorWindow;
}

async function run(): Promise<void> {
  await app.whenReady();
  app.setAppUserModelId('dev.lr00rl.noto');
  const rendererRoot = path.join(__dirname, '..', 'renderer', 'main_window');
  await installNotoProtocol(rendererRoot, logger, { roots: () => session?.imageRoots() ?? [] });

  const serviceModulePath = app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar.unpacked', '.vite', 'build', 'fs-service.js')
    : path.join(__dirname, 'fs-service.js');
  const broker = new CapabilityBroker();
  const serviceHost = new ServiceHost(serviceModulePath, null, broker, logger);
  const experimentalRuntimeRoot = path.join(__dirname, '..', 'renderer', 'plugin_runtime');
  const experimentalRuntimeHost = new ExperimentalPluginRuntimeHost({
    pluginPreloadPath: path.join(__dirname, 'plugin-preload.js'),
    runtimeHtmlBytes: await readFile(path.join(experimentalRuntimeRoot, 'index.html')),
    bootstrapModuleBytes: await readFile(path.join(experimentalRuntimeRoot, 'bootstrap.js')),
    diagnostic: (event, details) => logger.log(`experimental_plugin_${event}`, details),
  }, () => {
    const window = editorWindow;
    return window && !window.webContents.isDestroyed() ? window.webContents.getOSProcessId() : null;
  });

  const pluginResourceRoot = bundledPluginResourceRoot({
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    appPath: app.getAppPath(),
  });
  let pluginCatalog: PluginCatalog;
  let pluginDiscoveryFailure: string | undefined;
  try {
    pluginCatalog = await discoverBundledPluginCatalog(pluginResourceRoot);
  } catch (error) {
    pluginCatalog = bundledPluginCatalog;
    pluginDiscoveryFailure = error instanceof Error ? error.message.split(':', 1)[0] : 'PLUGIN_DISCOVERY_UNAVAILABLE';
    logger.log('plugin_manifest_discovery_failed_visible', { code: pluginDiscoveryFailure });
  }
  const pluginStateStore = new LocalPluginStateStore(
    path.join(app.getPath('userData'), 'plugins', 'local-state.json'),
    pluginCatalog,
  );
  const rendererLeaseBridge = new RendererLeaseBridge({
    dispatch: (request) => {
      const window = editorWindow;
      if (!window || window.isDestroyed() || window.webContents.isDestroyed()) {
        throw new Error('PLUGIN_RENDERER_DISPOSED');
      }
      if (!isAllowedRendererUrl(window.webContents.mainFrame.url)) {
        throw new Error('PLUGIN_RENDERER_NAVIGATED');
      }
      window.webContents.send(IPC_CHANNELS.pluginRendererRequest, request);
    },
    diagnostic: (code) => logger.log('plugin_renderer_transport_failed', { code }),
  });
  let pluginRegistry!: PluginRegistry;
  pluginRegistry = new PluginRegistry({
    catalog: pluginCatalog,
    initialDiscoveryFailure: pluginDiscoveryFailure,
    stateStore: pluginStateStore,
    rendererHost: rendererLeaseBridge,
    serviceHost,
    publish: () => {
      const window = editorWindow;
      if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return;
      if (!isAllowedRendererUrl(window.webContents.mainFrame.url)) return;
      try {
        window.webContents.send(IPC_CHANNELS.pluginSnapshots, {
          version: PLUGIN_LIFECYCLE_VERSION,
          snapshots: pluginRegistry.getSnapshots(),
        });
      } catch {
        logger.log('plugin_snapshot_publish_failed', { code: 'PLUGIN_RENDERER_DISPOSED' });
      }
    },
  });
  try {
    await pluginRegistry.hydrate();
  } catch (error) {
    logger.log('plugin_state_hydration_failed_visible', {
      code: error instanceof Error ? error.message.split(':', 1)[0] : 'PLUGIN_FAILED',
    });
  }

  const userData = app.getPath('userData');
  // One store per open document, created on demand. Each owns its own accepted
  // revision and recovery journal, which is what keeps tabs from sharing save
  // state.
  const createStore = () => new FileTruthStoreV1(userData, logger);

  const recent = new RecentFiles(path.join(userData, 'recent-files.json'));
  await recent.load();
  // The same store, a second time: a recent folder is a path with a name and a
  // timestamp, exactly like a recent document, so it does not need its own class.
  const recentFolders = new RecentFiles(path.join(userData, 'recent-folders.json'));
  await recentFolders.load();
  const settings = new SettingsStore(path.join(userData, 'settings.json'));
  await settings.load();
  session = new WorkspaceSession(createStore, recent, () => editorWindow, logger, recentFolders);
  app.once('before-quit', () => session?.closeAll());

  const refreshMenu = () => installApplicationMenu(() => editorWindow, recent.list(), {
    openDialog: () => { void session?.openWithDialog().then(refreshMenu).catch(reportOpenFailure); },
    openPath: (filePath) => { void session?.openPath(filePath).then(refreshMenu).catch(reportOpenFailure); },
    openFolder: () => { void session?.openFolderWithDialog().catch(reportOpenFailure); },
    closeTab: () => {
      const current = session?.currentPath;
      if (current) session?.close(current);
    },
    clearRecent: () => {
      void Promise.all(recent.list().map((file) => recent.forget(file.path))).then(refreshMenu);
    },
  });
  const reportOpenFailure = (error: unknown) => logger.log('workspace_open_failed', {
    code: error instanceof Error ? error.message.split(':', 1)[0] : 'OPEN_FAILED',
  });
  refreshMenu();

  registerIpcHandlers({
    getWindow: () => editorWindow,
    logger,
    rendererConsole,
    pluginRegistry,
    rendererLeaseBridge,
    serviceHost,
  });
  registerFileTruthHandlers({
    session,
    getWindow: () => editorWindow,
    logger,
  });
  registerAssetHandlers({
    session,
    settings: () => settings.current(),
    getWindow: () => editorWindow,
    logger,
  });
  registerSettingsHandlers({
    settings,
    getWindow: () => editorWindow,
    logger,
    onChanged: (reply) => logger.log('settings_changed', { theme: reply.settings.theme }),
  });
  registerWorkspaceHandlers({
    session,
    recent,
    getWindow: () => editorWindow,
    logger,
    onRecentChanged: refreshMenu,
    recentFolders: async () => { await recentFolders.load(); return recentFolders.list(); },
  });

  const preloadPath = path.join(__dirname, 'preload.js');
  const window = createApplicationWindow(preloadPath);
  const disposeRendererAuthority = () => {
    const leases = rendererLeaseBridge.activeLeases();
    rendererLeaseBridge.rendererDisposed();
    for (const lease of leases) {
      void pluginRegistry.rendererDisposed(lease.pluginId, lease.leaseId, lease.generation)
        .catch((error) => logger.log('plugin_renderer_disposal_failed', {
          code: error instanceof Error ? error.message.split(':', 1)[0] : 'PLUGIN_FAILED',
        }));
    }
  };
  window.webContents.on('did-start-navigation', (_event, _url, _inPlace, isMainFrame) => {
    if (isMainFrame) disposeRendererAuthority();
  });
  window.webContents.once('destroyed', disposeRendererAuthority);

  // A folder or a document named on the command line opens once the renderer
  // can receive it. The folder first, so a document inside it opens with its
  // tree already showing.
  if (pendingOpenFolder || pendingOpenPath) {
    const folder = pendingOpenFolder;
    const target = pendingOpenPath;
    pendingOpenFolder = null;
    pendingOpenPath = null;
    window.webContents.once('did-finish-load', () => {
      if (folder) void session?.openFolderPath(folder).catch(() => logger.log('workspace_open_folder_failed', {}));
      if (target) void session?.openPath(target).then(refreshMenu).catch(reportOpenFailure);
    });
  } else {
    /*
     * Nothing named, so the folder from last time comes back.
     *
     * Launching from the dock gave an empty window and an invitation to open a
     * folder, to somebody who has opened the same one every day. The folder
     * only: which note was in front is not restored, because reopening a
     * document is a change to it as far as the recovery journal is concerned
     * and starting a session by touching a file nobody asked for is not worth
     * the convenience.
     *
     * Not marked as chosen, because the reader is not choosing it now. That
     * leaves the rail obeying its own setting instead of springing open.
     */
    window.webContents.once('did-finish-load', () => {
      /*
       * Loaded again here rather than trusted from startup. The window can
       * finish loading before the read of the recent folders that startup
       * began has come back, and then the list is empty and there is nothing
       * to restore. The renderer catches a folder that arrives after it has
       * mounted: it attaches its listener before it asks.
       */
      void (async () => {
        await recentFolders.load();
        const [last] = recentFolders.list();
        if (!last) return;
        await session?.openFolderPath(last.path, false)
          .catch(() => logger.log('workspace_restore_folder_failed', {}));
      })();
    });
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const restored = createApplicationWindow(preloadPath);
      restored.webContents.once('did-finish-load', () => session?.republish());
    }
  });

  let shutdownStarted = false;
  app.on('before-quit', (event) => {
    if (shutdownStarted) return;
    shutdownStarted = true;
    event.preventDefault();
    void pluginRegistry.shutdown()
      .catch((error) => logger.log('plugin_shutdown_failed', {
        code: error instanceof Error ? error.message.split(':', 1)[0] : 'PLUGIN_FAILED',
      }))
      .then(() => experimentalRuntimeHost.shutdown().catch((error) => logger.log('experimental_runtime_shutdown_failed', {
        code: error instanceof Error ? error.message.split(':', 1)[0] : 'EXPERIMENTAL_RUNTIME_FAILED',
      })))
      .then(() => serviceHost.stop().catch((error) => logger.log('service_stop_failed', {
        code: error instanceof Error ? error.message.split(':', 1)[0] : 'SERVICE_FAILED',
      })))
      .finally(() => {
        rendererLeaseBridge.rendererDisposed();
        app.quit();
      });
  });
}

void run().catch((error) => {
  logger.log('application_start_failed', {
    code: error instanceof Error ? error.message.split(':', 1)[0] : 'BOOTSTRAP_FAILED',
  });
  app.exit(1);
});

app.on('window-all-closed', () => app.quit());
