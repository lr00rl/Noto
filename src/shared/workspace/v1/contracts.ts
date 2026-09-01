/**
 * Workspace: opening, switching and remembering documents.
 *
 * The file-truth contract owns one open document. This one owns which document
 * that is, which is what lets the app open a file from a menu instead of a
 * command line flag.
 *
 * Opens can start in either process: the renderer asks when the user clicks,
 * and main pushes when the user goes through the application menu, the dock, or
 * a file association. Both paths end in the same reply shape, so the renderer
 * has one way to adopt a document.
 */

import type { FileTruthOpenReplyV1 } from '../../file-truth/v1/contracts';

export const NOTO_WORKSPACE_VERSION = 1 as const;

export const WORKSPACE_CHANNELS = {
  openDialog: 'noto:v1:workspace:open-dialog',
  openPath: 'noto:v1:workspace:open-path',
  saveAsDialog: 'noto:v1:workspace:save-as-dialog',
  recent: 'noto:v1:workspace:recent',
  documentOpened: 'noto:v1:workspace:document-opened',
  documentClosed: 'noto:v1:workspace:document-closed',
  tabsChanged: 'noto:v1:workspace:tabs-changed',
  activateTab: 'noto:v1:workspace:activate-tab',
  closeTab: 'noto:v1:workspace:close-tab',
  openFolder: 'noto:v1:workspace:open-folder',
  listFolder: 'noto:v1:workspace:list-folder',
  folderChanged: 'noto:v1:workspace:folder-changed',
  menuCommand: 'noto:v1:workspace:menu-command',
} as const;

/** One entry in the workspace tree. */
export interface WorkspaceEntryV1 {
  readonly name: string;
  readonly path: string;
  readonly kind: 'file' | 'directory';
}

export interface WorkspaceFolderRequestV1 extends WorkspaceRequestV1 {
  /** The directory to list. Main confines it to the chosen root. */
  readonly path: string;
}

export interface WorkspaceFolderReplyV1 {
  readonly version: typeof NOTO_WORKSPACE_VERSION;
  readonly entries: readonly WorkspaceEntryV1[];
}

/** The chosen folder, or null when there is none. */
export interface WorkspaceFolderEventV1 {
  readonly version: typeof NOTO_WORKSPACE_VERSION;
  readonly root: string | null;
  readonly name: string | null;
}

/**
 * One open document.
 *
 * Carries the document id as well as the path because the renderer keys its
 * editors on the id: a tab has to be matched to the editor already holding that
 * document, or switching tabs would rebuild it and lose the user's history.
 */
export interface WorkspaceTabV1 {
  readonly path: string;
  readonly name: string;
  readonly documentId: string;
  readonly active: boolean;
}

export interface WorkspaceTabsEventV1 {
  readonly version: typeof NOTO_WORKSPACE_VERSION;
  readonly tabs: readonly WorkspaceTabV1[];
}

/** Sent when the last document closes, so the renderer returns to empty. */
export interface WorkspaceClosedEventV1 {
  readonly version: typeof NOTO_WORKSPACE_VERSION;
}

export interface WorkspaceRequestV1 {
  readonly version: typeof NOTO_WORKSPACE_VERSION;
  readonly requestId: string;
}

export interface WorkspaceOpenPathRequestV1 extends WorkspaceRequestV1 {
  readonly path: string;
}

/** Activating or closing a tab, both identified by path. */
export interface WorkspaceTabRequestV1 extends WorkspaceRequestV1 {
  readonly path: string;
}

export interface RecentFileV1 {
  readonly path: string;
  readonly name: string;
  /** Epoch milliseconds of the last open, used only for ordering. */
  readonly openedAt: number;
}

export interface WorkspaceRecentReplyV1 {
  readonly version: typeof NOTO_WORKSPACE_VERSION;
  readonly files: readonly RecentFileV1[];
}

/** `null` means the user dismissed the dialog, which is not a failure. */
export type WorkspaceOpenReplyV1 =
  | { readonly version: typeof NOTO_WORKSPACE_VERSION; readonly opened: FileTruthOpenReplyV1 }
  | { readonly version: typeof NOTO_WORKSPACE_VERSION; readonly opened: null };

export interface WorkspaceSaveAsReplyV1 {
  readonly version: typeof NOTO_WORKSPACE_VERSION;
  readonly path: string | null;
}

/**
 * Commands the application menu raises that the renderer has to carry out,
 * because only the renderer knows the editor's current contents.
 */
export type WorkspaceMenuCommandV1 =
  | 'save'
  | 'save-as'
  | 'undo'
  | 'redo'
  | 'settings'
  | 'find'
  | 'find-replace'
  | 'toggle-source'
  | 'toggle-outline'
  | 'command-palette'
  | 'toggle-sidebar';

export interface WorkspaceMenuEventV1 {
  readonly version: typeof NOTO_WORKSPACE_VERSION;
  readonly command: WorkspaceMenuCommandV1;
}

export interface WorkspaceDocumentEventV1 {
  readonly version: typeof NOTO_WORKSPACE_VERSION;
  readonly opened: FileTruthOpenReplyV1;
}

export type WorkspaceResultV1<T> =
  | { readonly ok: true; readonly requestId: string; readonly value: T }
  | {
      readonly ok: false;
      readonly requestId: string;
      readonly error: { readonly code: 'BAD_REQUEST' | 'WORKSPACE_FAILED'; readonly message: string };
    };

export interface NotoWorkspaceApiV1 {
  openDialog(request: WorkspaceRequestV1): Promise<WorkspaceResultV1<WorkspaceOpenReplyV1>>;
  openPath(request: WorkspaceOpenPathRequestV1): Promise<WorkspaceResultV1<WorkspaceOpenReplyV1>>;
  saveAsDialog(request: WorkspaceRequestV1): Promise<WorkspaceResultV1<WorkspaceSaveAsReplyV1>>;
  recent(request: WorkspaceRequestV1): Promise<WorkspaceResultV1<WorkspaceRecentReplyV1>>;
  activateTab(request: WorkspaceTabRequestV1): Promise<WorkspaceResultV1<WorkspaceOpenReplyV1>>;
  closeTab(request: WorkspaceTabRequestV1): Promise<WorkspaceResultV1<WorkspaceTabsEventV1>>;
  openFolder(request: WorkspaceRequestV1): Promise<WorkspaceResultV1<WorkspaceFolderEventV1>>;
  listFolder(request: WorkspaceFolderRequestV1): Promise<WorkspaceResultV1<WorkspaceFolderReplyV1>>;
  onFolderChanged(listener: (event: WorkspaceFolderEventV1) => void): () => void;
  onDocumentOpened(listener: (event: WorkspaceDocumentEventV1) => void): () => void;
  onDocumentClosed(listener: (event: WorkspaceClosedEventV1) => void): () => void;
  onTabsChanged(listener: (event: WorkspaceTabsEventV1) => void): () => void;
  onMenuCommand(listener: (event: WorkspaceMenuEventV1) => void): () => void;
}
