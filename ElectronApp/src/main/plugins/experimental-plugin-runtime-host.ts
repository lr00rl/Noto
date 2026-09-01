import { randomBytes } from 'node:crypto';
import { BrowserWindow, ipcMain, webContents, type IpcMainInvokeEvent, type Session } from 'electron';
import {
  EXPERIMENTAL_RUNTIME_CHANNELS,
  experimentalRuntimeProbePassed,
  isExperimentalRuntimeIdentityV0,
  isExperimentalRuntimeProbeEnvelopeV0,
  type ExperimentalRuntimeIdentityV0,
  type ExperimentalRuntimeProbeV0,
} from '../../shared/plugins/experimental-runtime-v0';
import { ExperimentalPluginPidRegistry } from './experimental-plugin-pid-registry';
import {
  ExperimentalRuntimeCleanup,
  type ExperimentalRuntimeCleanupReceipts,
} from './experimental-runtime-cleanup';
import {
  ExperimentalRuntimeHeartbeatLease,
  ExperimentalRuntimeHeartbeatRateLimiter,
  ExperimentalRuntimeRequestLedger,
} from './experimental-runtime-ledger';
import { registerExperimentalPluginProtocol } from '../protocol/register-experimental-plugin-protocol';

export type ExperimentalRuntimeFailureCode =
  | 'isolationUnavailable'
  | 'readyTimeout'
  | 'crashed'
  | 'heartbeatLost'
  | 'heartbeatRateLimited'
  | 'senderInvalid'
  | 'probeFailed'
  | 'cleanupFailed'
  | 'runtimeDestroyed';

export class ExperimentalRuntimeFailure extends Error {
  constructor(readonly code: ExperimentalRuntimeFailureCode) {
    super(code);
    this.name = 'ExperimentalRuntimeFailure';
  }
}

export interface ExperimentalPluginRuntimeLaunch {
  pluginId: string;
  packageDigest: string;
  runtimeGeneration: number;
  moduleBytes: Uint8Array;
}

export interface ExperimentalPluginRuntimeAssets {
  pluginPreloadPath: string;
  runtimeHtmlBytes: Uint8Array;
  bootstrapModuleBytes: Uint8Array;
  diagnostic?: (event:
    | 'runtime_launch'
    | 'runtime_pid'
    | 'runtime_ready'
    | 'runtime_cleanup_failed'
    | 'runtime_cleanup_confirmed'
    | 'runtime_terminal', details: {
    pluginId: string;
    packageDigest: string;
    runtimeGeneration: number;
    webContentsId: number;
    osPid: number | null;
    outcomeCode: 'pending' | 'live' | 'ready' | ExperimentalRuntimeFailureCode | 'closed';
  }) => void;
}

export interface ExperimentalPluginRuntimeHandle {
  pluginId: string;
  packageDigest: string;
  runtimeGeneration: number;
  pid: number;
  probe: ExperimentalRuntimeProbeV0;
  abort(): Promise<ExperimentalRuntimeProbeV0>;
  destroy(): Promise<void>;
}

interface RuntimeRecord {
  key: string;
  pluginId: string;
  packageDigest: string;
  runtimeGeneration: number;
  sessionToken: string;
  window: BrowserWindow;
  runtimeSession: Session;
  webContentsId: number;
  pid: number | null;
  probe: ExperimentalRuntimeProbeV0 | null;
  ready: boolean;
  heartbeat: ExperimentalRuntimeHeartbeatLease;
  heartbeatRateLimiter: ExperimentalRuntimeHeartbeatRateLimiter;
  requestLedger: ExperimentalRuntimeRequestLedger;
  abortAcks: Map<string, { resolve: () => void; reject: (error: Error) => void }>;
  navigationDenials: number;
  downloadDenials: number;
  cleanup: ExperimentalRuntimeCleanup;
  terminalFailure: ExperimentalRuntimeFailureCode | null;
  cleanupFailureReported: boolean;
  cleanupConfirmedReported: boolean;
  unregisterProtocol: () => Promise<void>;
  heartbeatTimer: ReturnType<typeof setInterval> | null;
  rejectLaunch: (error: Error) => void;
}

