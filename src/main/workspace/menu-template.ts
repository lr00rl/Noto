/**
 * What the application menu contains, as a description rather than a menu.
 *
 * Separated from building the real menu so the platform differences can be
 * checked. macOS expects an application menu holding About and Quit while
 * Windows and Linux expect those under File and Help, and Redo is bound
 * differently on each. Those are claims about behaviour, and while the platform
 * was read from `process.platform` in the middle of the builder there was no
 * way to test any of them except by running on three machines.
 *
 * Nothing here imports a value from Electron, only types, so it can be built
 * and inspected outside a running app.
 */

import type { BrowserWindow, MenuItemConstructorOptions } from 'electron';
import type { RecentFileV1, WorkspaceMenuCommandV1 } from '../../shared/workspace/v1/contracts';

export interface MenuActions {
  /** Choose the folder shown in the sidebar. */
  openFolder: () => void;
  /** Close whichever document is in front. */
  closeTab: () => void;
  openDialog: () => void;
  openPath: (filePath: string) => void;
  clearRecent: () => void;
}

export interface MenuTemplateOptions {
  readonly platform: NodeJS.Platform;
  /** Shown as the application menu's title on macOS. */
  readonly appName: string;
  readonly recent: readonly RecentFileV1[];
  readonly actions: MenuActions;
  /** Sends a command to the renderer, which owns the editor's contents. */
  readonly sendCommand: (command: WorkspaceMenuCommandV1) => void;
  readonly openExternal: (url: string) => void;
}

function recentSubmenu(
  recent: readonly RecentFileV1[],
  actions: MenuActions,
): MenuItemConstructorOptions {
  const items: MenuItemConstructorOptions[] = recent.length === 0
    ? [{ label: 'No recent documents', enabled: false }]
    : recent.map((file) => ({
        label: file.name,
        toolTip: file.path,
        click: () => actions.openPath(file.path),
      }));
  if (recent.length > 0) {
    items.push({ type: 'separator' }, { label: 'Clear menu', click: () => actions.clearRecent() });
  }
  return { label: 'Open Recent', submenu: items };
}

