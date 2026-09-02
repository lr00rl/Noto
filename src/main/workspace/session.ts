/**
 * Owns which documents are open, and which one is in front.
 *
 * A file-truth store knows how to open, save and recover exactly one document
 * safely, so each open document gets its own. That is what makes tabs safe
 * rather than merely convenient: two documents never share a save token, a
 * recovery journal, or an accepted revision. Recovery artifacts are already
 * keyed by a hash of the document's path, so the stores can share one root.
 *
 * This is also the single place an open can be started from, whether the
 * request came from the menu, the renderer, the dock, or a file association.
 */

import path from 'node:path';
import { stat } from 'node:fs/promises';
import { BrowserWindow, dialog, shell } from 'electron';
import type { FileTruthOpenReplyV1 } from '../../shared/file-truth/v1/contracts';
import {
  NOTO_WORKSPACE_VERSION,
  WORKSPACE_CHANNELS,
  type WorkspaceTabV1,
  type WorkspaceFolderEventV1,
} from '../../shared/workspace/v1/contracts';
import type {
  WorkspaceContentReplyV1, WorkspaceIndexReplyV1, WorkspaceRevealReplyV1, WorkspaceRevealTargetV1,
} from '../../shared/workspace/v1/contracts';
import type { StructuredLogger } from '../logger';
import type { FileTruthStoreV1 } from '../file-truth/v1/file-truth-store';
import type { RecentFiles } from './recent-files';
import { listDirectory, type FileTreeEntryV1 } from './file-tree';
import { buildFileIndex } from './file-index';
import { searchContent } from './content-search';

