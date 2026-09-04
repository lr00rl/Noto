/**
 * The stylesheets a reader can switch between, as Typora's Themes menu does.
 *
 * Typora keeps its themes in a folder and lists them on a menu; picking one
 * is the whole interaction, and opening the folder is how a new one gets in.
 * This does the same over a folder in the application's own support
 * directory, and picking one sets the custom stylesheet the editor already
 * knows how to load, so there is one path for a theme rather than two.
 *
 * The naming is pure and tested; the reading is one directory listing.
 */

import path from 'node:path';
import { mkdir, readdir } from 'node:fs/promises';

export interface ThemeFile {
  /** The file, absolute. */
  readonly path: string;
  /** What the menu calls it. */
  readonly label: string;
}

/** How many themes a menu will list before it is a folder, not a menu. */
export const MAX_THEMES = 60;

/**
 * A file name as a menu label: the extension goes, and the separators
 * between words become spaces, so `claude-like.css` reads as `Claude like`.
 * Nothing is capitalised beyond the first letter, since a theme called
 * `night_owl` is not a title.
 */
export function themeLabel(fileName: string): string {
  const stem = fileName.replace(/\.css$/i, '').replace(/[-_]+/g, ' ').trim();
  if (stem.length === 0) return fileName;
  return stem.charAt(0).toUpperCase() + stem.slice(1);
}

/** The themes in `folder`, by name, or nothing when there is no folder. */
export async function listThemes(folder: string): Promise<ThemeFile[]> {
  let names: string[];
  try {
    names = await readdir(folder);
  } catch {
    return [];
  }
  return names
    .filter((name) => name.toLowerCase().endsWith('.css') && !name.startsWith('.'))
    .sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' }))
    .slice(0, MAX_THEMES)
    .map((name) => ({ path: path.join(folder, name), label: themeLabel(name) }));
}

/** Make the folder if it is not there, so the menu's Open always has one to open. */
export async function ensureThemeFolder(folder: string): Promise<string> {
  try {
    await mkdir(folder, { recursive: true });
  } catch {
    // A folder that cannot be made is reported by the listing being empty.
  }
  return folder;
}
