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

import { app, Menu, shell, type BrowserWindow } from 'electron';
import {
  NOTO_WORKSPACE_VERSION,
  WORKSPACE_CHANNELS,
  type RecentFileV1,
  type WorkspaceMenuCommandV1,
} from '../../shared/workspace/v1/contracts';
import { buildMenuTemplate, type MenuActions } from './menu-template';

export type { MenuActions };

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
): Menu {
  return Menu.buildFromTemplate(buildMenuTemplate({
    platform: process.platform,
    appName: app.name,
    recent,
    actions,
    sendCommand: (command) => sendCommand(getWindow(), command),
    openExternal: (url) => { void shell.openExternal(url); },
  }));
}

export function installApplicationMenu(
  getWindow: () => BrowserWindow | null,
  recent: readonly RecentFileV1[],
  actions: MenuActions,
): void {
  Menu.setApplicationMenu(buildApplicationMenu(getWindow, recent, actions));
}
