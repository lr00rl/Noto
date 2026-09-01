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
import type { RecentFileV1, WorkspaceTabV1 } from '../shared/workspace/v1/contracts';
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
import { TabBar } from './TabBar';
import { FileTree } from './FileTree';
import { SettingsPanel } from './SettingsPanel';
import { DEFAULT_SETTINGS, type NotoSettingsV1 } from '../shared/settings/v1/contracts';
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
  const [pluginsOpen, setPluginsOpen] = useState(false);
  const [pluginSnapshots, setPluginSnapshots] = useState<PluginLifecycleSnapshot[]>([]);
  const [pluginAvailability, setPluginAvailability] = useState<PluginSnapshotAvailability>('loading');
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [recent, setRecent] = useState<readonly RecentFileV1[]>([]);
  const [openError, setOpenError] = useState<string | null>(null);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [settings, setSettings] = useState<NotoSettingsV1>(DEFAULT_SETTINGS);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [folder, setFolder] = useState<{ root: string | null; name: string | null }>({ root: null, name: null });

  const editorsRef = useRef<Map<string, NotoEditor>>(new Map());
  /** Always the editor of the document in front, so call sites stay unchanged. */
  const editorRef = useRef<NotoEditor | null>(null);
  const pluginHostRef = useRef<ReadonlyMap<string, RendererPluginHost> | null>(null);
  const pluginClientRef = useRef<RendererPluginClient | null>(null);
  const pluginsButtonRef = useRef<HTMLButtonElement>(null);
  const [find, setFind] = useState<{ open: boolean; replace: boolean }>({ open: false, replace: false });
  const cleanStateRef = useRef<'Opened' | 'Saved'>('Opened');
  const dirtyDocumentIds = useMemo(
    () => new Set([...docs.values()].filter((doc) => doc.dirty).map((doc) => doc.document.documentId)),
    [docs],
  );
  if (!pluginHostRef.current) pluginHostRef.current = createRendererPluginHosts();

  const pluginSnapshot = pluginSnapshots.find((snapshot) => snapshot.id === rendererProofManifest.id);
  const filename = useMemo(() => opened?.path.split(/[\\/]/).at(-1) ?? 'No document', [opened]);

  const updateEditorDirty = (value: boolean) => {
    editorDirtyRef.current = value;
    const id = activeIdRef.current;
    if (id) patchDoc(id, { dirty: value });
  };
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

  useEffect(() => {
    globalThis.document.documentElement.dataset.measure = settings.measure;
  }, [settings.measure]);

  // Read once at startup, then follow any change main publishes.
  useEffect(() => {
    let active = true;
    void window.notoSettings.read({ version: 1, requestId: rid('settings-read') })
      .then((result) => {
        if (!active || !result.ok) return;
        setSettings(result.value.settings);
        if (result.value.settings.sidebarOnLaunch) setSidebarOpen(true);
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
      if (event.root) setSidebarOpen(true);
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

  const chooseFolder = useCallback(() => {
    void window.notoWorkspace.openFolder({ version: 1, requestId: rid('folder-open') })
      .then((result) => {
        if (result.ok) setFolder({ root: result.value.root, name: result.value.name });
      });
  }, []);

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
      if (!result.ok) setOpenError(actionableFileTruthMessage(result.error.message, 'That file could not be opened.'));
    } catch (error) {
      setOpenError(actionableFileTruthMessage(error, 'That file could not be opened.'));
    }
  }, [confirmDiscard]);

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

  const closePlugins = useCallback(() => {
    setPluginsOpen(false);
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
      case 'command-palette':
        setPaletteOpen((current) => !current);
        break;
      case 'toggle-outline':
        setOutlineOpen((current) => !current);
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
        setSettingsOpen(true);
        break;
      case 'toggle-sidebar':
        setSidebarOpen((current) => !current);
        break;
      case 'find':
        setFind({ open: true, replace: false });
        break;
      case 'find-replace':
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

  return (
    <div className={`app-shell file-truth-shell ${pluginsOpen ? 'plugins-open' : ''}`}
      data-testid="noto-app" data-file-state={state}
      data-plugin-lifecycle={pluginSnapshot?.lifecycle ?? 'disabled'}
      data-plugin-registrations={pluginSnapshot?.rendererRegistrations ?? 0}>
      <a className="skip-link" href="#document-canvas">Skip to document</a>

      <header className="titlebar">
        <div className="document-identity">
          <strong title={opened?.path} aria-label={opened ? `${filename}. ${opened.path}` : filename}>{filename}</strong>
        </div>
        {/* Shown only when it has something to say. "Opened" and "Saved" are
            the resting states and repeat what the window already implies, and
            sitting two letters away from the "Open…" button they read as a
            second control. Kept in the DOM either way so the live region still
            announces the states that matter. */}
        <span className={`file-state state-${state.toLowerCase().replaceAll(' ', '-')}`
          + (state === 'Opened' || state === 'Saved' || state === 'No document' ? ' is-resting' : '')}
          data-testid="file-state" aria-live="polite">{state}</span>
        <div className="title-actions">
          <button type="button" data-testid="open-button" onClick={() => void openWithDialog()}>Open…</button>
          <button type="button" data-testid="outline-toggle" aria-pressed={outlineOpen}
            disabled={outline.length === 0}
            onClick={() => setOutlineOpen((current) => !current)}>Outline</button>
          <button ref={pluginsButtonRef} type="button" data-testid="plugin-toggle"
            aria-expanded={pluginsOpen} aria-controls="plugin-drawer"
            onClick={() => (pluginsOpen ? closePlugins() : setPluginsOpen(true))}>Plugins</button>
          <button type="button" className="icon-button" data-testid="theme-button"
            aria-label={`Use ${nextTheme} theme`} title={`Use ${nextTheme} theme`}
            onClick={() => setTheme(nextTheme)}>
            {theme === 'light'
              ? <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M11.8 10.7A5.2 5.2 0 0 1 5.3 4.2 5.2 5.2 0 1 0 11.8 10.7Z" /></svg>
              : <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="2.5" /><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.4 1.4M11.6 11.6 13 13M13 3l-1.4 1.4M4.4 11.6 3 13" /></svg>}
          </button>
          <button type="button" data-testid="save-button"
            disabled={!editorDirty || pending || saveBlocked}
            onClick={() => void save()}>{state === 'Save failed' ? 'Retry save' : 'Save'}</button>
        </div>
      </header>

      <SettingsPanel
        open={settingsOpen}
        settings={settings}
        onChange={changeSettings}
        onClose={() => setSettingsOpen(false)}
      />

      <TabBar tabs={tabs} dirty={dirtyDocumentIds} onActivate={activateTab} onClose={closeTab} />

      <div className={`workspace-layout ${sidebarOpen ? 'has-sidebar' : ''}`}>
        {sidebarOpen && (
          <FileTree
            root={folder.root}
            rootName={folder.name}
            activePath={opened?.path ?? null}
            list={listFolder}
            onOpenFile={openFromTree}
            onChooseFolder={chooseFolder}
          />
        )}
        {outlineOpen && outline.length > 0 && (
          <aside className="outline-panel" aria-label="Document outline" data-testid="outline-panel">
            <span className="aside-heading">Outline</span>
            <nav>
              {outline.map((entry) => (
                <button key={`${entry.blockIndex}`} type="button" className={`outline-entry depth-${entry.depth}`}
                  onClick={() => editorRef.current?.focusBlock(entry.blockIndex)}>
                  {entry.text}
                </button>
              ))}
            </nav>
          </aside>
        )}

        {/* A sibling of the canvas rather than a child of it, so opening find
            overlays the document instead of pushing every line down. */}
        {document && (
          <FindBar
            open={find.open}
            showReplace={find.replace}
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
                onReady={(editor) => {
                  editorsRef.current.set(doc.document.documentId, editor);
                  if (doc.document.documentId === activeIdRef.current) {
                    editorRef.current = editor;
                    pluginClientRef.current?.attachAdapter(editor);
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

      <PluginCenter api={window.notoDesktop} snapshots={pluginSnapshots} availability={pluginAvailability}
        open={pluginsOpen} onClose={closePlugins} />

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

      <footer className="operational-status">
        {/* The name, with the full path on hover. A long absolute path never
            fits the bar and pushes out everything worth reading. */}
        <span className="status-path" title={opened?.path}
          aria-label={opened?.path ?? 'No accepted file identity'}>
          {opened ? filename : 'No accepted file identity'}
        </span>
        <span className="status-message">
          {state === 'Opened' ? 'Exact source preserved' : state === 'Saved' ? 'Exact source saved' : state}
        </span>
      </footer>
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
