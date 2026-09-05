/**
 * The remote control's token, kept where only this account can read it.
 *
 * Written to a file of its own rather than into the settings, which are
 * ordinary configuration a person may copy about or paste into a bug report.
 * The file is made readable by its owner alone, and a file that arrives with
 * looser permissions than that is replaced rather than trusted.
 */

import { chmod, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { newToken } from './server';

/** Owner read and write, and nothing for anybody else. */
const PRIVATE = 0o600;

export class TokenStore {
  constructor(private readonly filePath: string) {}

  /** The token there, or a fresh one written now. */
  async current(): Promise<string> {
    try {
      const info = await stat(this.filePath);
      // A token any other account can read is not a secret any more.
      if ((info.mode & 0o077) === 0) {
        const held = (await readFile(this.filePath, 'utf8')).trim();
        if (held.length >= 20) return held;
      }
    } catch {
      // Not there yet, which is the ordinary first run.
    }
    return this.regenerate();
  }

  /** A new token, replacing whatever was there. */
  async regenerate(): Promise<string> {
    const token = newToken();
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, `${token}\n`, { encoding: 'utf8', mode: PRIVATE });
    // Written again, since an existing file keeps the mode it had.
    await chmod(this.filePath, PRIVATE);
    return token;
  }
}