const MARKDOWN_FILTERS = [
  { name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd', 'txt'] },
  { name: 'All files', extensions: ['*'] },
];

interface OpenDocument {
  readonly store: FileTruthStoreV1;
  readonly opened: FileTruthOpenReplyV1;
}

/** How many documents may be open at once, so a stray loop cannot exhaust handles. */
const MAX_TABS = 24;

export class WorkspaceSession {
  /** Keyed by resolved path: opening the same file twice reuses its tab. */
  private readonly documents = new Map<string, OpenDocument>();
  private activePath: string | null = null;
  /** The folder shown in the sidebar, and the boundary for every listing. */
  private folderRoot: string | null = null;
  private indexCache: { root: string; reply: WorkspaceIndexReplyV1 } | null = null;

  constructor(
    private readonly createStore: () => FileTruthStoreV1,
    private readonly recent: RecentFiles,
    private readonly getWindow: () => BrowserWindow | null,
    private readonly logger: StructuredLogger,
    /** The folders opened before, in the same shape as the recent documents:
     *  the list is a list of paths either way, so it is the same store. */
    private readonly recentFolders?: RecentFiles,
  ) {}

  get current(): FileTruthOpenReplyV1 | null {
    return this.activePath ? this.documents.get(this.activePath)?.opened ?? null : null;
  }

  get currentPath(): string | null {
    return this.activePath;
  }

  /** The store owning a document, so a save is routed to the right one. */
  storeForDocument(documentId: string): FileTruthStoreV1 | null {
    for (const document of this.documents.values()) {
      if (document.opened.document.documentId === documentId) return document.store;
    }
    return null;
  }

  /** The store for whichever document is in front. */
  activeStore(): FileTruthStoreV1 | null {
    return this.activePath ? this.documents.get(this.activePath)?.store ?? null : null;
  }

  tabs(): WorkspaceTabV1[] {
    return [...this.documents.entries()].map(([filePath, document]) => ({
      path: filePath,
      name: path.basename(filePath),
      documentId: document.opened.document.documentId,
      active: filePath === this.activePath,
    }));
  }

  /**
   * Open a file, or bring it to the front if it is already open.
   *
   * A failed open leaves the other tabs alone; the caller decides how to report
   * it. Nothing is remembered as recent unless the open actually succeeded.
   */
  async openPath(filePath: string): Promise<FileTruthOpenReplyV1> {
    const resolved = path.resolve(filePath);
    const existing = this.documents.get(resolved);
    if (existing) {
      this.activate(resolved);
      return existing.opened;
    }

    if (this.documents.size >= MAX_TABS) {
      throw new Error('Too many documents are open. Close one before opening another.');
    }

    const store = this.createStore();
    let opened: FileTruthOpenReplyV1;
    try {
      opened = await store.open(resolved);
    } catch (cause) {
      // The store never became usable, so it must not be left holding handles.
      store.close();
      throw cause;
    }

    this.documents.set(resolved, { store, opened });
    this.activePath = resolved;
    await this.recent.remember(opened.path);
    this.logger.log('workspace_document_opened', {
      hasRecovery: opened.recovery !== null,
      openCount: this.documents.size,
    });
    this.publish(opened);
    this.publishTabs();
    this.applyWindowTitle(opened.path);
    return opened;
  }

  /** Bring an already open document to the front. */
  activate(filePath: string): FileTruthOpenReplyV1 | null {
    const resolved = path.resolve(filePath);
    const document = this.documents.get(resolved);
    if (!document) return null;

    this.activePath = resolved;
    this.publish(document.opened);
    this.publishTabs();
    this.applyWindowTitle(resolved);
    return document.opened;
  }

  /**
   * Close a document and release its store.
   *
   * The neighbour to the left becomes active, which is what every tabbed editor
   * does and what the eye expects. Closing the last tab leaves the empty state
   * rather than quitting, so an accidental close is not destructive.
   */
  close(filePath: string): void {
    const resolved = path.resolve(filePath);
    const document = this.documents.get(resolved);
    if (!document) return;

    const order = [...this.documents.keys()];
    const index = order.indexOf(resolved);
    document.store.close();
    this.documents.delete(resolved);

    if (this.activePath === resolved) {
      const neighbour = order[index - 1] ?? order[index + 1] ?? null;
      this.activePath = neighbour && this.documents.has(neighbour) ? neighbour : null;
    }

    const next = this.activePath ? this.documents.get(this.activePath) : null;
    if (next) {
      this.publish(next.opened);
      this.applyWindowTitle(next.opened.path);
    } else {
      this.publishClosed();
      this.applyEmptyTitle();
    }
    this.publishTabs();
  }

  /** Release every store, for shutdown. */
  closeAll(): void {
    for (const document of this.documents.values()) document.store.close();
    this.documents.clear();
    this.activePath = null;
  }

  /** Ask the user for a file. Returns null when the dialog is dismissed. */
  async openWithDialog(): Promise<FileTruthOpenReplyV1 | null> {
    const window = this.getWindow();
    const result = window
      ? await dialog.showOpenDialog(window, this.openOptions())
      : await dialog.showOpenDialog(this.openOptions());
    if (result.canceled || result.filePaths.length === 0) return null;

    let last: FileTruthOpenReplyV1 | null = null;
    for (const filePath of result.filePaths) last = await this.openPath(filePath);
    return last;
  }

  /**
   * Ask the user for a folder to show in the sidebar.
   *
   * The chosen folder becomes the boundary for every later listing, so a
   * dismissed dialog leaves the previous one in place rather than clearing it.
   */
  async openFolderWithDialog(): Promise<WorkspaceFolderEventV1> {
    const window = this.getWindow();
    const options = {
      title: 'Open a folder',
      properties: ['openDirectory', 'createDirectory'] as ('openDirectory' | 'createDirectory')[],
    };
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || result.filePaths.length === 0) return this.folderEvent();

    return this.adoptFolder(path.resolve(result.filePaths[0]));
  }

  /**
   * Switch to a folder already known to be one, without the dialog.
   *
   * The recent list is the caller, and it only ever names a folder this app
   * opened before. It is still resolved and checked, because a folder can be
   * renamed or removed between one launch and the next and the honest answer
   * then is to leave the current one alone.
   */
  async openFolderPath(target: string): Promise<WorkspaceFolderEventV1> {
    const resolved = path.resolve(target);
    try {
      if (!(await stat(resolved)).isDirectory()) return this.folderEvent();
    } catch {
      // Gone since it was last opened. Forgetting it is the recent list's job.
      await this.recentFolders?.forget(resolved);
      return this.folderEvent();
    }
    return this.adoptFolder(resolved);
  }

  private async adoptFolder(root: string): Promise<WorkspaceFolderEventV1> {
    this.folderRoot = root;
    // A new folder invalidates the old index rather than serving it stale.
    this.indexCache = null;
    await this.recentFolders?.remember(root);
    this.logger.log('workspace_folder_opened', {});
    const event = this.folderEvent();
    this.send(WORKSPACE_CHANNELS.folderChanged, event);
    return event;
  }

  /**
   * Show the folder, or the document in front, in the system file manager.
   *
   * The path is taken from this session rather than from the request, so the
   * caller chooses between two things it can already see and cannot name a
   * third. `showItemInFolder` reveals a path by selecting it inside its parent,
   * which is what "reveal" means on every platform that has the idea.
   */
  reveal(target: WorkspaceRevealTargetV1): WorkspaceRevealReplyV1 {
    const path = target === 'folder' ? this.folderRoot : this.activePath;
    if (!path) return { version: NOTO_WORKSPACE_VERSION, revealed: false };
    shell.showItemInFolder(path);
    this.logger.log('workspace_revealed', { target });
    return { version: NOTO_WORKSPACE_VERSION, revealed: true };
  }

  /**
   * Search inside the notes of the current folder.
   *
   * Scans the same index quick open ranks, so the two agree about which files
   * exist and neither can find something the other cannot.
   */
  async searchContent(query: string): Promise<WorkspaceContentReplyV1> {
    const index = await this.fileIndex();
    return searchContent(index.entries, query);
  }

  /** Entries inside a directory of the chosen folder. */
  /**
   * The whole openable file list for the current folder.
   *
   * Cached against the root, because the walk is the expensive part and the
   * renderer asks for it whenever quick open is first used. It is dropped when
   * the folder changes rather than kept warm for a folder nobody is in.
   */
  async fileIndex(): Promise<WorkspaceIndexReplyV1> {
    if (!this.folderRoot) {
      return { version: NOTO_WORKSPACE_VERSION, root: null, entries: [], truncated: false };
    }
    if (this.indexCache?.root === this.folderRoot) return this.indexCache.reply;
    const { entries, truncated } = await buildFileIndex(this.folderRoot);
    const reply: WorkspaceIndexReplyV1 = {
      version: NOTO_WORKSPACE_VERSION, root: this.folderRoot, entries, truncated,
    };
    this.indexCache = { root: this.folderRoot, reply };
    return reply;
  }

  async listFolder(target: string): Promise<{ version: typeof NOTO_WORKSPACE_VERSION; entries: FileTreeEntryV1[] }> {
    if (!this.folderRoot) throw new Error('NO_FOLDER_OPEN: choose a folder first');
    return {
      version: NOTO_WORKSPACE_VERSION,
      entries: await listDirectory(this.folderRoot, path.resolve(target)),
    };
  }

  private folderEvent(): WorkspaceFolderEventV1 {
    return {
      version: NOTO_WORKSPACE_VERSION,
      root: this.folderRoot,
      name: this.folderRoot ? path.basename(this.folderRoot) : null,
    };
  }

  /** Ask the user where to write a copy. Returns null when dismissed. */
  async saveAsWithDialog(): Promise<string | null> {
    const window = this.getWindow();
    const current = this.currentPath;
    const suggested = current
      ? path.join(path.dirname(current), `${path.parse(current).name} copy.md`)
      : 'Untitled.md';
    const options = {
      title: 'Save a copy',
      defaultPath: suggested,
      filters: MARKDOWN_FILTERS,
      properties: ['createDirectory', 'showOverwriteConfirmation'] as const,
    };
    const result = window
      ? await dialog.showSaveDialog(window, { ...options, properties: [...options.properties] })
      : await dialog.showSaveDialog({ ...options, properties: [...options.properties] });
    return result.canceled || !result.filePath ? null : result.filePath;
  }

  /** Re-send the current state, for a renderer that just finished loading. */
  republish(): void {
    const current = this.current;
    if (current) this.publish(current);
    this.publishTabs();
    if (this.folderRoot) this.send(WORKSPACE_CHANNELS.folderChanged, this.folderEvent());
  }

  private openOptions() {
    return {
      title: 'Open a Markdown document',
      filters: MARKDOWN_FILTERS,
      properties: ['openFile', 'multiSelections'] as ('openFile' | 'multiSelections')[],
      defaultPath: this.currentPath ? path.dirname(this.currentPath) : undefined,
    };
  }

  private send(channel: string, payload: unknown): void {
    const window = this.getWindow();
    if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return;
    window.webContents.send(channel, payload);
  }

  private publish(opened: FileTruthOpenReplyV1): void {
    this.send(WORKSPACE_CHANNELS.documentOpened, {
      version: NOTO_WORKSPACE_VERSION,
      opened,
    });
  }

  private publishClosed(): void {
    this.send(WORKSPACE_CHANNELS.documentClosed, { version: NOTO_WORKSPACE_VERSION });
  }

  private publishTabs(): void {
    this.send(WORKSPACE_CHANNELS.tabsChanged, {
      version: NOTO_WORKSPACE_VERSION,
      tabs: this.tabs(),
    });
  }

  private applyWindowTitle(filePath: string): void {
    const window = this.getWindow();
    if (!window || window.isDestroyed()) return;
    window.setTitle(path.basename(filePath));
    // Gives macOS the proxy icon and the standard "edited" dot behaviour.
    window.setRepresentedFilename(filePath);
  }

  private applyEmptyTitle(): void {
    const window = this.getWindow();
    if (!window || window.isDestroyed()) return;
    window.setTitle('Noto');
    window.setRepresentedFilename('');
  }
}
