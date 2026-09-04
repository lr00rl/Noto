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
  /** The folder open right now, for a renderer that has just subscribed:
   *  a folder named on the command line opens before the page can listen. */
  folder: 'noto:v1:workspace:folder',
  menuCommand: 'noto:v1:workspace:menu-command',
  pasteText: 'noto:v1:workspace:paste-text',
  noteLinks: 'noto:v1:workspace:note-links',
  /** The whole openable file list for the current folder, sent once per
   *  folder so ranking can happen in the renderer without a round trip. */
  fileIndex: 'noto:v1:workspace:file-index',
  recentFolders: 'noto:v1:workspace:recent-folders',
  openRecentFolder: 'noto:v1:workspace:open-recent-folder',
  reveal: 'noto:v1:workspace:reveal',
  openExternal: 'noto:v1:workspace:open-external',
  newFile: 'noto:v1:workspace:new-file',
  treeMenu: 'noto:v1:workspace:tree-menu',
  searchContent: 'noto:v1:workspace:search-content',
  /** Rename, duplicate, trash or make a folder. See `WorkspaceEntryActionV1`. */
  manageEntry: 'noto:v1:workspace:manage-entry',
  /** Push: something in the tree moved, so a listing on screen is stale. */
  treeChanged: 'noto:v1:workspace:tree-changed',
  /** Push: the reader chose Rename, so the row should offer a field. */
  renameRow: 'noto:v1:workspace:rename-row',
  /** The renderer hands over the drawn document so main can write or print it. */
  exportRendered: 'noto:v1:workspace:export-rendered',
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
  /**
   * Whether the reader asked for this folder, rather than it arriving with a
   * note opened on its own. Only a folder that was asked for shows the tree;
   * the other kind would open the rail against the reader's own setting.
   */
  readonly chosen: boolean;
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
  /**
   * A counter that rises each time this document is brought forward.
   *
   * Not a clock: nothing here needs to know when, only which came after which,
   * and a counter cannot be made to go backwards by the machine's clock moving.
   * The list itself stays in the order the documents were opened, because that
   * is the order the neighbour is chosen from when one is closed.
   */
  readonly activatedAt: number;
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
/**
 * Every command the menu can send the renderer.
 *
 * A value rather than a bare type union, because the preload has to check an
 * incoming command against something at runtime and it was checking against a
 * hand-copied list. The two drifted: `widen` and `narrow` reached the menu, the
 * validator did not know them, and the items fired into a dropped message. One
 * list means the type and the check cannot disagree again.
 */
export const WORKSPACE_MENU_COMMANDS = [
  'save',
  'save-as',
  'undo',
  'redo',
  'settings',
  'find',
  'find-replace',
  'find-next',
  'find-previous',
  'toggle-source',
  'source-code-mode',
  'select-word',
  'select-line',
  'jump-to-selection',
  'select-scope',
  'insert-comment',
  'indent-more',
  'indent-less',
  'block-paragraph',
  'block-heading-1',
  'block-heading-2',
  'block-heading-3',
  'block-heading-4',
  'block-heading-5',
  'block-heading-6',
  'block-heading-up',
  'block-heading-down',
  'block-code',
  'block-math',
  'block-quote',
  'block-ordered-list',
  'block-bullet-list',
  'block-task-list',
  'task-toggle',
  'task-complete',
  'task-incomplete',
  'block-rule',
  'mark-underline',
  'mark-highlight',
  'mark-math',
  'table-insert',
  'table-align-left',
  'table-align-center',
  'table-align-right',
  'table-align-none',
  'table-row-above',
  'table-row-below',
  'table-column-before',
  'table-column-after',
  'table-row-delete',
  'table-column-delete',
  'table-delete',
  'table-prettify',
  'table-copy',
  'move-up',
  'move-down',
  'move-column-left',
  'move-column-right',
  'insert-link',
  'insert-image',
  'insert-footnote',
  'insert-toc',
  'insert-frontmatter',
  'insert-link-reference',
  'reload-from-disk',
  'toggle-always-on-top',
  'toggle-read-only',
  'copy-as-markdown',
  'copy-as-html',
  'copy-as-plain',
  'line-endings-lf',
  'line-endings-crlf',
  'toggle-final-newline',
  'export-pdf',
  'export-html',
  'export-html-plain',
  'export-docx',
  'export-odt',
  'export-rtf',
  'export-epub',
  'export-latex',
  'export-mediawiki',
  'export-rst',
  'export-textile',
  'export-opml',
  'new-file',
  'mark-strong',
  'mark-emphasis',
  'mark-code',
  'mark-strike',
  'clear-format',
  'block-alert-note',
  'block-alert-tip',
  'block-alert-important',
  'block-alert-warning',
  'block-alert-caution',
  'toggle-focus-mode',
  'toggle-typewriter',
  'toggle-outline',
  'command-palette',
  'toggle-sidebar',
  'widen',
  'narrow',
  'quick-open',
  'reveal-document',
  'search-content',
  'navigate-back',
  'navigate-forward',
] as const;

