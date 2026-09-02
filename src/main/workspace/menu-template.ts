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
    accelerator: string | undefined,
    value: WorkspaceMenuCommandV1,
  ): MenuItemConstructorOptions => ({
    id: value,
    label,
    ...(accelerator === undefined ? {} : { accelerator }),
    click: () => sendCommand(value),
  });

  const fileMenu: MenuItemConstructorOptions = {
    label: '&File',
    submenu: [
      command('New Note', 'CmdOrCtrl+N', 'new-file'),
      { id: 'open-dialog', label: 'Open…', accelerator: 'CmdOrCtrl+O', click: () => actions.openDialog() },
      // Not Option and Command with O: Typora gives that pair to Ordered List,
      // and a menu accelerator wins over the editor's own keys. Opening a
      // folder happens once a session; making a list happens all day.
      { id: 'open-folder', label: 'Open Folder…', accelerator: 'CmdOrCtrl+Alt+Shift+O', click: () => actions.openFolder() },
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
      // Command and K belongs to the hyperlink, in Typora and in every editor
      // that has both. The palette takes the other near universal chord.
      command('Command Palette…', 'CmdOrCtrl+Shift+P', 'command-palette'),
      { type: 'separator' },
      command('Settings…', 'CmdOrCtrl+,', 'settings'),
    ],
  };

  /**
   * Typora's Paragraph menu, so the block shapes are somewhere a hand can find
   * them. Every item runs the same editor command its shortcut runs, and the
   * shortcuts are Typora's own.
   */
  const paragraphMenu: MenuItemConstructorOptions = {
    label: '&Paragraph',
    submenu: [
      command('Heading 1', 'CmdOrCtrl+1', 'block-heading-1'),
      command('Heading 2', 'CmdOrCtrl+2', 'block-heading-2'),
      command('Heading 3', 'CmdOrCtrl+3', 'block-heading-3'),
      command('Heading 4', 'CmdOrCtrl+4', 'block-heading-4'),
      command('Heading 5', 'CmdOrCtrl+5', 'block-heading-5'),
      command('Heading 6', 'CmdOrCtrl+6', 'block-heading-6'),
      command('Paragraph', 'CmdOrCtrl+0', 'block-paragraph'),
      { type: 'separator' },
      command('Increase Heading Level', 'CmdOrCtrl+=', 'block-heading-up'),
      command('Decrease Heading Level', 'CmdOrCtrl+-', 'block-heading-down'),
      { type: 'separator' },
      command('Move Up', 'Alt+Up', 'move-up'),
      command('Move Down', 'Alt+Down', 'move-down'),
      { type: 'separator' },
      {
        label: 'Table',
        submenu: [
          command('Insert Table', 'CmdOrCtrl+Alt+T', 'table-insert'),
          { type: 'separator' },
          command('Add Row Above', undefined, 'table-row-above'),
          command('Add Row Below', undefined, 'table-row-below'),
          command('Add Column Before', undefined, 'table-column-before'),
          command('Add Column After', undefined, 'table-column-after'),
          { type: 'separator' },
          command('Move Column Left', 'CmdOrCtrl+Ctrl+Left', 'move-column-left'),
          command('Move Column Right', 'CmdOrCtrl+Ctrl+Right', 'move-column-right'),
          { type: 'separator' },
          command('Delete Row', undefined, 'table-row-delete'),
          command('Delete Column', undefined, 'table-column-delete'),
          command('Delete Table', undefined, 'table-delete'),
        ],
      },
      { type: 'separator' },
      command('Code Fences', 'CmdOrCtrl+Alt+C', 'block-code'),
      command('Math Block', 'CmdOrCtrl+Alt+B', 'block-math'),
      command('Quote', 'CmdOrCtrl+Alt+Q', 'block-quote'),
      command('Ordered List', 'CmdOrCtrl+Alt+O', 'block-ordered-list'),
      command('Unordered List', 'CmdOrCtrl+Alt+U', 'block-bullet-list'),
      command('Task List', 'CmdOrCtrl+Alt+X', 'block-task-list'),
      command('Horizontal Line', 'CmdOrCtrl+Alt+-', 'block-rule'),
      {
        // The five GitHub alerts, which the author's notes use and which the
        // editor already draws. Switching kinds replaces the marker rather
        // than adding a second one, so these behave as one setting.
        label: 'Callout',
        submenu: [
          command('Note', undefined, 'block-alert-note'),
          command('Tip', undefined, 'block-alert-tip'),
          command('Important', undefined, 'block-alert-important'),
          command('Warning', undefined, 'block-alert-warning'),
          command('Caution', undefined, 'block-alert-caution'),
        ],
      },
    ],
  };

  /*
   * Inline marks have their own menu, as they do in Typora, which keeps
   * Paragraph for the block a thing is and Format for how its words are drawn.
   * Bold, italic, code and strike had their keys from the first day and were
   * never on a menu at all, so the only way to learn them was to already know
   * them.
   */
  const formatMenu: MenuItemConstructorOptions = {
    label: 'F&ormat',
    submenu: [
      command('Strong', 'CmdOrCtrl+B', 'mark-strong'),
      command('Emphasis', 'CmdOrCtrl+I', 'mark-emphasis'),
      command('Underline', 'CmdOrCtrl+U', 'mark-underline'),
      command('Code', 'CmdOrCtrl+E', 'mark-code'),
      command('Strike', 'CmdOrCtrl+Shift+X', 'mark-strike'),
      command('Highlight', 'CmdOrCtrl+Shift+H', 'mark-highlight'),
      command('Inline Math', 'Control+M', 'mark-math'),
      { type: 'separator' },
      command('Hyperlink…', 'CmdOrCtrl+K', 'insert-link'),
      { type: 'separator' },
      command('Clear Format', 'CmdOrCtrl+Shift+Backspace', 'clear-format'),
    ],
  };

  const viewMenu: MenuItemConstructorOptions = {
    label: '&View',
    submenu: [
      command('Toggle Sidebar', 'CmdOrCtrl+Shift+L', 'toggle-sidebar'),
      command('Toggle Outline', 'CmdOrCtrl+Shift+O', 'toggle-outline'),
      command('Toggle Source Mode', 'CmdOrCtrl+/', 'toggle-source'),
      { type: 'separator' },
      // Typora's two writing modes. It gives neither a shortcut, and neither
      // wants one: they are settled once for a session, not reached for mid
      // sentence.
      command('Focus Mode', undefined, 'toggle-focus-mode'),
      command('Typewriter Mode', undefined, 'toggle-typewriter'),
      { type: 'separator' },
      // The writing width, stepped from the keyboard. The setting is a slider
      // in preferences; these are the same value under the fingers, which is
      // where you actually want it while a paragraph is refusing to sit right.
      /*
       * No accelerator, for the same reason Focus and Typewriter have none:
       * the width is settled once for a session, not reached for mid sentence.
       * These had Command and a bracket, which the editor also gives to list
       * indentation, and a native accelerator is handled before the document
       * sees the key, so indenting a list item did nothing at all.
       */
      command('Wider', undefined, 'widen'),
      command('Narrower', undefined, 'narrow'),
      { type: 'separator' },
      // Zoom sits on Shift as it does in Typora, which leaves plain Command
      // with the plus and the minus for walking a block up and down the
      // heading scale. A menu accelerator wins over the editor's own keys, so
      // leaving zoom on its default would have made those two do nothing.
      { role: 'resetZoom', accelerator: 'CmdOrCtrl+Shift+0' },
      { role: 'zoomIn', accelerator: 'CmdOrCtrl+Shift+=' },
      { role: 'zoomOut', accelerator: 'CmdOrCtrl+Shift+-' },
      { type: 'separator' },
      { role: 'togglefullscreen' },
    ],
  };

  /* Where you were, and where you were going. The trail is three notes each
     way, from the author's plugin; the chord is the one it used. */
  const goMenu: MenuItemConstructorOptions = {
    label: '&Go',
    submenu: [
      command('Back', 'CmdOrCtrl+Alt+Left', 'navigate-back'),
      command('Forward', 'CmdOrCtrl+Alt+Right', 'navigate-forward'),
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
    paragraphMenu,
    formatMenu,
    viewMenu,
    goMenu,
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