export interface ExperimentalRuntimeHostSnapshot {
  records: number;
  pidRegistry: number;
  cleanupPending: number;
  pluginBrowserWindows: number;
  pluginWebContents: number;
  cleanupReceipts: {
    total: number;
    windowDestroyed: number;
    protocolUnhandled: number;
    sessionCleared: number;
    ownershipReleased: number;
  };
}

const boundedModule = (bytes: Uint8Array): Uint8Array => {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0 || bytes.byteLength > 1024 * 1024) {
    throw new ExperimentalRuntimeFailure('probeFailed');
  }
  return Uint8Array.from(bytes);
};

const runtimeKey = (pluginId: string, generation: number): string => `${pluginId}:${generation}`;

export class ExperimentalPluginRuntimeHost {
  readonly #assets: ExperimentalPluginRuntimeAssets;
  readonly #pidRegistry: ExperimentalPluginPidRegistry;
  readonly #records = new Map<string, RuntimeRecord>();
  readonly #closedCleanupReceipts: ExperimentalRuntimeCleanupReceipts[] = [];
  readonly #handlers: Array<{ channel: string; listener: (event: IpcMainInvokeEvent, value: unknown) => unknown }> = [];

  constructor(assets: ExperimentalPluginRuntimeAssets, editorPid: () => number | null) {
    this.#assets = {
      pluginPreloadPath: assets.pluginPreloadPath,
      runtimeHtmlBytes: Uint8Array.from(assets.runtimeHtmlBytes),
      bootstrapModuleBytes: Uint8Array.from(assets.bootstrapModuleBytes),
      diagnostic: assets.diagnostic,
    };
    this.#pidRegistry = new ExperimentalPluginPidRegistry(editorPid);
    this.#installHandlers();
  }

  async launch(input: ExperimentalPluginRuntimeLaunch): Promise<ExperimentalPluginRuntimeHandle> {
    if (!/^local\.[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(input.pluginId)
      || !/^[a-f0-9]{64}$/.test(input.packageDigest)
      || !Number.isSafeInteger(input.runtimeGeneration) || input.runtimeGeneration <= 0) {
      throw new ExperimentalRuntimeFailure('probeFailed');
    }
    const key = runtimeKey(input.pluginId, input.runtimeGeneration);
    if (this.#records.has(key)) throw new ExperimentalRuntimeFailure('senderInvalid');
    const moduleBytes = boundedModule(input.moduleBytes);
    const sessionToken = randomBytes(32).toString('hex');
    const partition = `noto-plugin-${sessionToken}`;
    const window = new BrowserWindow({
      show: false,
      width: 320,
      height: 240,
      webPreferences: {
        preload: this.#assets.pluginPreloadPath,
        partition,
        additionalArguments: [
          `--noto-plugin-session=${sessionToken}`,
          `--noto-plugin-generation=${input.runtimeGeneration}`,
        ],
        nodeIntegration: false,
        nodeIntegrationInWorker: false,
        nodeIntegrationInSubFrames: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
        webviewTag: false,
        devTools: false,
        backgroundThrottling: false,
      },
    });
    window.setSkipTaskbar(true);
    const runtimeSession = window.webContents.session;
    runtimeSession.setPermissionCheckHandler(() => false);
    runtimeSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    runtimeSession.setDevicePermissionHandler(() => false);
    runtimeSession.webRequest.onBeforeRequest((details, callback) => {
      callback({ cancel: !details.url.startsWith(`noto-plugin://${sessionToken}/`) });
    });
    let navigationDenials = 0;
    let downloadDenials = 0;
    let record!: RuntimeRecord;
    runtimeSession.on('will-download', (event, item) => {
      downloadDenials += 1;
      record.downloadDenials = downloadDenials;
      event.preventDefault();
      item.cancel();
    });
    const unregisterProtocol = await registerExperimentalPluginProtocol(runtimeSession, {
      sessionToken,
      runtimeHtmlBytes: this.#assets.runtimeHtmlBytes,
      bootstrapModuleBytes: this.#assets.bootstrapModuleBytes,
      entryModuleBytes: moduleBytes,
    });

    let rejectLaunch!: (error: Error) => void;
    const launchPromise = new Promise<ExperimentalPluginRuntimeHandle>((resolve, reject) => {
      rejectLaunch = reject;
      const timeout = setTimeout(() => {
        void this.#close(key, 'readyTimeout');
      }, 5_000);
      const finish = () => clearTimeout(timeout);
      window.webContents.once('did-finish-load', () => {
        const record = this.#records.get(key);
        if (!record || record.cleanup.state !== 'live') return;
        const pid = window.webContents.getOSProcessId();
        if (pid <= 0 || !this.#pidRegistry.register(key, pid).ok) {
          void this.#close(key, 'isolationUnavailable');
          return;
        }
        record.pid = pid;
        this.#diagnostic('runtime_pid', record, 'live');
        record.heartbeatTimer = setInterval(() => {
          if (record.heartbeat.expired(Date.now())) void this.#close(key, 'heartbeatLost');
        }, 1_000);
      });
      const poll = setInterval(() => {
        const record = this.#records.get(key);
        if (!record || record.cleanup.state !== 'live') {
          clearInterval(poll);
          finish();
          return;
        }
        if (!record.ready || record.pid === null || !record.probe) return;
        clearInterval(poll);
        finish();
        if (!experimentalRuntimeProbePassed(record.probe)) {
          void this.#close(key, 'probeFailed');
          return;
        }
        this.#diagnostic('runtime_ready', record, 'ready');
        resolve(this.#handleFor(record));
      }, 10);
    });

    record = {
      key,
      pluginId: input.pluginId,
      packageDigest: input.packageDigest,
      runtimeGeneration: input.runtimeGeneration,
      sessionToken,
      window,
      runtimeSession,
      webContentsId: window.webContents.id,
      pid: null,
      probe: null,
      ready: false,
      heartbeat: new ExperimentalRuntimeHeartbeatLease(5_000, Date.now()),
      heartbeatRateLimiter: new ExperimentalRuntimeHeartbeatRateLimiter(4, 1_000, Date.now()),
      requestLedger: new ExperimentalRuntimeRequestLedger(),
      abortAcks: new Map(),
      navigationDenials,
      downloadDenials,
      cleanup: new ExperimentalRuntimeCleanup(),
      terminalFailure: null,
      cleanupFailureReported: false,
      cleanupConfirmedReported: false,
      unregisterProtocol,
      heartbeatTimer: null,
      rejectLaunch,
    };
    this.#records.set(key, record);
    this.#diagnostic('runtime_launch', record, 'pending');
    let initialNavigationAllowed = true;
    window.webContents.on('will-frame-navigate', (event) => {
      if (initialNavigationAllowed && event.url === `noto-plugin://${sessionToken}/`) {
        initialNavigationAllowed = false;
        return;
      }
      navigationDenials += 1;
      record.navigationDenials = navigationDenials;
      event.preventDefault();
    });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('render-process-gone', () => { void this.#close(key, 'crashed'); });
    window.webContents.once('destroyed', () => {
      if (record.cleanup.state === 'live') void this.#close(key, 'runtimeDestroyed');
    });
    try {
      await window.loadURL(`noto-plugin://${sessionToken}/`);
    } catch {
      await this.#close(key, 'crashed');
    }
    return launchPromise;
  }

  liveRuntimes(): ReadonlyArray<{ pluginId: string; runtimeGeneration: number; pid: number }> {
    return [...this.#records.values()]
      .filter((record): record is RuntimeRecord & { pid: number } =>
        record.cleanup.state === 'live' && record.pid !== null)
      .map(({ pluginId, runtimeGeneration, pid }) => ({ pluginId, runtimeGeneration, pid }));
  }

  snapshot(): ExperimentalRuntimeHostSnapshot {
    const records = [...this.#records.values()];
    const ids = new Set(records.map(({ webContentsId }) => webContentsId));
    const receipts = [
      ...this.#closedCleanupReceipts,
      ...records.map(({ cleanup }) => cleanup.receipts),
    ];
    return {
      records: records.length,
      pidRegistry: this.#pidRegistry.entries().length,
      cleanupPending: records.filter(({ cleanup }) => cleanup.state !== 'live').length,
      pluginBrowserWindows: BrowserWindow.getAllWindows()
        .filter((window) => ids.has(window.webContents.id)).length,
      pluginWebContents: webContents.getAllWebContents()
        .filter((contents) => ids.has(contents.id)).length,
      cleanupReceipts: {
        total: receipts.length,
        windowDestroyed: receipts.filter(({ windowDestroyed }) => windowDestroyed).length,
        protocolUnhandled: receipts.filter(({ protocolUnhandled }) => protocolUnhandled).length,
        sessionCleared: receipts.filter(({ sessionCleared }) => sessionCleared).length,
        ownershipReleased: receipts.filter(({ ownershipReleased }) => ownershipReleased).length,
      },
    };
  }

  async shutdown(): Promise<void> {
    await Promise.all([...this.#records.keys()].map((key) => this.#close(key)));
    if (this.#records.size > 0) {
      await Promise.all([...this.#records.keys()].map((key) => this.#close(key)));
    }
    if (this.#records.size > 0) throw new ExperimentalRuntimeFailure('cleanupFailed');
    for (const { channel } of this.#handlers) ipcMain.removeHandler(channel);
    this.#handlers.length = 0;
  }

  #installHandlers(): void {
    this.#handleIpc(EXPERIMENTAL_RUNTIME_CHANNELS.ready, true, (record, value) => {
      if (!isExperimentalRuntimeIdentityV0(value)) throw new ExperimentalRuntimeFailure('senderInvalid');
      if (record.ready) throw new ExperimentalRuntimeFailure('senderInvalid');
      record.ready = true;
    });
    this.#handleIpc(EXPERIMENTAL_RUNTIME_CHANNELS.heartbeat, false, (record, value) => {
      if (!isExperimentalRuntimeIdentityV0(value)) throw new ExperimentalRuntimeFailure('senderInvalid');
      if (!record.heartbeatRateLimiter.accept(Date.now())) {
        throw new ExperimentalRuntimeFailure('heartbeatRateLimited');
      }
      record.heartbeat.heartbeat(Date.now());
    });
    this.#handleIpc(EXPERIMENTAL_RUNTIME_CHANNELS.probe, true, (record, value) => {
      if (!isExperimentalRuntimeProbeEnvelopeV0(value)) throw new ExperimentalRuntimeFailure('probeFailed');
      record.probe = Object.freeze({
        ...value.probe,
        navigationDenied: value.probe.navigationDenied && record.navigationDenials > 0,
        downloadDenied: value.probe.downloadDenied && record.downloadDenials > 0,
      });
    });
    this.#handleIpc(EXPERIMENTAL_RUNTIME_CHANNELS.abortAck, true, (record, value) => {
      if (!isExperimentalRuntimeIdentityV0(value)) throw new ExperimentalRuntimeFailure('senderInvalid');
      const acknowledgement = record.abortAcks.get(value.requestId);
      if (!acknowledgement) throw new ExperimentalRuntimeFailure('senderInvalid');
      acknowledgement.resolve();
      record.abortAcks.delete(value.requestId);
    });
  }

  #handleIpc(
    channel: string,
    consumeLedger: boolean,
    action: (record: RuntimeRecord, value: unknown) => void,
  ): void {
    const listener = async (event: IpcMainInvokeEvent, value: unknown) => {
      let record: RuntimeRecord;
      try {
        record = this.#recordForSender(event, value);
      } catch (error) {
        const senderRecord = this.#liveRecordForSender(event);
        if (senderRecord) await this.#close(senderRecord.key, 'senderInvalid');
        throw error;
      }
      if (consumeLedger) {
        const requestId = (value as ExperimentalRuntimeIdentityV0).requestId;
        const ledgerResult = record.requestLedger.consume(requestId);
        if (ledgerResult !== 'accepted') {
          await this.#close(record.key, 'senderInvalid');
          throw new ExperimentalRuntimeFailure('senderInvalid');
        }
      }
      try {
        action(record, value);
      } catch (error) {
        const failure = error instanceof ExperimentalRuntimeFailure ? error.code : 'senderInvalid';
        await this.#close(record.key, failure);
        throw error;
      }
      return { accepted: true } as const;
    };
    ipcMain.handle(channel, listener);
    this.#handlers.push({ channel, listener });
  }

  #recordForSender(event: IpcMainInvokeEvent, value: unknown): RuntimeRecord {
    const record = this.#liveRecordForSender(event);
    if (!record) throw new ExperimentalRuntimeFailure('senderInvalid');
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new ExperimentalRuntimeFailure('senderInvalid');
    }
    const envelope = value as Record<string, unknown>;
    const identity = {
      version: envelope.version,
      requestId: envelope.requestId,
      sessionToken: envelope.sessionToken,
      runtimeGeneration: envelope.runtimeGeneration,
    };
    if (!isExperimentalRuntimeIdentityV0(identity)) {
      throw new ExperimentalRuntimeFailure('senderInvalid');
    }
    if (record.sessionToken !== identity.sessionToken
      || record.runtimeGeneration !== identity.runtimeGeneration) {
      throw new ExperimentalRuntimeFailure('senderInvalid');
    }
    return record;
  }

  #liveRecordForSender(event: IpcMainInvokeEvent): RuntimeRecord | undefined {
    return [...this.#records.values()].find((candidate) =>
      candidate.cleanup.state === 'live' && candidate.webContentsId === event.sender.id);
  }

  #handleFor(record: RuntimeRecord): ExperimentalPluginRuntimeHandle {
    return Object.freeze({
      pluginId: record.pluginId,
      packageDigest: record.packageDigest,
      runtimeGeneration: record.runtimeGeneration,
      pid: record.pid as number,
      probe: Object.freeze({ ...record.probe as ExperimentalRuntimeProbeV0 }),
      abort: () => this.#abort(record.key),
      destroy: async () => {
        if (!await this.#close(record.key)) throw new ExperimentalRuntimeFailure('cleanupFailed');
      },
    });
  }

  async #abort(key: string): Promise<ExperimentalRuntimeProbeV0> {
    const record = this.#records.get(key);
    if (!record || record.cleanup.state !== 'live' || record.window.webContents.isDestroyed()) {
      throw new ExperimentalRuntimeFailure('runtimeDestroyed');
    }
    const requestId = `abort:${randomBytes(16).toString('hex')}`;
    const envelope: ExperimentalRuntimeIdentityV0 = {
      version: 0,
      requestId,
      sessionToken: record.sessionToken,
      runtimeGeneration: record.runtimeGeneration,
    };
    try {
      await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        record.abortAcks.delete(requestId);
        reject(new ExperimentalRuntimeFailure('runtimeDestroyed'));
      }, 1_000);
      record.abortAcks.set(requestId, {
        resolve: () => { clearTimeout(timeout); resolve(); },
        reject: (error) => { clearTimeout(timeout); reject(error); },
      });
      record.window.webContents.send(EXPERIMENTAL_RUNTIME_CHANNELS.abort, envelope);
      });
    } catch {
      const closed = await this.#close(key, 'runtimeDestroyed');
      throw new ExperimentalRuntimeFailure(closed ? 'runtimeDestroyed' : 'cleanupFailed');
    }
    const deadline = Date.now() + 500;
    while (!record.probe?.abortObserved && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    if (!record.probe || !experimentalRuntimeProbePassed(record.probe, true)) {
      await this.#close(key, 'probeFailed');
      throw new ExperimentalRuntimeFailure('probeFailed');
    }
    return Object.freeze({ ...record.probe });
  }

  async #close(key: string, failure?: ExperimentalRuntimeFailureCode): Promise<boolean> {
    const record = this.#records.get(key);
    if (!record) return true;
    if (failure && !record.terminalFailure) record.terminalFailure = failure;
    if (record.heartbeatTimer) clearInterval(record.heartbeatTimer);
    for (const acknowledge of record.abortAcks.values()) {
      acknowledge.reject(new ExperimentalRuntimeFailure('runtimeDestroyed'));
    }
    record.abortAcks.clear();
    const runtimeSession = record.runtimeSession;
    const cleanup = await record.cleanup.close({
      destroyWindow: () => this.#destroyWindow(record.window),
      unhandleProtocol: record.unregisterProtocol,
      clearSession: () => runtimeSession.clearStorageData(),
      releaseOwnership: async () => {
        this.#pidRegistry.release(key);
        this.#records.delete(key);
      },
    });
    if (cleanup.state === 'cleanup-failed') {
      if (!record.cleanupFailureReported) {
        record.cleanupFailureReported = true;
        this.#diagnostic('runtime_cleanup_failed', record, 'cleanupFailed');
      }
      record.rejectLaunch(new ExperimentalRuntimeFailure('cleanupFailed'));
      return false;
    }
    if (!record.cleanupConfirmedReported) {
      record.cleanupConfirmedReported = true;
      this.#closedCleanupReceipts.push({ ...cleanup.receipts });
      if (this.#closedCleanupReceipts.length > 64) this.#closedCleanupReceipts.shift();
      this.#diagnostic('runtime_cleanup_confirmed', record, 'closed');
      this.#diagnostic('runtime_terminal', record, record.terminalFailure ?? 'closed');
      if (record.terminalFailure) {
        record.rejectLaunch(new ExperimentalRuntimeFailure(record.terminalFailure));
      }
    }
    return true;
  }

  async #destroyWindow(window: BrowserWindow): Promise<void> {
    if (window.isDestroyed()) return;
    await new Promise<void>((resolve, reject) => {
      const onClosed = () => {
        clearTimeout(timeout);
        resolve();
      };
      const timeout = setTimeout(() => {
        window.removeListener('closed', onClosed);
        reject(new ExperimentalRuntimeFailure('cleanupFailed'));
      }, 3_000);
      window.once('closed', onClosed);
      try {
        window.destroy();
      } catch {
        clearTimeout(timeout);
        window.removeListener('closed', onClosed);
        reject(new ExperimentalRuntimeFailure('cleanupFailed'));
      }
    });
  }

  #diagnostic(
    event:
      | 'runtime_launch'
      | 'runtime_pid'
      | 'runtime_ready'
      | 'runtime_cleanup_failed'
      | 'runtime_cleanup_confirmed'
      | 'runtime_terminal',
    record: RuntimeRecord,
    outcomeCode: 'pending' | 'live' | 'ready' | ExperimentalRuntimeFailureCode | 'closed',
  ): void {
    this.#assets.diagnostic?.(event, {
      pluginId: record.pluginId,
      packageDigest: record.packageDigest,
      runtimeGeneration: record.runtimeGeneration,
      webContentsId: record.webContentsId,
      osPid: record.pid,
      outcomeCode,
    });
  }
}