export type WorkspaceMenuCommandV1 = typeof WORKSPACE_MENU_COMMANDS[number];

/**
 * What to show in the system file manager.
 *
 * A kind rather than a path. Main already knows which folder is open and which
 * document is in front, so the renderer never names a location and a compromised
 * one cannot point this at somewhere it was not already looking. The whole
 * capability is then "open the file manager at something this window is already
 * showing you", which is small enough to reason about.
 */
export type WorkspaceRevealTargetV1 = 'folder' | 'document';

export interface WorkspaceRevealRequestV1 extends WorkspaceRequestV1 {
  readonly target: WorkspaceRevealTargetV1;
}

export interface WorkspaceRevealReplyV1 {
  readonly version: typeof NOTO_WORKSPACE_VERSION;
  /** False when there was nothing of that kind to show. */
  readonly revealed: boolean;
}

/**
 * A link the reader followed out of a note.
 *
 * The scheme is checked here and again in main. The renderer is the least
 * trusted side of this application and the URL comes out of somebody's file,
 * so `shell.openExternal` must never see a string this side has only glanced
 * at: it hands the URL to the operating system, which will open far more than
 * a browser if the scheme asks it to.
 */
export interface WorkspaceOpenExternalRequestV1 extends WorkspaceRequestV1 {
  readonly url: string;
}

export interface WorkspaceOpenExternalReplyV1 {
  readonly version: typeof NOTO_WORKSPACE_VERSION;
  /** False when the scheme was not one this opens. */
  readonly opened: boolean;
}

/**
 * Make a new note.
 *
 * The renderer names no path. Where the note goes is main's decision, taken
 * from the folder that is open, and the name is the first free one there. A
 * request that could name its own path would be a request to write anywhere
 * the application can reach.
 */
export interface WorkspaceNewFileReplyV1 {
  readonly version: typeof NOTO_WORKSPACE_VERSION;
  readonly created: boolean;
  /** Absent when there was nowhere to put it. */
  readonly path: string | null;
}

/**
 * Show the menu for a row of the file tree.
 *
 * The renderer names the row it was pressed on and main draws the menu, so
 * every action on it runs where the filesystem is. The path is re-resolved and
 * checked against the open folder before anything is shown: a renderer that
 * named a path outside it gets nothing.
 */
export interface WorkspaceTreeMenuRequestV1 extends WorkspaceRequestV1 {
  readonly path: string;
  readonly kind: 'file' | 'directory';
}

export interface WorkspaceTreeMenuReplyV1 {
  readonly version: typeof NOTO_WORKSPACE_VERSION;
  /**
   * Whether the row was one main will draw a menu for. The answer is sent
   * before the menu opens, because a native menu holds the input loop until
   * it is dismissed and a reply behind it would not arrive until then.
   */
  readonly accepted: boolean;
}

/** One line of a file that holds the query. */
/**
 * The four things a row of the tree can have done to it.
 *
 * One channel rather than four, because all four take a target and at most a
 * name, and the difference between them is a decision main makes rather than a
 * different shape of message. The action is checked against this list on both
 * sides, so an unknown one is refused rather than falling through to a default.
 */
export const ENTRY_ACTIONS = ['rename', 'duplicate', 'trash', 'new-folder', 'move', 'move-into'] as const;

export type WorkspaceEntryActionV1 = (typeof ENTRY_ACTIONS)[number];

export interface WorkspaceEntryRequestV1 extends WorkspaceRequestV1 {
  readonly action: WorkspaceEntryActionV1;
  /** The row acted on. For `new-folder`, the folder to make one inside. */
  readonly target: string;
  /**
   * One name segment, never a path.
   *
   * Required for `rename` and `new-folder`, absent for the other two. Main
   * joins it to a parent it resolved itself, so the renderer cannot name a
   * destination even by accident.
   */
  readonly name: string | null;
  /**
   * The folder something is dropped into, for `move-into`, and null for
   * every other action.
   *
   * The renderer names it because the tree is what was dragged onto, and
   * main resolves it against the open folder exactly as it resolves the
   * target: a path from the renderer is a request, never an authority.
   */
  readonly destination: string | null;
}

