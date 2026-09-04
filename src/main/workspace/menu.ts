/**
 * The application menu.
 *
 * Built per platform rather than shared, because the conventions genuinely
 * differ: macOS expects an application menu holding About and Quit, Windows and
 * Linux expect those under File and Help. Accelerators use `CmdOrCtrl` so one
 * definition binds correctly everywhere.
 *
 * Commands that need the editor's contents are forwarded to the renderer rather
 * than executed here, because main does not know what the user has typed.
 */

import { clipboard, app, Menu, shell, type BrowserWindow } from 'electron';
import {
  NOTO_WORKSPACE_VERSION,
  WORKSPACE_CHANNELS,
  type RecentFileV1,
  type WorkspaceMenuCommandV1,
} from '../../shared/workspace/v1/contracts';
import { buildMenuTemplate, type MenuActions } from './menu-template';

export type { MenuActions };

/** Paste as Plain Text: main reads the clipboard and hands the text over. */
export function sendPasteText(window: BrowserWindow | null): void {
  if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return;
  // The clipboard is read asynchronously in this Electron, and the window is
  // checked again once the text is here, since it may have gone meanwhile.
  void clipboard.readText().then((text) => {
    if (window.isDestroyed() || window.webContents.isDestroyed()) return;
    window.webContents.send(WORKSPACE_CHANNELS.pasteText, {
      version: NOTO_WORKSPACE_VERSION,
      text,
    });
  }).catch(() => {});
}

function sendCommand(window: BrowserWindow | null, command: WorkspaceMenuCommandV1): void {
  if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return;
  window.webContents.send(WORKSPACE_CHANNELS.menuCommand, {
    version: NOTO_WORKSPACE_VERSION,
    command,
  });
}

/**
 * The real menu, from the template plus the parts that need Electron: the
 * running app's name, opening a link, and turning it into a `Menu`.
 */
export function buildApplicationMenu(
  getWindow: () => BrowserWindow | null,
  recent: readonly RecentFileV1[],
  actions: MenuActions,
  state?: { readonly readOnly: boolean; readonly alwaysOnTop: boolean },
  /** Told about every command sent, so a tick in this menu can follow one. */
  onCommand?: (command: WorkspaceMenuCommandV1) => void,
): Menu {
  return Menu.buildFromTemplate(buildMenuTemplate({
    platform: process.platform,
    appName: app.name,
    recent,
    actions,
    sendCommand: (command) => {
      sendCommand(getWindow(), command);
      onCommand?.(command);
    },
    openExternal: (url) => { void shell.openExternal(url); },
    state,
  }));
}

export function installApplicationMenu(
  getWindow: () => BrowserWindow | null,
  recent: readonly RecentFileV1[],
  actions: MenuActions,
  state?: { readonly readOnly: boolean; readonly alwaysOnTop: boolean },
  onCommand?: (command: WorkspaceMenuCommandV1) => void,
): void {
  Menu.setApplicationMenu(buildApplicationMenu(getWindow, recent, actions, state, onCommand));
}