export function buildMenuTemplate(options: MenuTemplateOptions): MenuItemConstructorOptions[] {
  const { platform, appName, recent, actions, sendCommand, openExternal } = options;
  const mac = platform === 'darwin';

  // Each command item carries its command as its id, so the menu can be driven
  // programmatically. Native accelerators are not reachable from an automated
  // keystroke, and testing the accelerator instead of the item would prove less.
  const command = (
    label: string,
    accelerator: string,
    value: WorkspaceMenuCommandV1,
  ): MenuItemConstructorOptions => ({
    id: value,
    label,
    accelerator,
    click: () => sendCommand(value),
  });

  const fileMenu: MenuItemConstructorOptions = {
    label: '&File',
    submenu: [
      { id: 'open-dialog', label: 'Open…', accelerator: 'CmdOrCtrl+O', click: () => actions.openDialog() },
      { id: 'open-folder', label: 'Open Folder…', accelerator: 'CmdOrCtrl+Alt+O', click: () => actions.openFolder() },
      // The fastest way into a vault of a few thousand notes, so it sits with
      // the other ways of opening one rather than under a search menu.
      command('Quick Open…', 'CmdOrCtrl+P', 'quick-open'),
      // Closed in main rather than sent to the renderer: main owns which
      // documents are open, so asking the renderer which one is in front would
      // race against the tab list arriving there.
      { id: 'close-tab', label: 'Close Tab', accelerator: 'CmdOrCtrl+W', click: () => actions.closeTab() },
      recentSubmenu(recent, actions),
      command(
        mac ? 'Reveal in Finder' : platform === 'win32' ? 'Reveal in File Explorer' : 'Reveal in File Manager',
        'CmdOrCtrl+Shift+R',
        'reveal-document',
      ),
      { type: 'separator' },
      command('Save', 'CmdOrCtrl+S', 'save'),
      command('Save a Copy…', 'CmdOrCtrl+Shift+S', 'save-as'),
      { type: 'separator' },
      // Quit belongs to the application menu on macOS, so File closes instead.
      mac ? { role: 'close' } : { role: 'quit' },
    ],
  };

  const editMenu: MenuItemConstructorOptions = {
    label: '&Edit',
    submenu: [
      // Not the undo and redo roles. Those call `webContents.undo`, which runs
      // the browser's own undo against the contenteditable and never reaches
      // ProseMirror's history, so an edit would appear to be un-undoable.
      command('Undo', 'CmdOrCtrl+Z', 'undo'),
      command('Redo', mac ? 'Shift+CmdOrCtrl+Z' : 'CmdOrCtrl+Y', 'redo'),
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      { role: 'pasteAndMatchStyle' },
      { role: 'selectAll' },
      { type: 'separator' },
      command('Find…', 'CmdOrCtrl+F', 'find'),
      command('Find and Replace…', 'CmdOrCtrl+Alt+F', 'find-replace'),
      // The name every editor gives this, so nobody has to look for it.
      command('Find in Notes…', 'CmdOrCtrl+Shift+F', 'search-content'),
      command('Command Palette…', 'CmdOrCtrl+K', 'command-palette'),
      { type: 'separator' },
      command('Settings…', 'CmdOrCtrl+,', 'settings'),
    ],
  };

  const viewMenu: MenuItemConstructorOptions = {
    label: '&View',
    submenu: [
      command('Toggle Sidebar', 'CmdOrCtrl+Shift+L', 'toggle-sidebar'),
      command('Toggle Outline', 'CmdOrCtrl+Shift+O', 'toggle-outline'),
      command('Toggle Source Mode', 'CmdOrCtrl+/', 'toggle-source'),
      { type: 'separator' },
      // The writing width, stepped from the keyboard. The setting is a slider
      // in preferences; these are the same value under the fingers, which is
      // where you actually want it while a paragraph is refusing to sit right.
      command('Wider', 'CmdOrCtrl+]', 'widen'),
      command('Narrower', 'CmdOrCtrl+[', 'narrow'),
      { type: 'separator' },
      { role: 'resetZoom' },
      { role: 'zoomIn' },
      { role: 'zoomOut' },
      { type: 'separator' },
      { role: 'togglefullscreen' },
    ],
  };

  const windowMenu: MenuItemConstructorOptions = {
    label: '&Window',
    submenu: mac
      ? [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'front' }]
      : [{ role: 'minimize' }, { role: 'zoom' }, { role: 'close' }],
  };

  const helpMenu: MenuItemConstructorOptions = {
    role: 'help',
    submenu: [
      {
        label: 'Noto on the web',
        click: () => openExternal('https://github.com'),
      },
      // About lives in the application menu on macOS, so Help carries it only
      // on the platforms that have nowhere else to put it.
      ...(mac
        ? []
        : [{ type: 'separator' } as MenuItemConstructorOptions, { role: 'about' } as MenuItemConstructorOptions]),
    ],
  };

  return [
    ...(mac
      ? [{
          label: appName,
          submenu: [
            { role: 'about' },
            { type: 'separator' },
            { role: 'services' },
            { type: 'separator' },
            { role: 'hide' },
            { role: 'hideOthers' },
            { role: 'unhide' },
            { type: 'separator' },
            { role: 'quit' },
          ],
        } as MenuItemConstructorOptions]
      : []),
    fileMenu,
    editMenu,
    viewMenu,
    windowMenu,
    helpMenu,
  ];
}

/** Every command id the template can emit, for checking against the contract. */
export function menuCommandIds(template: readonly MenuItemConstructorOptions[]): string[] {
  const found: string[] = [];
  const walk = (items: readonly MenuItemConstructorOptions[]) => {
    for (const item of items) {
      if (typeof item.id === 'string') found.push(item.id);
      const submenu = item.submenu;
      if (Array.isArray(submenu)) walk(submenu);
    }
  };
  walk(template);
  return found;
}

export type { BrowserWindow };