/** Why an action did nothing. Each one is a sentence the reader can act on. */
export type WorkspaceEntryRefusalV1 =
  | 'no-folder'
  | 'outside-root'
  | 'bad-name'
  | 'exists'
  | 'unsaved-changes'
  | 'busy'
  | 'trash-failed'
  | 'into-itself'
  | 'failed';

export type WorkspaceEntryReplyV1 =
  | {
      readonly version: typeof NOTO_WORKSPACE_VERSION;
      readonly done: true;
      /** Where the entry ended up, so the tree can reveal it. */
      readonly path: string;
    }
  | {
      readonly version: typeof NOTO_WORKSPACE_VERSION;
      readonly done: false;
      readonly reason: WorkspaceEntryRefusalV1;
    };

/**
 * Asks the tree to put a field on one row.
 *
 * The name is typed where the row is, not in a dialog, because the row is
 * where the reader is looking and a dialog would hide the neighbours whose
 * names are the reason they are renaming this one.
 */
export interface WorkspaceRenameRowEventV1 {
  readonly version: typeof NOTO_WORKSPACE_VERSION;
  /** For `rename`, the row to rename. For `new-folder`, the folder to make one in. */
  readonly path: string;
  readonly intent: 'rename' | 'new-folder';
}

/**
 * Everything the File menu can write a note out as.
 *
 * `pdf`, `html` and `html-plain` are how Noto draws the note, so they carry the
 * renderer's own markup. The rest are conversions of the markdown, which Pandoc
 * reads from the file on disk and which therefore need the note saved first.
 */
export const EXPORT_KINDS = [
  'pdf', 'html', 'html-plain',
  'docx', 'odt', 'rtf', 'epub', 'latex', 'mediawiki', 'rst', 'textile', 'opml',
] as const;

export type WorkspaceExportKindV1 = (typeof EXPORT_KINDS)[number];

export interface WorkspaceExportRequestV1 extends WorkspaceRequestV1 {
  readonly target: WorkspaceExportKindV1;
  /**
   * The document's body, serialized by the editor from its own schema, or null
   * for a target Pandoc converts from the file instead.
   */
  readonly html: string | null;
  /** The note's name without its extension, used as the page's title. */
  readonly title: string;
  /**
   * Whether the note has changes that have not been written.
   *
   * Sent from the renderer because that is where the knowledge lives, and used
   * to refuse a Pandoc export outright: it converts the file, so exporting a
   * note with unsaved work would produce a document of the last saved version
   * while the reader was looking at a newer one.
   */
  readonly dirty: boolean;
}

export type WorkspaceExportReplyV1 =
  | { readonly version: typeof NOTO_WORKSPACE_VERSION; readonly exported: true; readonly path: string }
  | {
      readonly version: typeof NOTO_WORKSPACE_VERSION;
      readonly exported: false;
      readonly reason: 'no-document' | 'unsaved' | 'cancelled' | 'no-pandoc' | 'failed';
    };

export interface WorkspaceContentLineV1 {
  readonly line: string;
  readonly lineNumber: number;
  /** Where the query starts within `line`, for highlighting. */
  readonly column: number;
  /** How many characters the match runs for, from `column`. */
  readonly length: number;
}

/** One note containing the query, with a few of the lines that do. */
export interface WorkspaceContentMatchV1 {
  readonly path: string;
  readonly name: string;
  readonly relativePath: string;
  /** Times the query appears in the whole file, which is what ranks it. */
  readonly occurrences: number;
  readonly lines: readonly WorkspaceContentLineV1[];
}

export interface WorkspaceContentRequestV1 extends WorkspaceRequestV1 {
  readonly query: string;
  /** The find bar's three switches, meaning the same thing here. */
  readonly caseSensitive: boolean;
  readonly wholeWord: boolean;
  readonly regex: boolean;
}

export interface WorkspaceContentReplyV1 {
  readonly version: typeof NOTO_WORKSPACE_VERSION;
  readonly matches: readonly WorkspaceContentMatchV1[];
  /** Files actually read, so the box can say how much it looked at. */
  readonly scanned: number;
  /** More files matched than are reported. */
  readonly truncated: boolean;
  /** The scan hit its time budget and stopped early. */
  readonly timedOut: boolean;
  /** True when the query was an expression that does not parse; nothing was searched. */
  readonly invalidPattern: boolean;
}

