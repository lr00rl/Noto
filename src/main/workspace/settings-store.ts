/**
 * Reading and writing user settings.
 *
 * Same reasoning as the recent files list: small enough to rewrite whole, and
 * losing it costs a preference rather than a document, so it uses an atomic
 * replace instead of the file-truth journal.
 */

import path from 'node:path';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import {
  DEFAULT_SETTINGS,
  type NotoSettingsV1,
} from '../../shared/settings/v1/contracts';
import { coerceSettings } from '../../shared/settings/v1/validate';

export class SettingsStore {
  private settings: NotoSettingsV1 = DEFAULT_SETTINGS;
  private loaded = false;

  constructor(private readonly filePath: string) {}

  async load(): Promise<NotoSettingsV1> {
    if (this.loaded) return this.settings;
    this.loaded = true;
    try {
      this.settings = coerceSettings(JSON.parse(await readFile(this.filePath, 'utf8')));
    } catch {
      // Missing on first run, and unreadable if it was hand edited badly.
      // Neither is worth interrupting the user for.
      this.settings = DEFAULT_SETTINGS;
    }
    return this.settings;
  }

  current(): NotoSettingsV1 {
    return this.settings;
  }

  /**
   * Apply a partial change.
   *
   * A patch rather than a whole object, so a renderer that knows about fewer
   * settings than the running build cannot erase the ones it does not know.
   */
  async update(patch: Partial<NotoSettingsV1>): Promise<NotoSettingsV1> {
    await this.load();
    this.settings = coerceSettings({ ...this.settings, ...patch });
    await this.persist();
    return this.settings;
  }

  private async persist(): Promise<void> {
    const temporary = `${this.filePath}.tmp`;
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(temporary, `${JSON.stringify(this.settings, null, 2)}\n`, 'utf8');
    await rename(temporary, this.filePath);
  }
}
