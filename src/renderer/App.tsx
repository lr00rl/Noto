/**
 * The Noto application shell.
 *
 * One shell. The build previously carried two, `G001App` and `FileTruthApp`,
 * chosen at runtime by a bootstrap flag, with the first still wired to a
 * single-paragraph editing spike. That fork is gone along with the test-only
 * controls it hosted.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  FileTruthOpenReplyV1,
  FileTruthRecoveryRecordV1,
  FileTruthSaveOutcomeV1,
  FileTruthSaveTokenV1,
  NotoPlatform,
} from '../shared/file-truth/v1/contracts';
import type {
  RecentFileV1, WorkspaceIndexEntryV1, WorkspaceTabV1,
} from '../shared/workspace/v1/contracts';
import { QuickOpen, type QuickOpenMode } from './QuickOpen';
import {
  pruneStore, recordOpen, searchBoost, type FrecencyStoreV1,
} from '../shared/search/v1/frecency';
import type { NotoDocumentWire } from '../shared/markdown/v3/contracts';
import { outlineOf } from './outline';
import { PLUGIN_LIFECYCLE_VERSION, type PluginLifecycleSnapshot } from '../shared/plugins/lifecycle';
import { rendererProofManifest } from '../shared/plugins/proof-manifests';
import {
  filesystemProofManifest,
  markdownPaddingManifest,
  titleShiftManifest,
} from '../shared/plugins/proof-manifests';
import { declaredHotkeys, matchHotkey } from './plugins/hotkeys';
import { NotoCanvas } from './editor/noto/NotoCanvas';
import { FindBar } from './FindBar';
import { RecentStrip } from './RecentStrip';
import { WorkspaceRail, type RailView } from './WorkspaceRail';
import { RailFooter } from './RailFooter';
import { Preferences, type PreferencesSection } from './Preferences';
import { DEFAULT_SETTINGS, stepWidthMode, type NotoSettingsV1 } from '../shared/settings/v1/contracts';
import type { NotoEditor } from './editor/noto/NotoEditor';
import {
  acceptedSaveOutcome,
  actionableFileTruthMessage,
  fileTruthActions,
  outcomeHasRecoveryEvidence,
  presentFileTruthOutcome,
  type FileTruthUiState,
} from './file-truth-state';
import { RendererPluginHost } from './plugins/RendererPluginHost';
import { createRendererPluginHosts } from './plugins/bundled/hosts';
import { RendererPluginClient } from './plugins/RendererPluginClient';
import { PluginCenter } from './plugins/PluginCenter';
import { createPluginSnapshotStream } from './plugins/plugin-snapshot-stream';
import { restorePluginTriggerFocus, type PluginSnapshotAvailability } from './plugins/plugin-center-state';

const rid = (prefix: string) => `${prefix}:${crypto.randomUUID()}`;

/**
 * The user's stylesheet. One sheet, replaced in place, so a theme reloaded
 * twenty times does not leave twenty sheets adopted.
 *
 * Built on first use rather than at module scope: this file is imported by unit
 * tests that read it in Node, where `CSSStyleSheet` does not exist, and a
 * constructor at the top level would make importing the shell fail there.
 */
let customThemeSheet: CSSStyleSheet | null = null;
const themeSheet = (): CSSStyleSheet => (customThemeSheet ??= new CSSStyleSheet());

const bundledManifestList = [
  rendererProofManifest,
  titleShiftManifest,
  markdownPaddingManifest,
  filesystemProofManifest,
];

const bundledManifests = new Map<string, { name: string; commands: readonly { id: string; title: string }[] }>(
  bundledManifestList.map((manifest) => [manifest.id, manifest]),
);

const declaredPluginHotkeys = declaredHotkeys(bundledManifestList);

const manifestHotkeyFor = (event: KeyboardEvent): string | null =>
  matchHotkey(event, declaredPluginHotkeys);

type UiState = 'Opening' | 'No document' | FileTruthUiState;

const durableRecoveryAttention =
  'A durable recovery record needs attention before this document can be clean.';

export function exceptionalAlertPresentation(
  recoveryBarrier: boolean,
  outcome: FileTruthSaveOutcomeV1 | null,
  localMessage: string | null,
): { message: string } | null {
  if (outcome && outcome.status !== 'saved') return { message: outcome.message };
  if (localMessage) return { message: localMessage };
  if (recoveryBarrier) return { message: durableRecoveryAttention };
  return null;
}

/**
 * Everything the shell tracks for one open document.
 *
 * Per document rather than per window, because each tab has its own accepted
 * revision and its own save token. Sharing one set of these across tabs would
 * mean saving one document against another's token, which the store would
 * rightly refuse.
 */
interface OpenDocumentState {
  readonly opened: FileTruthOpenReplyV1;
  readonly document: NotoDocumentWire;
  readonly token: FileTruthSaveTokenV1 | null;
  readonly outcome: FileTruthSaveOutcomeV1 | null;
  readonly recovery: FileTruthRecoveryRecordV1 | null;
  readonly dirty: boolean;
  readonly state: UiState;
  readonly cleanState: 'Opened' | 'Saved';
}