/** The longest a query may be. Past this it is not a search, it is a paste. */
export const MAX_CONTENT_QUERY = 200;

/** One openable file, as the search index carries it. */
export interface WorkspaceIndexEntryV1 {
  readonly path: string;
  readonly name: string;
  /** Relative to the workspace root, always with forward slashes. */
  readonly relativePath: string;
}

export interface WorkspaceIndexReplyV1 {
  readonly version: 1;
  readonly root: string | null;
  readonly entries: readonly WorkspaceIndexEntryV1[];
  /** A ceiling stopped the walk, so the index is partial and says so. */
  readonly truncated: boolean;
}

export interface WorkspaceMenuEventV1 {
  readonly version: typeof NOTO_WORKSPACE_VERSION;
  readonly command: WorkspaceMenuCommandV1;
}

/**
 * The clipboard's text, sent by main when Paste as Plain Text is chosen.
 *
 * Main reads the clipboard and sends the text, rather than the renderer
 * asking for it, so the renderer can never read the clipboard on its own:
 * the text arrives only because the reader chose the command.
 */
export interface WorkspacePasteEventV1 {
  readonly version: typeof NOTO_WORKSPACE_VERSION;
  readonly text: string;
}

/** The most text a paste carries; past this it is a file, not a paste. */
export const MAX_PASTE_TEXT = 8 * 1024 * 1024;

/** One note the vault's graph names, as a place to go. */
export interface WorkspaceLinkV1 {
  readonly path: string;
  readonly relativePath: string;
  readonly title: string;
}

/**
 * What the vault's note-assistant graph knows about one note.
 *
 * `available` is false when the vault has no graph; `known` is false when
 * it has one that has not met this note. The lists are empty in both cases,
 * and the renderer says which of the two it is.
 */
export interface WorkspaceLinksReplyV1 {
  readonly version: typeof NOTO_WORKSPACE_VERSION;
  readonly available: boolean;
  readonly known: boolean;
  readonly generatedAt: string | null;
  readonly backlinks: readonly WorkspaceLinkV1[];
  readonly links: readonly WorkspaceLinkV1[];
  readonly related: readonly WorkspaceLinkV1[];
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
  onPasteText(listener: (event: WorkspacePasteEventV1) => void): () => void;
  /**
   * The path of a file the reader dropped in, which the renderer may not
   * work out for itself. Empty when the browser has no file behind it.
   */
  pathForFile(file: File): string;
  /** The graph's lists for the note at `path`; the request is the folder request, a path. */
  noteLinks(request: WorkspaceFolderRequestV1): Promise<WorkspaceResultV1<WorkspaceLinksReplyV1>>;
  fileIndex(request: WorkspaceRequestV1): Promise<WorkspaceResultV1<WorkspaceIndexReplyV1>>;
  recentFolders(request: WorkspaceRequestV1): Promise<WorkspaceResultV1<WorkspaceRecentReplyV1>>;
  openRecentFolder(request: WorkspaceOpenPathRequestV1): Promise<WorkspaceResultV1<WorkspaceFolderEventV1>>;
  folder(request: WorkspaceRequestV1): Promise<WorkspaceResultV1<WorkspaceFolderEventV1>>;
  reveal(request: WorkspaceRevealRequestV1): Promise<WorkspaceResultV1<WorkspaceRevealReplyV1>>;
  openExternal(request: WorkspaceOpenExternalRequestV1): Promise<WorkspaceResultV1<WorkspaceOpenExternalReplyV1>>;
  newFile(request: WorkspaceRequestV1): Promise<WorkspaceResultV1<WorkspaceNewFileReplyV1>>;
  treeMenu(request: WorkspaceTreeMenuRequestV1): Promise<WorkspaceResultV1<WorkspaceTreeMenuReplyV1>>;
  searchContent(request: WorkspaceContentRequestV1): Promise<WorkspaceResultV1<WorkspaceContentReplyV1>>;
  manageEntry(request: WorkspaceEntryRequestV1): Promise<WorkspaceResultV1<WorkspaceEntryReplyV1>>;
  exportRendered(request: WorkspaceExportRequestV1): Promise<WorkspaceResultV1<WorkspaceExportReplyV1>>;
  onTreeChanged(listener: () => void): () => void;
  onRenameRow(listener: (event: WorkspaceRenameRowEventV1) => void): () => void;
}
