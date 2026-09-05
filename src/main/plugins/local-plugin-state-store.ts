import { randomBytes } from 'node:crypto';
import {
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  type FileHandle,
} from 'node:fs/promises';
import path from 'node:path';
import type { PluginCatalog } from '../../shared/plugins/catalog';
import type { PluginPersistenceHealth } from '../../shared/plugins/lifecycle';
import {
  cloneLocalPluginState,
  createDefaultLocalPluginState,
  parseLocalPluginState,
  validateLocalPluginState,
  type LocalPluginState,
} from '../../shared/plugins/state';

const MAX_STATE_BYTES = 1_000_000;

interface LocalPluginStateFileHandle {
  writeFile(data: string): Promise<void>;
  sync(): Promise<void>;
  close(): Promise<void>;
}

interface LocalPluginStateStats {
  size: number;
  isFile(): boolean;
  isSymbolicLink(): boolean;
}

export interface LocalPluginStateFileSystem {
  lstat(filePath: string): Promise<LocalPluginStateStats>;
  mkdir(directory: string): Promise<void>;
  open(filePath: string, flags: string, mode?: number): Promise<LocalPluginStateFileHandle>;
  readFile(filePath: string): Promise<string>;
  rename(from: string, to: string): Promise<void>;
  rm(filePath: string): Promise<void>;
}

export type LocalPluginStateStoreErrorCode =
  | 'CORRUPT_LOCAL_PLUGIN_STATE'
  | 'READ_LOCAL_PLUGIN_STATE_FAILED'
  | 'UNSAFE_LOCAL_PLUGIN_STATE'
  | 'WRITE_LOCAL_PLUGIN_STATE_FAILED';

export class LocalPluginStateStoreError extends Error {
  constructor(
    readonly code: LocalPluginStateStoreErrorCode,
    message: string,
    readonly evidencePath: string,
    readonly residuePaths: readonly string[] = [],
    options?: ErrorOptions,
  ) {
    super(`${code}: ${message}`, options);
    this.name = 'LocalPluginStateStoreError';
  }
}

export type LocalPluginStateSaveOutcome =
  | {
    status: 'durable';
    health: 'healthy';
    state: LocalPluginState;
  }
  | {
    status: 'published-uncertain';
    health: Exclude<PluginPersistenceHealth, 'healthy'>;
    state: LocalPluginState;
    detail: 'directory-sync-failed' | 'readback-failed' | 'readback-mismatch';
  };

export function createNodeLocalPluginStateFileSystem(): LocalPluginStateFileSystem {
  return {
    lstat: (filePath) => lstat(filePath),
    mkdir: async (directory) => { await mkdir(directory, { mode: 0o700, recursive: true }); },
    open: async (filePath, flags, mode) => open(filePath, flags, mode) as Promise<FileHandle>,
    readFile: (filePath) => readFile(filePath, 'utf8'),
    rename,
    rm: async (filePath) => { await rm(filePath, { force: true }); },
  };
}

export class LocalPluginStateStore {
  private writeTail: Promise<void> = Promise.resolve();

  constructor(
    private readonly statePath: string,
    private readonly catalog: PluginCatalog,
    private readonly fileSystem: LocalPluginStateFileSystem = createNodeLocalPluginStateFileSystem(),
    /**
     * Which platform's durability rules apply.
     *
     * Injected so the two answers can both be tested from one machine. The
     * only thing it decides is whether the directory is synced after the
     * rename, which is a POSIX step with no equivalent on Windows.
     */
    private readonly platform: NodeJS.Platform = process.platform,
  ) {
    if (!path.isAbsolute(statePath) || statePath.includes('\0')) {
      throw new LocalPluginStateStoreError(
        'UNSAFE_LOCAL_PLUGIN_STATE',
        'state path must be an absolute local path',
        statePath,
      );
    }
  }

  async load(): Promise<LocalPluginState> {
    await this.writeTail;
    return this.readAcceptedStateOrDefaults();
  }

  save(state: LocalPluginState): Promise<LocalPluginStateSaveOutcome> {
    if (!validateLocalPluginState(state, this.catalog)) {
      return Promise.reject(new LocalPluginStateStoreError(
        'WRITE_LOCAL_PLUGIN_STATE_FAILED',
        'state did not match the current bundled plugin catalog',
        this.statePath,
      ));
    }
    const acceptedCandidate = cloneLocalPluginState(state);
    const operation = this.writeTail.then(() => this.saveSerialized(acceptedCandidate));
    this.writeTail = operation.then(() => undefined, () => undefined);
    return operation;
  }

