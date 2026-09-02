/**
 * Which files the renderer may have as images.
 *
 * The renderer names a path; this decides whether main serves it. The rule is
 * the same containment the file tree already enforces: the file must be inside
 * one of the roots the session trusts, after every symbolic link in the path
 * has been followed. A link inside the folder that points outside it is a way
 * out of the folder, so the real path is what is checked, never the one asked
 * for. And it must look like an image by its name: the app serves pictures,
 * and there is no reason for it to hand the renderer anything else.
 */

import path from 'node:path';
import { hasImageExtension } from '../../shared/assets/v1/contracts';
import { isInside } from '../workspace/file-tree';

export interface AssetGuardOptions {
  /** Folders the session trusts. Empty means nothing is served. */
  readonly roots: readonly string[];
  /** Follows links; rejects when the file does not exist. */
  readonly realpath: (target: string) => Promise<string>;
}

/** The real path to serve, or null when the request is refused for any reason. */
export async function resolveAssetPath(
  requested: string,
  options: AssetGuardOptions,
): Promise<string | null> {
  if (requested.length === 0 || requested.length > 4096 || /[\0\r\n]/.test(requested)) return null;
  if (!path.isAbsolute(requested)) return null;

  let real: string;
  try {
    real = await options.realpath(path.resolve(requested));
  } catch {
    return null;
  }
  if (!hasImageExtension(real)) return null;

  for (const root of options.roots) {
    let realRoot: string;
    try {
      realRoot = await options.realpath(path.resolve(root));
    } catch {
      continue;
    }
    if (isInside(realRoot, real)) return real;
  }
  return null;
}
