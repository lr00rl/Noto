/**
 * Writing a pasted or dropped picture into the vault.
 *
 * Every part of the destination is decided here. The request carries bytes and
 * nothing else, so there is no filename, extension or folder that came from the
 * renderer for a mistake to ride in on. The folder comes from the setting, the
 * extension from the bytes, and the name from the clock.
 *
 * The containment rule is the one the asset protocol already enforces for
 * reading, and for the same reason: the configured folder is resolved through
 * every symbolic link and has to land inside a root the session trusts. A
 * vault whose `assets` is a link to somewhere else is a way out of the vault,
 * and a picture written through it would be a file the app then refuses to
 * show, which is the worst of both.
 *
 * The awkward ordering is deliberate and is the part worth reading twice: the
 * folder has to exist before it can be resolved, so a refusal has to undo the
 * folder it just made. Otherwise pasting into a note with a bad setting leaves
 * empty directories scattered wherever the setting pointed.
 */

import path from 'node:path';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import {
  hasImageExtension,
  NOTO_ASSETS_VERSION,
  toAssetUrl,
  type AssetWriteReplyV1,
} from '../../shared/assets/v1/contracts';
import { sniffImageExtension } from '../../shared/assets/v1/sniff';
import type { ImageDestinationV1, NotoSettingsV1 } from '../../shared/settings/v1/contracts';
import { isInside } from './file-tree';

export interface AssetWriteDeps {
  /** The note in front, whose folder every relative destination is read from. */
  readonly documentPath: string | null;
  /** Folders the session trusts, the same list the protocol serves from. */
  readonly roots: readonly string[];
  readonly settings: NotoSettingsV1;
  readonly realpath: (target: string) => Promise<string>;
  /** For the timestamped name. Injected so a test can pin it. */
  readonly now: () => Date;
}

const refuse = (reason: Exclude<AssetWriteReplyV1, { written: true }>['reason']): AssetWriteReplyV1 =>
  ({ version: NOTO_ASSETS_VERSION, written: false, reason });

/**
 * The folder a picture goes in, relative to the note's own folder.
 *
 * `note-assets` is Typora's `./${filename}.assets`, a folder named after the
 * note, so a vault of forty screenshots stays sorted by which note owns them.
 */
export function destinationFolder(
  destination: ImageDestinationV1,
  customFolder: string,
  noteDirectory: string,
  noteName: string,
): string {
  if (destination === 'folder') return noteDirectory;
  if (destination === 'assets') return path.join(noteDirectory, 'assets');
  if (destination === 'note-assets') {
    const stem = noteName.replace(/\.[^.]*$/, '');
    return path.join(noteDirectory, `${stem}.assets`);
  }
  const custom = customFolder.trim() === '' ? './images' : customFolder.trim();
  return path.isAbsolute(custom) ? path.normalize(custom) : path.resolve(noteDirectory, custom);
}

/**
 * yyyyMMddHHmmssSSS, which is what Typora names a pasted picture with.
 *
 * Local time rather than UTC, because the reader recognises the stamp on a file
 * they pasted this afternoon, and sorting is by name either way.
 */
export function timestampName(at: Date): string {
  const pad = (value: number, width = 2) => String(value).padStart(width, '0');
  return `image-${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}`
    + `${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}${pad(at.getMilliseconds(), 3)}`;
}

/**
 * The text that goes between the brackets.
 *
 * Always relative and always with forward slashes, so the note stays portable
 * across machines and platforms. Encoded per component, because a folder called
 * `my pictures` written raw makes the serializer emit `![a](<my pictures/x.png>)`
 * with angle brackets, which is valid markdown that other editors render and
 * that reads as noise in the source.
 */
export function noteRelativeReference(noteDirectory: string, target: string, escape: boolean): string {
  const relative = path.relative(noteDirectory, target).split(path.sep).join('/');
  const withPrefix = relative.startsWith('.') ? relative : `./${relative}`;
  if (!escape) return withPrefix;
  return withPrefix.split('/').map((part) => (part === '.' || part === '..' ? part : encodeURIComponent(part))).join('/');
}

export async function writeAsset(bytes: Uint8Array, deps: AssetWriteDeps): Promise<AssetWriteReplyV1> {
  if (!deps.documentPath) return refuse('no-document');
  const extension = sniffImageExtension(bytes);
  // The guard that serves pictures back reads the name, so a type it would not
  // serve must not be written under a name that claims otherwise.
  if (!extension || !hasImageExtension(`x${extension}`)) return refuse('unsupported-type');

  const noteDirectory = path.dirname(deps.documentPath);
  const folder = destinationFolder(
    deps.settings.imageDestination,
    deps.settings.imageCustomFolder,
    noteDirectory,
    path.basename(deps.documentPath),
  );

  let created: string | null = null;
  let realFolder: string;
  try {
    // Remember whether this call is what brought the folder into existence, so
    // only a folder we made is removed again on refusal.
    const madeRoot = await mkdir(folder, { recursive: true });
    created = typeof madeRoot === 'string' ? madeRoot : null;
    realFolder = await deps.realpath(folder);
  } catch {
    return refuse('write-failed');
  }

  const inside = await anyRootContains(deps.roots, realFolder, deps.realpath);
  if (!inside) {
    if (created) await rm(created, { recursive: true, force: true }).catch(() => {});
    return refuse('outside-root');
  }

  const stem = timestampName(deps.now());
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const name = attempt === 0 ? `${stem}${extension}` : `${stem}-${attempt + 1}${extension}`;
    const target = path.join(realFolder, name);
    try {
      // Fails rather than overwrites, so a picture already in the vault is
      // never replaced by one that happened to land on the same millisecond.
      await writeFile(target, bytes, { flag: 'wx' });
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'EEXIST') continue;
      if (created) await rm(created, { recursive: true, force: true }).catch(() => {});
      return refuse('write-failed');
    }
    return {
      version: NOTO_ASSETS_VERSION,
      written: true,
      reference: noteRelativeReference(noteDirectory, target, deps.settings.imageEscapeUrl),
      url: toAssetUrl(target),
      alt: name.slice(0, name.length - extension.length),
    };
  }
  return refuse('write-failed');
}

async function anyRootContains(
  roots: readonly string[],
  candidate: string,
  realpath: (target: string) => Promise<string>,
): Promise<boolean> {
  for (const root of roots) {
    try {
      if (isInside(await realpath(root), candidate)) return true;
    } catch {
      continue;
    }
  }
  return false;
}
