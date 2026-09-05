/**
 * The folders quick open can search, derived from the notes it already has.
 *
 * The author's own quick open has three tabs, files, folders and content, and
 * the folders tab is not a second index: a vault's folders are exactly the
 * directories its notes live in, so they are counted out of the file index
 * this process already holds. Nothing is asked of main for it.
 *
 * Choosing a folder narrows the other two tabs to it, which is what makes the
 * tab worth having: a vault of seven thousand notes is searched a corner at a
 * time.
 */

import type { WorkspaceIndexEntryV1 } from '../shared/workspace/v1/contracts';

export interface FolderEntry {
  /** Vault-relative, with no leading or trailing slash. The root is ''. */
  readonly relativePath: string;
  /** The last segment, which is what the row is named by. */
  readonly name: string;
  /** How many notes are inside it, including its own subfolders. */
  readonly notes: number;
}

/**
 * Every folder that holds a note, with how many notes are under it.
 *
 * Counted through the whole subtree rather than one level, because a folder
 * row saying 2 next to a folder holding two hundred would be a lie about
 * where the notes are.
 */
export function foldersOf(entries: readonly WorkspaceIndexEntryV1[]): FolderEntry[] {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    const parts = entry.relativePath.split('/').slice(0, -1);
    let path = '';
    for (const part of parts) {
      path = path.length === 0 ? part : `${path}/${part}`;
      counts.set(path, (counts.get(path) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([relativePath, notes]) => ({
      relativePath,
      name: relativePath.split('/').at(-1) ?? relativePath,
      notes,
    }))
    .sort((left, right) => right.notes - left.notes
      || left.relativePath.localeCompare(right.relativePath, undefined, { sensitivity: 'base' }));
}

/** Whether a note is inside a folder, where the empty scope is the whole vault. */
export function insideScope(relativePath: string, scope: string): boolean {
  return scope.length === 0 || relativePath.startsWith(`${scope}/`);
}

/** The notes a scope leaves, in the order they came. */
export function withinScope<T extends { readonly relativePath: string }>(
  entries: readonly T[],
  scope: string,
): T[] {
  return scope.length === 0 ? [...entries] : entries.filter((entry) => insideScope(entry.relativePath, scope));
}
