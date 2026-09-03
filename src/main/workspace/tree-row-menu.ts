/**
 * The menu on a row of the file tree.
 *
 * Built here rather than inside the session so it can be read back in a test:
 * a native menu holds the input loop until somebody dismisses it, and no
 * automated pointer can reach one, so the only way to know what a row offers
 * is to build the template and look at it. The editor's own context menu is
 * kept apart for the same reason.
 *
 * Every action takes the path it was built with. Nothing here reads the path
 * again or resolves it: by the time this is called the caller has already
 * resolved it through any symlink and checked it against the open folder.
 */

import type { MenuItemConstructorOptions } from 'electron';

export interface TreeRowActions {
  readonly open: (target: string) => void;
  readonly newNote: (directory: string) => void;
  readonly reveal: (target: string) => void;
  readonly copyPath: (target: string) => void;
}

/** What the system calls the file manager, which differs on each of them. */
export function revealLabel(platform: NodeJS.Platform): string {
  if (platform === 'darwin') return 'Reveal in Finder';
  if (platform === 'win32') return 'Reveal in File Explorer';
  return 'Reveal in File Manager';
}

export function buildTreeRowMenu(
  target: string,
  kind: 'file' | 'directory',
  actions: TreeRowActions,
  platform: NodeJS.Platform = process.platform,
): MenuItemConstructorOptions[] {
  const items: MenuItemConstructorOptions[] = [];
  // A folder opens by being expanded, which the row already does on a click.
  if (kind === 'file') {
    items.push({ id: 'tree-open', label: 'Open', click: () => actions.open(target) });
  } else {
    // Where the reader pressed, not the folder's root, which is where the File
    // menu's New Note goes and is rarely the folder they are looking at.
    items.push({ id: 'tree-new-note', label: 'New Note Here', click: () => actions.newNote(target) });
  }
  items.push({ type: 'separator' });
  items.push({ id: 'tree-reveal', label: revealLabel(platform), click: () => actions.reveal(target) });
  items.push({ id: 'tree-copy-path', label: 'Copy Path', click: () => actions.copyPath(target) });
  return items;
}
