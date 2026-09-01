/**
 * Listing a folder for the sidebar.
 *
 * The renderer names a directory and main reads it, which makes this a place
 * where a compromised renderer could try to walk the whole disk. Every listing
 * is therefore confined to the folder the user actually chose: the target is
 * resolved through symlinks and must still be inside the root, and entries that
 * point outside are dropped rather than followed.
 *
 * Listing is one level deep. A recursive walk of a large folder would block the
 * main process and produce a tree nobody reads, so children arrive when a
 * directory is expanded.
 */

import { readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

export interface FileTreeEntryV1 {
  readonly name: string;
  readonly path: string;
  readonly kind: 'file' | 'directory';
}

/** Extensions the editor can actually open. Anything else is noise in a tree. */
const MARKDOWN = new Set(['.md', '.markdown', '.mdown', '.mkd', '.txt']);

/**
 * Directories never worth showing.
 *
 * Not a security measure, since the root check already provides that. These are
 * excluded because a repository's `node_modules` would bury the user's own
 * files under thousands of entries.
 */
const SKIPPED_DIRECTORIES = new Set([
  'node_modules', '.git', '.svn', '.hg', '.DS_Store', '__pycache__', '.venv',
]);

const MAX_ENTRIES = 2_000;

/** True when `target` is the root or sits inside it. */
export function isInside(root: string, target: string): boolean {
  if (target === root) return true;
  const relative = path.relative(root, target);
  return relative.length > 0 && !relative.startsWith('..') && !path.isAbsolute(relative);
}

/**
 * The real location of a path, or null when it cannot be resolved.
 *
 * Resolving before the containment check is what stops a symlink inside the
 * folder from being used as a door out of it.
 */
async function resolved(target: string): Promise<string | null> {
  try {
    return await realpath(target);
  } catch {
    return null;
  }
}

/**
 * Entries directly inside `target`, which must be within `root`.
 *
 * Throws when the target escapes the root, because that is a request the
 * renderer should never make and silently returning nothing would hide a bug.
 */
export async function listDirectory(root: string, target: string): Promise<FileTreeEntryV1[]> {
  const realRoot = await resolved(root);
  const realTarget = await resolved(target);
  if (!realRoot || !realTarget) throw new Error('WORKSPACE_PATH_UNREADABLE');
  if (!isInside(realRoot, realTarget)) throw new Error('WORKSPACE_PATH_OUTSIDE_ROOT');

  const entries = await readdir(realTarget, { withFileTypes: true });
  const results: FileTreeEntryV1[] = [];

  for (const entry of entries) {
    if (results.length >= MAX_ENTRIES) break;
    if (entry.name.startsWith('.')) continue;

    const entryPath = path.join(realTarget, entry.name);
    let kind: 'file' | 'directory';

    if (entry.isSymbolicLink()) {
      // Follow the link only far enough to decide what it is, and only when it
      // still lands inside the root.
      const linked = await resolved(entryPath);
      if (!linked || !isInside(realRoot, linked)) continue;
      try {
        kind = (await stat(linked)).isDirectory() ? 'directory' : 'file';
      } catch {
        continue;
      }
    } else if (entry.isDirectory()) {
      kind = 'directory';
    } else if (entry.isFile()) {
      kind = 'file';
    } else {
      continue;
    }

    if (kind === 'directory') {
      if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
    } else if (!MARKDOWN.has(path.extname(entry.name).toLowerCase())) {
      continue;
    }

    results.push({ name: entry.name, path: entryPath, kind });
  }

  // Folders first, then files, each alphabetically and case insensitively,
  // which is the order every file browser uses and the eye expects.
  return results.sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === 'directory' ? -1 : 1;
    return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
  });
}