  private async readAcceptedStateOrDefaults(): Promise<LocalPluginState> {
    let stats: LocalPluginStateStats;
    try {
      stats = await this.fileSystem.lstat(this.statePath);
    } catch (cause) {
      if (isMissing(cause)) return createDefaultLocalPluginState(this.catalog);
      throw new LocalPluginStateStoreError(
        'READ_LOCAL_PLUGIN_STATE_FAILED',
        'state metadata could not be read',
        this.statePath,
        [],
        { cause },
      );
    }

    if (stats.isSymbolicLink() || !stats.isFile() || stats.size > MAX_STATE_BYTES) {
      throw new LocalPluginStateStoreError(
        'UNSAFE_LOCAL_PLUGIN_STATE',
        'state evidence is not a bounded regular file',
        this.statePath,
      );
    }

    let source: string;
    try {
      source = await this.fileSystem.readFile(this.statePath);
    } catch (cause) {
      throw new LocalPluginStateStoreError(
        'READ_LOCAL_PLUGIN_STATE_FAILED',
        'state evidence could not be read',
        this.statePath,
        [],
        { cause },
      );
    }

    try {
      return parseLocalPluginState(JSON.parse(source), this.catalog);
    } catch (cause) {
      throw new LocalPluginStateStoreError(
        'CORRUPT_LOCAL_PLUGIN_STATE',
        'state evidence was invalid and was preserved without reset',
        this.statePath,
        [],
        { cause },
      );
    }
  }

  private async saveSerialized(state: LocalPluginState): Promise<LocalPluginStateSaveOutcome> {
    const directory = path.dirname(this.statePath);
    await this.fileSystem.mkdir(directory);
    await this.assertExistingStateSafe();

    const temporaryPath = path.join(
      directory,
      `.noto-local-plugins-${process.pid}-${randomBytes(8).toString('hex')}.tmp`,
    );
    const source = `${JSON.stringify(state)}\n`;
    let handle: LocalPluginStateFileHandle | null = null;
    let primary: unknown = null;
    let published = false;
    let temporaryCreated = false;

    try {
      handle = await this.fileSystem.open(temporaryPath, 'wx', 0o600);
      temporaryCreated = true;
      await handle.writeFile(source);
      await handle.sync();
    } catch (cause) {
      primary = cause;
    }

    if (handle) {
      try {
        await handle.close();
      } catch (cause) {
        primary ??= cause;
      }
    }

    if (!primary) {
      try {
        await this.fileSystem.rename(temporaryPath, this.statePath);
        published = true;
      } catch (cause) {
        primary = cause;
      }
    }

    if (published) {
      /*
       * The directory is synced so the rename itself survives a power cut,
       * which is a POSIX step: a directory cannot be opened for reading on
       * Windows at all, and its rename is journalled by the file system
       * rather than by the caller. Asking there fails every time, and a
       * write that is durable was being reported as degraded for it, which
       * is what put every plugin into "needs recovery" on Windows.
       */
      let directorySyncFailed = false;
      let directoryHandle: LocalPluginStateFileHandle | null = null;
      try {
        if (this.platform !== 'win32') {
          directoryHandle = await this.fileSystem.open(directory, 'r');
          await directoryHandle.sync();
        }
      } catch {
        directorySyncFailed = true;
      } finally {
        if (directoryHandle) {
          try {
            await directoryHandle.close();
          } catch {
            directorySyncFailed = true;
          }
        }
      }

      let confirmed: unknown;
      try {
        confirmed = JSON.parse(await this.fileSystem.readFile(this.statePath)) as unknown;
      } catch {
        return {
          status: 'published-uncertain',
          health: 'indeterminate',
          state: cloneLocalPluginState(state),
          detail: 'readback-failed',
        };
      }

      let reconciled: LocalPluginState;
      try {
        reconciled = parseLocalPluginState(confirmed, this.catalog);
      } catch {
        return {
          status: 'published-uncertain',
          health: 'indeterminate',
          state: cloneLocalPluginState(state),
          detail: 'readback-failed',
        };
      }
      if (JSON.stringify(reconciled) !== JSON.stringify(state)) {
        return {
          status: 'published-uncertain',
          health: 'indeterminate',
          state: reconciled,
          detail: 'readback-mismatch',
        };
      }
      if (directorySyncFailed) {
        return {
          status: 'published-uncertain',
          health: 'degraded',
          state: reconciled,
          detail: 'directory-sync-failed',
        };
      }
      return { status: 'durable', health: 'healthy', state: reconciled };
    }

    let cleanup: unknown = null;
    if (temporaryCreated && !published) {
      try {
        await this.fileSystem.rm(temporaryPath);
      } catch (cause) {
        cleanup = cause;
      }
    }
    const residuePaths = cleanup && !published ? [temporaryPath] : [];
    throw new LocalPluginStateStoreError(
      'WRITE_LOCAL_PLUGIN_STATE_FAILED',
      cleanup
        ? 'durable state write failed and temporary cleanup also failed'
        : 'durable state write was not accepted',
      this.statePath,
      residuePaths,
      { cause: primary },
    );
  }

  private async assertExistingStateSafe(): Promise<void> {
    try {
      await this.readAcceptedStateOrDefaults();
    } catch (cause) {
      if (cause instanceof LocalPluginStateStoreError) throw cause;
      throw new LocalPluginStateStoreError(
        'READ_LOCAL_PLUGIN_STATE_FAILED',
        'existing state could not be verified before replacement',
        this.statePath,
        [],
        { cause },
      );
    }
  }
}

function isMissing(cause: unknown): boolean {
  return cause instanceof Error
    && 'code' in cause
    && (cause as NodeJS.ErrnoException).code === 'ENOENT';
}
