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
  /**
   * The token this run is using.
   *
   * Held here as well as on disk, and this copy is the answer once there is
   * one. Without it, anything that made `current()` disagree with the file
   * would hand out a token the listening socket does not have: on Windows
   * the permission check below is meaningless, every read looked like a file
   * anyone could read, and the token was replaced on each call. The socket
   * kept the first one and refused every request made with the ones after it.
   */
  private held: string | null = null;

  constructor(private readonly filePath: string) {}

  /** The token this run is using, from the file or newly written. */
  async current(): Promise<string> {
    if (this.held !== null) return this.held;
    try {
      const info = await stat(this.filePath);
      // A token any other account can read is not a secret any more. Windows
      // does not carry its access rules in the mode, where every file looks
      // world readable, so the question is not asked there.
      if (process.platform === 'win32' || (info.mode & 0o077) === 0) {
        const written = (await readFile(this.filePath, 'utf8')).trim();
        if (written.length >= 20) {
          this.held = written;
          return written;
        }
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
    await chmod(this.filePath, PRIVATE).catch(() => {});
    this.held = token;
    return token;
  }
}