function NotoWorkspace({ platform }: { platform: NotoPlatform }) {
  const [docs, setDocs] = useState<ReadonlyMap<string, OpenDocumentState>>(new Map());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [tabs, setTabs] = useState<readonly WorkspaceTabV1[]>([]);
  /** Status shown when no document is open, so it has nowhere per-document to live. */
  const [shellState, setShellState] = useState<UiState>('Opening');
  const activeIdRef = useRef<string | null>(null);
  activeIdRef.current = activeId;

  const active = activeId ? docs.get(activeId) ?? null : null;
  const opened = active?.opened ?? null;
  const document = active?.document ?? null;
  const token = active?.token ?? null;
  const state: UiState = active?.state ?? shellState;

  const patchDoc = useCallback((id: string, patch: Partial<OpenDocumentState>) => {
    setDocs((current) => {
      const existing = current.get(id);
      if (!existing) return current;
      const next = new Map(current);
      next.set(id, { ...existing, ...patch });
      return next;
    });
  }, []);

  /** Route a status update to the active document, or to the empty shell. */
  const setState = useCallback((value: UiState) => {
    const id = activeIdRef.current;
    if (id) patchDoc(id, { state: value });
    else setShellState(value);
  }, [patchDoc]);

  const editorDirty = active?.dirty ?? false;
  const editorDirtyRef = useRef(false);
  const [pending, setPending] = useState(false);
  const [recoveryBarrier, setRecoveryBarrier] = useState(false);
  const recoveryBarrierRef = useRef(false);
  const outcome = active?.outcome ?? null;
  const recoveryRecord = active?.recovery ?? null;
  const [localMessage, setLocalMessage] = useState<string | null>(null);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [prefs, setPrefs] = useState<{ open: boolean; section: PreferencesSection }>(
    { open: false, section: 'appearance' },
  );
  /** Bumped to re-read a stylesheet whose contents changed but whose path did not. */
  const [themeReload, setThemeReload] = useState(0);
  const [themeProblem, setThemeProblem] = useState('');
  const [pluginSnapshots, setPluginSnapshots] = useState<PluginLifecycleSnapshot[]>([]);
  const [pluginAvailability, setPluginAvailability] = useState<PluginSnapshotAvailability>('loading');
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [recent, setRecent] = useState<readonly RecentFileV1[]>([]);
  useEffect(() => {
    setFrecency((current) => {
      let next = current;
      // Recent entries carry their own timestamp, so a fresh window starts with
      // real history rather than with everything looking equally cold.
      for (const file of recent) {
        if (next[file.path]) continue;
        next = { ...next, [file.path]: { path: file.path, count: 1, lastOpenedAt: file.openedAt } };
      }
      return next;
    });
  }, [recent]);
  const [openError, setOpenError] = useState<string | null>(null);
  /**
   * The navigation rail: one region, two views.
   *
   * Files and Outline were separate booleans opening separate columns, so
   * wanting both spent two panels' width on navigation. They answer the same
   * question and now take turns in one region.
   */
  const [rail, setRail] = useState<{ open: boolean; view: RailView }>({ open: false, view: 'files' });
  const [settings, setSettings] = useState<NotoSettingsV1>(DEFAULT_SETTINGS);
  /* The menu handler is registered once, so it would otherwise close over the
     settings as they were at launch and step the width from 66 every time. */
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const [folder, setFolder] = useState<{ root: string | null; name: string | null }>({ root: null, name: null });
  const [quickOpen, setQuickOpen] = useState<{ open: boolean; mode: QuickOpenMode }>(
    { open: false, mode: 'name' },
  );
  const [recentFolders, setRecentFolders] = useState<readonly RecentFileV1[]>([]);
  const [folderMenu, setFolderMenu] = useState(false);
  /* The editor is constructed once per document and keeps the callbacks it was
     given, so a handler that closes over state has to be reached through a ref
     or it answers with whatever that state was at construction. Following a
     link resolved against an empty index for exactly this reason. */
  const followWikiLinkRef = useRef<(target: string) => void>(() => {});
  /** A content-search query waiting for its document to arrive. */
  const pendingMatchRef = useRef<string | null>(null);
  const ensureFileIndexRef = useRef<() => Promise<void>>(async () => {});
  const refreshRecentFoldersRef = useRef<() => void>(() => {});
  const [fileIndex, setFileIndex] = useState<{
    entries: readonly WorkspaceIndexEntryV1[]; truncated: boolean;
  }>({ entries: [], truncated: false });
  /**
   * How often and how recently each file is opened.
   *
   * Kept in the renderer and seeded from the recent list main already persists,
   * rather than given a store of its own. A second persisted file would be a
   * second thing to migrate and to keep in step with the first, for a ranking
   * signal that is allowed to be approximate.
   */
  const [frecency, setFrecency] = useState<FrecencyStoreV1>({});

  const editorsRef = useRef<Map<string, NotoEditor>>(new Map());
  /** Always the editor of the document in front, so call sites stay unchanged. */
  const editorRef = useRef<NotoEditor | null>(null);
  const pluginHostRef = useRef<ReadonlyMap<string, RendererPluginHost> | null>(null);
  const pluginClientRef = useRef<RendererPluginClient | null>(null);
  const pluginsButtonRef = useRef<HTMLButtonElement>(null);
  /** Show a rail view, opening the rail if it is closed, and close it when the
   *  view being asked for is already the one showing. */
  const toggleRail = useCallback((view: RailView) => {
    setRail((current) => (current.open && current.view === view
      ? { open: false, view }
      : { open: true, view }));
  }, []);
  const openPreferences = useCallback((section: PreferencesSection) => {
    setPrefs((current) => (current.open && current.section === section
      ? { open: false, section }
      : { open: true, section }));
  }, []);
  const [find, setFind] = useState<{ open: boolean; replace: boolean; query?: string }>(
    { open: false, replace: false },
  );
  const cleanStateRef = useRef<'Opened' | 'Saved'>('Opened');
  const dirtyDocumentIds = useMemo(
    () => new Set([...docs.values()].filter((doc) => doc.dirty).map((doc) => doc.document.documentId)),
    [docs],
  );
  if (!pluginHostRef.current) pluginHostRef.current = createRendererPluginHosts();

  const pluginSnapshot = pluginSnapshots.find((snapshot) => snapshot.id === rendererProofManifest.id);
  const filename = useMemo(() => opened?.path.split(/[\\/]/).at(-1) ?? 'No document', [opened]);
  // The containing folder, shortened to a leading tilde inside the home
  // directory, which is where documents nearly always are and where the
  // absolute prefix is pure noise.
  const containingFolder = useMemo(() => {
    if (!opened) return '';
    // Cut at the last separator rather than splitting and rejoining. Rejoining
    // on '/' would rewrite a Windows path into a shape the platform does not
    // use, and would leave it unable to match a home directory spelled with
    // backslashes, so the shortening below would never fire there.
    const cut = Math.max(opened.path.lastIndexOf('/'), opened.path.lastIndexOf('\\'));
    const directory = cut > 0 ? opened.path.slice(0, cut) : opened.path;
    const home = window.notoPlatform?.home;
    return home && directory.startsWith(home) ? `~${directory.slice(home.length)}` : directory;
  }, [opened]);

  const updateRecoveryBarrier = (value: boolean) => {
    recoveryBarrierRef.current = value;
    setRecoveryBarrier(value);
  };

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const resolved = settings.theme === 'system' ? (media.matches ? 'dark' : 'light') : settings.theme;
      setTheme(resolved);
      globalThis.document.documentElement.dataset.theme = resolved;
      globalThis.document.documentElement.style.colorScheme = resolved;
    };
    apply();
    // Following the system means reacting when it changes, not only at launch.
    if (settings.theme !== 'system') return;
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [settings.theme]);

  /**
   * Document typography as custom properties on the root, and the page width
   * as an attribute.
   *
   * Size and leading are numbers the reader owns, so they go in as values. The
   * width is a mode, because the pixels it resolves to depend on the canvas,
   * and the stylesheet is the one place that knows the canvas: it computes
   * each mode as a share of the width beside the rail, capped, and never more
   * than the canvas itself. See `WIDTH_MODES`.
   */
  useEffect(() => {
    const root = globalThis.document.documentElement;
    root.style.setProperty('--doc-font-size', `${settings.fontSize}px`);
    root.style.setProperty('--doc-line-height', `${settings.lineHeight}`);
    root.dataset.widthMode = settings.widthMode;
  }, [settings.fontSize, settings.lineHeight, settings.widthMode]);

  /**
   * The user's own stylesheet, layered over the theme.
   *
   * Injected as a single style element that is replaced wholesale on every
   * change, because a stylesheet appended twice is a stylesheet that fights
   * itself. Main reads the file; the renderer never touches the filesystem.
   */
  useEffect(() => {
    const root = globalThis.document;
    let active = true;
    /*
     * A constructed stylesheet, not a `<style>` element.
     *
     * The renderer's Content Security Policy is `style-src 'self'`, which
     * refuses an inline style element outright: the element appears in the DOM
     * and the browser simply declines to apply it, which is a failure with no
     * symptom except the theme not working. A stylesheet built by script is not
     * parsed from markup and is not covered by that directive, so the policy
     * stays exactly as strict as it was. Adopted sheets also come last in the
     * cascade, which is half of why a custom theme can override anything.
     */
    const apply = (css: string) => {
      if (!active) return;
      const sheet = themeSheet();
      const sheets = root.adoptedStyleSheets.filter((existing) => existing !== sheet);
      if (!css) { root.adoptedStyleSheets = sheets; return; }
      try {
        sheet.replaceSync(css);
      } catch {
        setThemeProblem('That stylesheet could not be parsed.');
        root.adoptedStyleSheets = sheets;
        return;
      }
      root.adoptedStyleSheets = [...sheets, sheet];
    };
    if (!settings.customCssPath) { apply(''); return () => { active = false; }; }
    void window.notoSettings.readThemeCss({ version: 1, requestId: rid('theme-css') })
      .then((result) => {
        if (!active) return;
        apply(result.ok ? result.value.css : '');
        setThemeProblem(result.ok ? result.value.problem : 'The stylesheet could not be read.');
      })
      .catch(() => { apply(''); setThemeProblem('The stylesheet could not be read.'); });
    return () => { active = false; };
  }, [settings.customCssPath, themeReload]);

  // Read once at startup, then follow any change main publishes.
  useEffect(() => {
    let active = true;
    void window.notoSettings.read({ version: 1, requestId: rid('settings-read') })
      .then((result) => {
        if (!active || !result.ok) return;
        setSettings(result.value.settings);
        if (result.value.settings.sidebarOnLaunch) setRail({ open: true, view: 'files' });
      });
    const unsubscribe = window.notoSettings.onChanged((event) => {
      if (active) setSettings(event.settings);
    });
    return () => { active = false; unsubscribe(); };
  }, []);

  const changeSettings = useCallback((patch: Partial<NotoSettingsV1>) => {
    // Applied locally at once so the control responds, then confirmed by main,
    // which is the value that survives a restart.
    setSettings((current) => ({ ...current, ...patch }));
    void window.notoSettings.write({ version: 1, requestId: rid('settings-write'), patch })
      .then((result) => { if (result.ok) setSettings(result.value.settings); });
  }, []);

  useEffect(() => {
    const client = new RendererPluginClient(pluginHostRef.current!, window.notoDesktop.plugins);
    pluginClientRef.current = client;
    const stream = createPluginSnapshotStream(setPluginSnapshots);
    let active = true;
    let authoritative = false;
    const unsubscribe = window.notoDesktop.plugins.onSnapshots((event) => {
      if (!stream.push(event.snapshots)) return;
      authoritative = true;
      setPluginAvailability('ready');
    });
    client.start();
    void window.notoDesktop.plugins.getSnapshots({
      version: PLUGIN_LIFECYCLE_VERSION,
      requestId: rid('plugins-get'),
    }).then((result) => {
      if (!active) return;
      if (result.ok) {
        if (stream.bootstrap(result.value.snapshots)) {
          authoritative = true;
          setPluginAvailability('ready');
        }
      } else if (!authoritative) setPluginAvailability('unavailable');
    }).catch(() => {
      if (active && !authoritative) setPluginAvailability('unavailable');
    });
    return () => {
      active = false;
      stream.close();
      unsubscribe();
      void client.dispose();
      if (pluginClientRef.current === client) pluginClientRef.current = null;
    };
  }, []);

  /**
   * Plugin hotkeys and the command palette.
   *
   * Hotkeys are read from the bundled manifests rather than hard coded, so a
   * plugin declaring a binding is enough to make it work. Dispatch goes to
   * main, which owns the manifest and decides whether the plugin may run; the
   * renderer never invokes plugin code directly.
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      if (mod && !event.shiftKey && !event.altKey && event.code === 'KeyK') {
        event.preventDefault();
        // Same reason as the menu path: preferences is modal, and its scrim
        // would sit over the palette and swallow every click on a command.
        setPrefs((current) => ({ ...current, open: false }));
        setPaletteOpen((current) => !current);
        return;
      }
      const keys = manifestHotkeyFor(event);
      if (!keys) return;
      event.preventDefault();
      void window.notoDesktop.plugins.triggerHotkey({
        version: PLUGIN_LIFECYCLE_VERSION,
        requestId: rid('plugin-hotkey'),
        keys,
      });
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const executePluginCommand = useCallback((pluginId: string, commandId: string) => {
    void window.notoDesktop.plugins.executeCommand({
      version: PLUGIN_LIFECYCLE_VERSION,
      requestId: rid('plugin-command'),
      pluginId,
      commandId,
    });
    setPaletteOpen(false);
    queueMicrotask(() => editorRef.current?.focus());
  }, []);

  /** Adopt a document that main has opened, from any entry point. */
  const adopt = useCallback((reply: FileTruthOpenReplyV1) => {
    const id = reply.document.documentId;
    const status: UiState = reply.initialOutcome
      ? 'Recovery failed'
      : reply.recovery ? 'Recovery needed' : 'Opened';

    setDocs((current) => {
      // Re-activating a document already open keeps the state it has built up,
      // including its save token and whether it has unsaved changes. Adopting
      // the original open reply again would hand back a token the store has
      // since replaced, and the next save would be refused as stale.
      if (current.has(id)) return current;
      const next = new Map(current);
      next.set(id, {
        opened: reply,
        document: reply.document,
        token: reply.saveToken,
        outcome: reply.initialOutcome,
        recovery: reply.recovery,
        dirty: false,
        state: status,
        cleanState: 'Opened',
      });
      return next;
    });

    setActiveId(id);
    activeIdRef.current = id;
    setLocalMessage(null);
    editorDirtyRef.current = false;
    updateRecoveryBarrier(Boolean(reply.recovery || reply.initialOutcome));
    cleanStateRef.current = 'Opened';
  }, []);

  /**
   * Subscribe before asking.
   *
   * A document named on the command line is opened by main as soon as the page
   * loads, which can land before or after this component mounts. Subscribing
   * first and then querying covers both orderings without a race.
   */
  useEffect(() => {
    let active = true;
    const unsubscribe = window.notoWorkspace.onDocumentOpened((event) => {
      if (active) adopt(event.opened);
    });
    const unsubscribeTabs = window.notoWorkspace.onTabsChanged((event) => {
      if (!active) return;
      setTabs(event.tabs);
      // Main owns which documents exist, so anything it no longer lists has
      // been closed and its editor should be released.
      const live = new Set(event.tabs.map((tab) => tab.documentId));
      setDocs((current) => {
        if ([...current.keys()].every((id) => live.has(id))) return current;
        const next = new Map<string, OpenDocumentState>();
        for (const [id, doc] of current) if (live.has(id)) next.set(id, doc);
        return next;
      });
      for (const id of [...editorsRef.current.keys()]) {
        if (!live.has(id)) editorsRef.current.delete(id);
      }
      const activeTab = event.tabs.find((tab) => tab.active) ?? null;
      setActiveId(activeTab?.documentId ?? null);
      activeIdRef.current = activeTab?.documentId ?? null;
    });
    const unsubscribeFolder = window.notoWorkspace.onFolderChanged((event) => {
      if (!active) return;
      setFolder({ root: event.root, name: event.name });
      if (event.root) setRail({ open: true, view: 'files' });
      // Every route into a folder ends here, including the menu item, which
      // does not go through the renderer's own handler at all.
      refreshRecentFoldersRef.current();
      // Not awaited: the walk is a background job and the window stays live
      // through it. Following a wiki link needs the same index quick open does,
      // and it has no moment of its own to ask for it.
      void ensureFileIndexRef.current();
    });
    const unsubscribeClosed = window.notoWorkspace.onDocumentClosed(() => {
      if (!active) return;
      setActiveId(null);
      activeIdRef.current = null;
      setShellState('No document');
    });

    const open = async () => {
      try {
        const result = await window.notoFileTruth.open({ version: 1, requestId: rid('ft-open') });
        if (!active) return;
        if (!result.ok) {
          // No document yet is the ordinary first-run state, not a failure.
          setState('No document');
          return;
        }
        adopt(result.value);
      } catch (error) {
        if (!active) return;
        updateRecoveryBarrier(true);
        setPending(false);
        setLocalMessage(actionableFileTruthMessage(error, 'The document could not be opened.'));
        setState('Save failed');
      }
    };
    void open();
    return () => {
      active = false;
      unsubscribe();
      unsubscribeTabs();
      unsubscribeFolder();
      unsubscribeClosed();
    };
  }, [adopt]);

  // Keep the active editor reference pointing at the document in front, so
  // every command in this component keeps working without knowing about tabs.
  useEffect(() => {
    editorRef.current = activeId ? editorsRef.current.get(activeId) ?? null : null;
    if (active) {
      editorDirtyRef.current = active.dirty;
      cleanStateRef.current = active.cleanState;
    }
  }, [activeId, docs, active]);

  const activateTab = useCallback((filePath: string) => {
    void window.notoWorkspace.activateTab({ version: 1, requestId: rid('tab-activate'), path: filePath });
  }, []);

  /** The folders opened before, refreshed whenever one is. */
  const refreshRecentFolders = useCallback(() => {
    void window.notoWorkspace.recentFolders({ version: 1, requestId: rid('recent-folders') })
      .then((result) => { if (result.ok) setRecentFolders(result.value.files); });
  }, []);

  refreshRecentFoldersRef.current = refreshRecentFolders;
  useEffect(refreshRecentFolders, [refreshRecentFolders]);

  const chooseFolder = useCallback(() => {
    void window.notoWorkspace.openFolder({ version: 1, requestId: rid('folder-open') })
      .then((result) => {
        if (result.ok) setFolder({ root: result.value.root, name: result.value.name });
        refreshRecentFolders();
      });
  }, [refreshRecentFolders]);

  const openRecentFolder = useCallback((target: string) => {
    void window.notoWorkspace.openRecentFolder({
      version: 1, requestId: rid('folder-recent'), path: target,
    }).then((result) => {
      if (result.ok) setFolder({ root: result.value.root, name: result.value.name });
      // Whether it opened or had vanished, the list has moved on either way.
      refreshRecentFolders();
    });
  }, [refreshRecentFolders]);

  const listFolder = useCallback(async (directory: string) => {
    const result = await window.notoWorkspace.listFolder({
      version: 1, requestId: rid('folder-list'), path: directory,
    });
    if (!result.ok) throw new Error(result.error.message);
    return result.value.entries;
  }, []);

  const openFromTree = useCallback((filePath: string) => {
    void window.notoWorkspace.openPath({ version: 1, requestId: rid('tree-open'), path: filePath });
  }, []);

  const closeTab = useCallback((filePath: string) => {
    void window.notoWorkspace.closeTab({ version: 1, requestId: rid('tab-close'), path: filePath });
  }, []);

  useEffect(() => {
    void window.notoWorkspace.recent({ version: 1, requestId: rid('recent') })
      .then((result) => { if (result.ok) setRecent(result.value.files); })
      .catch(() => setRecent([]));
  }, [document]);

  /** Record an outcome against the active document. */
  const setOutcome = (value: FileTruthSaveOutcomeV1 | null) => {
    const id = activeIdRef.current;
    if (id) patchDoc(id, { outcome: value });
  };

  const present = (value: FileTruthSaveOutcomeV1) => {
    // The document this save belongs to, not whichever tab is in front now. A
    // save that finishes after the user switched tabs must land on its own
    // document rather than overwrite the state of the one they moved to.
    const id = activeIdRef.current;
    const barrier = outcomeHasRecoveryEvidence(value);
    if (id) {
      patchDoc(id, {
        outcome: value,
        ...('recovery' in value && value.recovery
          ? { recovery: value.recovery }
          : !barrier && value.status === 'saved' ? { recovery: null } : {}),
      });
    }
    updateRecoveryBarrier(barrier);
    setLocalMessage(null);
    setPending(false);

    if (barrier && value.status === 'copy-saved') {
      const current = state;
      setState(current === 'Recovery failed' || current === 'Cleanup failed' ? current : 'Recovery needed');
    } else {
      setState(presentFileTruthOutcome(value).state);
    }

    const accepted = acceptedSaveOutcome(value);
    if (accepted && id) {
      patchDoc(id, { token: accepted.saveToken, document: accepted.document, cleanState: 'Saved' });
      // Record the new clean state before committing. `commit` reports the
      // editor clean, and that callback reads `cleanStateRef`; setting it
      // afterwards would relabel a successful save as merely "Opened".
      cleanStateRef.current = 'Saved';
      // Adopt the saved document as the clean baseline without disturbing the
      // caret or the undo history.
      editorRef.current?.commit(accepted.document);
    }
  };

  /**
   * Automatic saving.
   *
   * Debounced against typing rather than fired once the document turns dirty,
   * because a save costs between 226 ms and several seconds depending on the
   * document, and saving mid-word on a large file would stall the very typing
   * that triggered it.
   *
   * It refuses in exactly the cases the Save button is refused: a save already
   * in flight, a recovery record standing, a file that changed underneath us.
   * Automatic saving must not be a way to reach a path the manual one guards,
   * and an external conflict resolved automatically is data loss nobody
   * watched happen.
   */
  const typingRef = useRef(0);
  const [typingTick, setTypingTick] = useState(0);
  const bumpTyping = useCallback(() => {
    typingRef.current += 1;
    setTypingTick(typingRef.current);
  }, []);
  const saveRef = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    if (!settings.autoSave || !editorDirty || pending) return;
    if (recoveryBarrier || state === 'External conflict' || state === 'Stale editor revision') return;
    const timer = setTimeout(() => { void saveRef.current(); }, settings.autoSaveDelayMs);
    return () => clearTimeout(timer);
  }, [settings.autoSave, settings.autoSaveDelayMs, editorDirty, pending, recoveryBarrier, state, typingTick]);

  const save = async () => {
    const editor = editorRef.current;
    if (!editor || !token || pending || !editorDirty) return;
    let transaction: ReturnType<NotoEditor['capture']>;
    try {
      transaction = editor.capture();
    } catch (error) {
      setLocalMessage(actionableFileTruthMessage(error,
        'The editor refused this save. Finish the current word, then save again.'));
      setState('Unsaved changes');
      return;
    }
    try {
      setPending(true);
      setState('Saving');
      const result = await window.notoFileTruth.save({
        version: 1,
        requestId: rid('ft-save'),
        candidate: { version: 3, saveToken: token, transaction },
      });
      if (!result.ok) {
        setPending(false);
        setOutcome(null);
        setLocalMessage(actionableFileTruthMessage(result.error.message, 'The save transport failed. Your edits are still here.'));
        setState('Save failed');
        return;
      }
      present(result.value);
    } catch (error) {
      setPending(false);
      setOutcome(null);
      updateRecoveryBarrier(true);
      setLocalMessage(actionableFileTruthMessage(error, 'The save transport failed. Your edits are still here.'));
      setState('Save failed');
    }
  };

  const recover = async () => {
    try {
      setPending(true);
      const result = await window.notoFileTruth.recover({ version: 1, requestId: rid('ft-recover') });
      if (!result.ok) {
        setPending(false);
        setLocalMessage(actionableFileTruthMessage(result.error.message, 'Recovery transport failed. Evidence remains on disk.'));
        setState('Recovery failed');
        return;
      }
      present(result.value);
    } catch (error) {
      setPending(false);
      setOutcome(null);
      updateRecoveryBarrier(true);
      setLocalMessage(actionableFileTruthMessage(error, 'Recovery transport failed. Evidence remains on disk.'));
      setState('Recovery failed');
    }
  };

  saveRef.current = save;

  const saveCopy = async () => {
    const editor = editorRef.current;
    if (!editor || !token || !opened) return;

    // Ask where to put it. The menu item says "Save a Copy…", and the ellipsis
    // is a promise that the user gets to choose. This used to write
    // `<name>.md.noto-copy.md` beside the original without asking, which is
    // both a surprise and a file nobody wanted.
    const chosen = await window.notoWorkspace.saveAsDialog({
      version: 1,
      requestId: rid('save-as-dialog'),
    });
    if (!chosen.ok || chosen.value.path === null) return;

    setPending(true);
    try {
      const transaction = editor.capture();
      const result = await window.notoFileTruth.saveCopy({
        version: 1,
        requestId: rid('ft-copy'),
        destinationPath: chosen.value.path,
        candidate: { version: 3, saveToken: token, transaction },
      });
      if (!result.ok) {
        setPending(false);
        setLocalMessage(actionableFileTruthMessage(result.error.message, 'Save a copy failed. The original is unchanged.'));
        setState('Save failed');
        return;
      }
      present(result.value);
    } catch (error) {
      setPending(false);
      setOutcome(null);
      setLocalMessage(actionableFileTruthMessage(error, 'Save a copy failed. The original is unchanged.'));
      setState('Save failed');
    }
  };

  /**
   * Opening replaces the document, so an unsaved one is confirmed first rather
   * than silently discarded.
   */
  const confirmDiscard = useCallback(() => !editorDirtyRef.current
    || window.confirm('This document has unsaved changes. Open a different file and lose them?'), []);

  const openWithDialog = useCallback(async () => {
    if (!confirmDiscard()) return;
    setOpenError(null);
    try {
      const result = await window.notoWorkspace.openDialog({ version: 1, requestId: rid('open-dialog') });
      // A dismissed dialog reports ok with a null document; nothing to do.
      if (!result.ok) setOpenError(actionableFileTruthMessage(result.error.message, 'That file could not be opened.'));
    } catch (error) {
      setOpenError(actionableFileTruthMessage(error, 'That file could not be opened.'));
    }
  }, [confirmDiscard]);

  const openPath = useCallback(async (filePath: string) => {
    if (!confirmDiscard()) return;
    setOpenError(null);
    try {
      const result = await window.notoWorkspace.openPath({ version: 1, requestId: rid('open-path'), path: filePath });
      if (!result.ok) {
        setOpenError(actionableFileTruthMessage(result.error.message, 'That file could not be opened.'));
        return;
      }
      // Counted only on a successful open, so a path that does not resolve does
      // not teach the ranking to offer it again.
      setFrecency((current) => pruneStore(recordOpen(current, filePath, Date.now()), Date.now()));
    } catch (error) {
      setOpenError(actionableFileTruthMessage(error, 'That file could not be opened.'));
    }
  }, [confirmDiscard]);

  /**
   * The file index, fetched once per folder.
   *
   * On opening quick open rather than on opening the folder: someone who never
   * searches never pays for the walk, and someone who does waits once.
   */
  const ensureFileIndex = useCallback(async () => {
    try {
      const result = await window.notoWorkspace.fileIndex({ version: 1, requestId: rid('file-index') });
      if (result.ok) setFileIndex({ entries: result.value.entries, truncated: result.value.truncated });
    } catch {
      // A failed index leaves quick open searching nothing, which its own empty
      // state already explains. It is not worth an alert over the document.
      setFileIndex({ entries: [], truncated: false });
    }
  }, []);
  ensureFileIndexRef.current = ensureFileIndex;

  /**
   * Resolve a `[[wiki link]]` against the index.
   *
   * Exact relative path first, then basename with and without the extension,
   * which is the order that makes `[[00_索引]]` find the one in this folder
   * rather than the eleven others with that name. Ambiguity falls back to
   * frecency, on the grounds that the note you keep opening is the one you
   * meant.
   */
  const followWikiLink = useCallback((target: string) => {
    const wanted = target.replace(/\.md$/i, '').toLowerCase();
    const matches = fileIndex.entries.filter((entry) => {
      const relative = entry.relativePath.replace(/\.md$/i, '').toLowerCase();
      const name = entry.name.replace(/\.md$/i, '').toLowerCase();
      return relative === wanted || name === wanted;
    });
    if (matches.length === 0) {
      setLocalMessage(`No note in this folder is called “${target}”.`);
      return;
    }
    const now = Date.now();
    const best = matches.reduce((chosen, entry) => (
      searchBoost(frecency, entry.path, now) > searchBoost(frecency, chosen.path, now) ? entry : chosen
    ));
    void openPath(best.path);
  }, [fileIndex.entries, frecency, openPath]);
  followWikiLinkRef.current = followWikiLink;

  const searchContent = useCallback(async (query: string) => {
    const result = await window.notoWorkspace.searchContent({
      version: 1, requestId: rid('search-content'), query,
    });
    return result.ok
      ? { matches: result.value.matches, truncated: result.value.truncated, timedOut: result.value.timedOut }
      : null;
  }, []);

  /**
   * Open a note at what was found in it.
   *
   * The editor's own find is reused rather than a second way of locating text:
   * it already highlights every occurrence and scrolls the first into view, and
   * two mechanisms for "show me this string" would eventually disagree. It runs
   * after the document has actually been adopted, since searching a document
   * that has not arrived finds nothing.
   */
  const openMatch = useCallback((filePath: string, query: string) => {
    // Recorded before the open, not after it. The document is adopted through
    // an event rather than through the reply, so the editor can be mounted and
    // asking for a pending query before the promise this awaits has settled.
    pendingMatchRef.current = query;
    void openPath(filePath);
  }, [openPath]);

  /** The link text for a note, relative to the one being edited. */
  const insertWikiLink = useCallback((entry: WorkspaceIndexEntryV1) => {
    const editor = editorRef.current;
    if (!editor) return;
    // The bare name when it is unambiguous in the folder, the relative path
    // when it is not, so the common case stays short and the ambiguous one
    // still resolves.
    const base = entry.name.replace(/\.md$/i, '');
    const sameName = fileIndex.entries.filter(
      (candidate) => candidate.name.replace(/\.md$/i, '') === base,
    );
    const target = sameName.length > 1 ? entry.relativePath.replace(/\.md$/i, '') : base;
    editor.insertText(`[[${target}]]`);
  }, [fileIndex.entries]);

  /**
   * A document reported that its unsaved state changed.
   *
   * Attributed to the document that raised it rather than to whichever tab is
   * in front, so a background document cannot relabel the one being read.
   */
  const onDocumentDirtyChange = useCallback((documentId: string, dirty: boolean) => {
    setDocs((current) => {
      const existing = current.get(documentId);
      if (!existing || existing.dirty === dirty) return current;
      const next = new Map(current);
      next.set(documentId, {
        ...existing,
        dirty,
        outcome: !dirty && !recoveryBarrierRef.current ? null : existing.outcome,
        state: recoveryBarrierRef.current
          ? existing.state
          : dirty ? 'Unsaved changes' : existing.cleanState,
      });
      return next;
    });

    if (documentId !== activeIdRef.current) return;
    editorDirtyRef.current = dirty;
    if (!dirty && !recoveryBarrierRef.current) setLocalMessage(null);
  }, []);

  /** Closing preferences returns focus to whatever opened it, so keyboard
   *  users are not dropped at the top of the document. */
  const closePlugins = useCallback(() => {
    setPrefs((current) => ({ ...current, open: false }));
    restorePluginTriggerFocus(pluginsButtonRef.current);
  }, []);

  /**
   * Menu commands arrive from main because only the renderer knows the editor's
   * contents. Keep this list aligned with `WorkspaceMenuCommandV1`.
   */
  useEffect(() => window.notoWorkspace.onMenuCommand((event) => {
    switch (event.command) {
      case 'save':
        void save();
        break;
      case 'save-as':
        void saveCopy();
        break;
      case 'reveal-document':
        void window.notoWorkspace.reveal({
          version: 1, requestId: rid('reveal'), target: 'document',
        });
        break;
      case 'quick-open':
        // Preferences is modal and would sit over it, for the same reason the
        // command palette dismisses it.
        setPrefs((current) => ({ ...current, open: false }));
        void ensureFileIndex();
        setQuickOpen((current) => ({ open: !(current.open && current.mode === 'name'), mode: 'name' }));
        break;
      case 'search-content':
        setPrefs((current) => ({ ...current, open: false }));
        void ensureFileIndex();
        setQuickOpen((current) => ({ open: !(current.open && current.mode === 'content'), mode: 'content' }));
        break;
      case 'command-palette':
        // Preferences is modal, so leaving it open would put its scrim over the
        // palette and swallow every click on a command. Asking for a command to
        // run against the document is also a statement that you are done with
        // preferences.
        setPrefs((current) => ({ ...current, open: false }));
        setPaletteOpen((current) => !current);
        break;
      case 'toggle-outline':
        toggleRail('outline');
        break;
      case 'toggle-source':
        // Refusing means the hand-edited text no longer parses as one block.
        if (editorRef.current && !editorRef.current.toggleSourceAtSelection()) {
          setLocalMessage('That source edit is no longer a single block, so it cannot be rendered yet.');
        }
        break;
      case 'undo':
        editorRef.current?.history('undo');
        break;
      case 'redo':
        editorRef.current?.history('redo');
        break;
      case 'settings':
        setPrefs({ open: true, section: 'appearance' });
        break;
      case 'toggle-sidebar':
        toggleRail('files');
        break;
      // Three modes in a ring, as in the plugin this is ported from: the chord
      // changes the shape of the page in one press and never lands on nothing.
      case 'widen':
        changeSettings({ widthMode: stepWidthMode(settingsRef.current.widthMode, 1) });
        break;
      case 'narrow':
        changeSettings({ widthMode: stepWidthMode(settingsRef.current.widthMode, -1) });
        break;
      case 'find':
        setPrefs((current) => ({ ...current, open: false }));
        setFind({ open: true, replace: false });
        break;
      case 'find-replace':
        setPrefs((current) => ({ ...current, open: false }));
        setFind({ open: true, replace: true });
        break;
      default:
        break;
    }
  }));

  /**
   * Commands offered by plugins that are currently running.
   *
   * Titles come from the bundled manifests because lifecycle snapshots carry
   * only state, not the command list. Third-party commands arrive over the
   * snapshot once the trusted plugin tier lands.
   */
  const paletteCommands = useMemo(() => pluginSnapshots
    .filter((snapshot) => snapshot.lifecycle === 'active')
    .flatMap((snapshot) => {
      const manifest = bundledManifests.get(snapshot.id);
      return (manifest?.commands ?? []).map((command) => ({
        pluginId: snapshot.id,
        commandId: command.id,
        title: command.title,
        source: manifest?.name ?? snapshot.id,
      }));
    }), [pluginSnapshots]);

  const outline = useMemo(() => (document ? outlineOf(document.text) : []), [document]);

  const actions = state === 'Opening' || state === 'No document'
    ? []
    : fileTruthActions(state, editorDirty, recoveryBarrier);
  const saveBlocked = recoveryBarrier || state === 'External conflict' || state === 'Stale editor revision';
  const alert = exceptionalAlertPresentation(recoveryBarrier, outcome, localMessage);
  const nextTheme = theme === 'light' ? 'dark' : 'light';
  /* Every platform has the idea and none of them share a name for it, so the
     label says the one the reader will recognise on their own machine. */
  const fileManagerName = platform === 'darwin' ? 'Finder'
    : platform === 'win32' ? 'File Explorer' : 'the file manager';

  return (
    <div className="app-shell"
      // Only macOS puts window controls over the page, so only macOS needs the
      // title bar to leave room for them. The value is the one bootstrap
      // validated, which the shell already has.
      data-platform={platform}
      data-testid="noto-app" data-file-state={state}
      data-plugin-lifecycle={pluginSnapshot?.lifecycle ?? 'disabled'}
      data-plugin-registrations={pluginSnapshot?.rendererRegistrations ?? 0}>
      <a className="skip-link" href="#document-canvas">Skip to document</a>

      {/* Identity, not actions.
          Six bordered text buttons in a row read as a toolbar and competed with
          the document on every screen. What is left is the filename where a
          window title belongs and icons that stay quiet until they are wanted.
          Open moved to the File menu and the empty state, Outline into the
          rail, Theme into preferences, Find to its shortcut. */}
      <header className="titlebar">
        <div className="title-left">
          <button type="button" className="icon-button" data-testid="sidebar-toggle"
            aria-pressed={rail.open} aria-label={rail.open ? 'Hide the rail' : 'Show the rail'}
            title={rail.open ? 'Hide the rail' : 'Show the rail'}
            onClick={() => toggleRail(rail.view)}>
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="1.75" />
              <path d="M6.25 2.75v10.5" />
            </svg>
          </button>
        </div>

        <div className="document-identity">
          <strong title={opened?.path} aria-label={opened ? `${filename}. ${opened.path}` : filename}>{filename}</strong>
          {/* Whether there is work to lose is the one thing worth seeing
              without reading. It is also the whole save affordance when the
              document is clean, since the Save icon is not drawn then. */}
          {opened && editorDirty && (
            <span className="unsaved-dot" data-testid="unsaved-dot" role="img" aria-label="Unsaved changes" />
          )}
        </div>

        {/* Not drawn. The dot carries this for sighted readers and the alert
            carries the exceptional states; this stays so the live region still
            announces them. */}
        <span className="file-state" data-testid="file-state" aria-live="polite">{state}</span>

        <div className="title-actions">
          <button ref={pluginsButtonRef} type="button" className="icon-button" data-testid="plugin-toggle"
            aria-expanded={prefs.open && prefs.section === 'plugins'} aria-controls="plugin-drawer"
            aria-label="Plugins" title="Plugins"
            onClick={() => openPreferences('plugins')}>
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <rect x="2.25" y="2.25" width="5" height="5" rx="1.2" />
              <rect x="8.75" y="8.75" width="5" height="5" rx="1.2" />
              <path d="M8.75 4.75h5M4.75 8.75v5" />
            </svg>
          </button>
          <button type="button" className="icon-button" data-testid="settings-toggle"
            aria-expanded={prefs.open && prefs.section !== 'plugins'}
            aria-label="Preferences" title="Preferences"
            onClick={() => openPreferences('appearance')}>
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <circle cx="8" cy="8" r="2.1" />
              <path d="M8 1.4v1.6M8 13v1.6M14.6 8H13M3 8H1.4M12.7 3.3l-1.1 1.1M4.4 11.6l-1.1 1.1M12.7 12.7l-1.1-1.1M4.4 4.4 3.3 3.3" />
            </svg>
          </button>
          {/* Drawn only when there is something to save. A permanently greyed
              Save is noise in a window that is saved almost all of the time,
              and it says nothing when it finally lights up. */}
          {(editorDirty || state === 'Save failed') && (
            <button type="button" className="icon-button is-live" data-testid="save-button"
              aria-label={state === 'Save failed' ? 'Retry save' : 'Save'}
              title={state === 'Save failed' ? 'Retry save' : 'Save'}
              disabled={pending || saveBlocked}
              onClick={() => void save()}>
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M3.4 2.4h7l3.2 3.2v8h-11z" />
                <path d="M5.4 2.4v3.9h5V2.4M5.4 13.6V9.4h5.2v4.2" />
              </svg>
            </button>
          )}
        </div>
      </header>

      <Preferences
        open={prefs.open}
        section={prefs.section}
        onSection={(section) => setPrefs({ open: true, section })}
        settings={settings}
        onChange={changeSettings}
        onClose={closePlugins}
        themeProblem={themeProblem}
        onReloadCss={() => setThemeReload((current) => current + 1)}
        plugins={(
          <PluginCenter api={window.notoDesktop} snapshots={pluginSnapshots}
            availability={pluginAvailability} open />
        )}
      />

      <div className={`workspace-layout ${rail.open ? 'has-rail' : ''}`}>
        {rail.open && (
          <WorkspaceRail
            footer={(
              <RailFooter
                folderName={folder.name}
                folderPath={folder.root}
                recentFolders={recentFolders}
                open={folderMenu}
                onToggle={() => setFolderMenu((current) => !current)}
                onClose={() => setFolderMenu(false)}
                onChooseFolder={chooseFolder}
                onOpenRecentFolder={openRecentFolder}
                onRefresh={() => { void ensureFileIndex(); setFolder((current) => ({ ...current })); }}
                fileManagerName={fileManagerName}
                onReveal={() => { void window.notoWorkspace.reveal({
                  version: 1, requestId: rid('reveal'), target: 'folder',
                }); }}
              />
            )}
            view={rail.view}
            onView={(view) => setRail({ open: true, view })}
            width={settings.railWidth}
            onResize={(railWidth) => changeSettings({ railWidth })}
            outline={outline}
            onGoToBlock={(blockIndex) => editorRef.current?.focusBlock(blockIndex)}
            tree={{
              root: folder.root,
              rootName: folder.name,
              activePath: opened?.path ?? null,
              list: listFolder,
              onOpenFile: openFromTree,
              onChooseFolder: chooseFolder,
            }}
          />
        )}

        {/* A sibling of the canvas rather than a child of it, so opening find
            overlays the document instead of pushing every line down. */}
        {document && (
          <FindBar
            open={find.open}
            showReplace={find.replace}
            initialQuery={find.query}
            onSearch={(options) => editorRef.current?.search(options) ?? { matches: 0, active: -1 }}
            onGo={(direction) => editorRef.current?.goToMatch(direction) ?? { matches: 0, active: -1 }}
            onReplace={(replacement, scope) => editorRef.current?.replace(replacement, scope) ?? 0}
            onClose={() => {
              editorRef.current?.clearSearch();
              setFind({ open: false, replace: false });
              editorRef.current?.focus();
            }}
          />
        )}

        <main id="document-canvas" className="canvas-scroll" tabIndex={-1} aria-label="Document canvas">
          {/* Every open document keeps its editor mounted, with only the
              active one visible. Unmounting the others would destroy their
              undo history, selection and scroll position, so returning to a
              tab would lose the work in progress there. */}
          {[...docs.values()].map((doc) => (
            <div
              key={doc.document.documentId}
              className="canvas-slot"
              hidden={doc.document.documentId !== activeId}
              aria-hidden={doc.document.documentId !== activeId}
            >
              <NotoCanvas
                document={doc.document}
                mac={platform === 'darwin'}
                smartTypography={settings.smartTypography}
                spellCheck={settings.spellCheck}
                onDirtyChange={(dirty) => onDocumentDirtyChange(doc.document.documentId, dirty)}
                onDocumentChanged={() => {
                  if (doc.document.documentId === activeIdRef.current) bumpTyping();
                }}
                onFollowWikiLink={(target) => followWikiLinkRef.current(target)}
                onReady={(editor) => {
                  editorsRef.current.set(doc.document.documentId, editor);
                  if (doc.document.documentId === activeIdRef.current) {
                    editorRef.current = editor;
                    pluginClientRef.current?.attachAdapter(editor);
                    // A content result was what opened this document, so show
                    // the reader what they searched for rather than the top of
                    // a file they now have to scan by eye.
                    const pending = pendingMatchRef.current;
                    pendingMatchRef.current = null;
                    if (pending) setFind({ open: true, replace: false, query: pending });
                  }
                }}
                onTeardown={(editor) => {
                  editorsRef.current.delete(doc.document.documentId);
                  if (editorRef.current !== editor) return;
                  // Detach before dropping the reference, so a plugin can never
                  // hold a port whose editor is already gone.
                  void pluginClientRef.current?.detachAdapter();
                  editorRef.current = null;
                }}
                onError={(message) => {
                  setLocalMessage(actionableFileTruthMessage(message, 'The editor failed to start.'));
                  setState('Save failed');
                }}
              />
            </div>
          ))}
          {document
            ? null
            : state === 'Opening'
              ? <div className="opening-state">Starting…</div>
              : <section className="empty-state" data-testid="empty-state">
                  <h1>No document open</h1>
                  <p>Open a Markdown file to start writing.</p>
                  <button type="button" className="primary" data-testid="empty-open"
                    onClick={() => void openWithDialog()}>Open a document…</button>
                  {openError && <p role="alert" className="empty-error">{openError}</p>}
                  {recent.length > 0 && (
                    <div className="recent-list">
                      <span className="aside-heading">Recent</span>
                      {recent.slice(0, 8).map((file) => (
                        <button key={file.path} type="button" className="file-row" title={file.path}
                          onClick={() => void openPath(file.path)}>
                          <strong>{file.name}</strong>
                          <span>{file.path}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </section>}
        </main>
      </div>

      <QuickOpen
        open={quickOpen.open}
        mode={quickOpen.mode}
        onMode={(mode) => setQuickOpen({ open: true, mode })}
        onSearchContent={searchContent}
        onOpenMatch={openMatch}
        entries={fileIndex.entries}
        frecency={frecency}
        truncated={fileIndex.truncated}
        canInsertLink={document !== null}
        onOpenFile={(filePath) => void openPath(filePath)}
        onInsertLink={insertWikiLink}
        onClose={() => { setQuickOpen((current) => ({ ...current, open: false })); editorRef.current?.focus(); }}
      />

      {paletteOpen && (
        <div className="command-palette" role="dialog" aria-modal="true" aria-label="Commands"
          data-testid="command-palette">
          <div className="dialog-heading">
            <strong>Commands</strong>
            <button type="button" onClick={() => setPaletteOpen(false)}>Close</button>
          </div>
          {paletteCommands.length === 0
            ? <p className="palette-empty">No plugin commands are available. Enable a plugin to see its commands here.</p>
            : paletteCommands.map((command) => (
                <button key={`${command.pluginId}:${command.commandId}`} type="button" className="palette-result"
                  onClick={() => executePluginCommand(command.pluginId, command.commandId)}>
                  <strong>{command.title}</strong>
                  <span>{command.source}</span>
                </button>
              ))}
        </div>
      )}

      {alert && (
        <section className={`file-truth-alert alert-${state.toLowerCase().replaceAll(' ', '-')}`}
          role="alert" data-testid="file-truth-alert">
          <strong>{state}</strong>
          <p>{alert.message}</p>
          {recoveryRecord && (
            <p className="recovery-record">
              Recovery record {recoveryRecord.attemptId.slice(0, 12)} at {recoveryRecord.stage}. Retry
              recovery verifies the accepted bytes and then clears this durable evidence.
            </p>
          )}
          <div className="file-truth-actions">
            {actions.includes('retry-recovery') && <button type="button" disabled={pending} onClick={() => void recover()}>Retry recovery</button>}
            {actions.includes('retry-save') && <button type="button" disabled={pending} onClick={() => void save()}>Retry save</button>}
            {actions.includes('save-copy') && <button type="button" disabled={pending} onClick={() => void saveCopy()}>Save a copy</button>}
          </div>
          {outcome?.status === 'copy-saved' && <p>The original is unchanged. Your current edits are still unsaved.</p>}
        </section>
      )}

      {/* Where the file lives, and what state it is in.
          Deliberately not the file name: the title bar already shows that, and
          repeating it in the corner spends the only other line the window has
          on something the reader has already read. The containing folder is
          what the title bar cannot tell them, and the full path is on hover. */}
      {opened && (
        <footer className="operational-status">
          <RecentStrip tabs={tabs} dirty={dirtyDocumentIds} onActivate={activateTab} />
          <span className="status-path" title={opened.path}>{containingFolder}</span>
          {/* Only the resting states. Every other state is already on the title
              bar, and an unsaved document was announcing itself three times at
              once: the dot on the name, the word beside the actions, and this.
              What this line adds is the fidelity promise, which nothing else
              says. */}
          <span className="status-message">
            {state === 'Opened' ? 'Exact source preserved' : state === 'Saved' ? 'Exact source saved' : ''}
          </span>
        </footer>
      )}
    </div>
  );
}

export function BootstrapFailure({ message }: { message: string }) {
  const actionable = actionableFileTruthMessage(message, 'Noto could not start safely.');
  return (
    <main className="opening-state" data-testid="bootstrap-failure" role="alert">
      <strong>Noto could not start safely.</strong>
      <p>{actionable}</p>
      <p>No document was opened and no save was attempted.</p>
    </main>
  );
}

export function App() {
  const [boot, setBoot] = useState<{ platform: NotoPlatform; error: string | null } | null>(null);

  useEffect(() => {
    let active = true;
    void window.notoFileTruth.bootstrap({ version: 1, requestId: rid('ft-bootstrap') })
      .then((result) => {
        if (!active) return;
        setBoot(result.ok
          ? { platform: result.value.platform, error: null }
          : { platform: 'linux', error: result.error.message });
      })
      .catch((error) => {
        if (active) {
          setBoot({
            platform: 'linux',
            error: error instanceof Error ? error.message : 'Bootstrap transport failed.',
          });
        }
      });
    return () => { active = false; };
  }, []);

  if (boot === null) return <div className="opening-state">Starting Noto…</div>;
  if (boot.error) return <BootstrapFailure message={boot.error} />;
  return <NotoWorkspace platform={boot.platform} />;
}
