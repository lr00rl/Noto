import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/shared/settings/v1/contracts';
import { coerceSettings, isSettingsWriteRequestV1 } from '../../src/shared/settings/v1/validate';
import { SettingsStore } from '../../src/main/workspace/settings-store';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function storeIn(contents?: string): Promise<{ store: SettingsStore; file: string }> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'noto-settings-'));
  roots.push(root);
  const file = path.join(root, 'settings.json');
  if (contents !== undefined) await writeFile(file, contents, 'utf8');
  return { store: new SettingsStore(file), file };
}

describe('reading settings', () => {
  it('starts from the defaults when there is no file', async () => {
    const { store } = await storeIn();
    expect(await store.load()).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps the readable fields when the file is partly corrupt', async () => {
    // A hand edited file with one good value and two bad ones must not cost the
    // user every preference.
    expect(coerceSettings({ theme: 'dark', measure: 'enormous', spellCheck: 'yes' })).toEqual({
      ...DEFAULT_SETTINGS,
      theme: 'dark',
    });
  });

  it('falls back completely when the file is not an object', async () => {
    const { store } = await storeIn('"not an object"');
    expect(await store.load()).toEqual(DEFAULT_SETTINGS);
  });

  it('falls back when the file is not valid JSON', async () => {
    const { store } = await storeIn('{ broken');
    expect(await store.load()).toEqual(DEFAULT_SETTINGS);
  });
});

describe('writing settings', () => {
  it('applies a patch and leaves the other settings alone', async () => {
    const { store } = await storeIn();
    const updated = await store.update({ theme: 'dark' });
    expect(updated.theme).toBe('dark');
    expect(updated.measure).toBe(DEFAULT_SETTINGS.measure);
    expect(updated.smartTypography).toBe(DEFAULT_SETTINGS.smartTypography);
  });

  it('persists across a restart', async () => {
    const { store, file } = await storeIn();
    await store.update({ theme: 'dark', measure: 'wide' });

    const reopened = new SettingsStore(file);
    expect(await reopened.load()).toMatchObject({ theme: 'dark', measure: 'wide' });
  });

  it('writes readable json', async () => {
    const { store, file } = await storeIn();
    await store.update({ spellCheck: false });
    expect(JSON.parse(await readFile(file, 'utf8'))).toMatchObject({ spellCheck: false });
  });
});

describe('validating a write from the renderer', () => {
  const base = { version: 1 as const, requestId: 'settings-1' };

  it('accepts a known key with the right type', () => {
    expect(isSettingsWriteRequestV1({ ...base, patch: { theme: 'dark' } })).toBe(true);
    expect(isSettingsWriteRequestV1({ ...base, patch: { spellCheck: false } })).toBe(true);
  });

  it('rejects an unknown key rather than dropping it silently', () => {
    expect(isSettingsWriteRequestV1({ ...base, patch: { nonsense: true } })).toBe(false);
  });

  it('rejects a known key with the wrong type or an invalid value', () => {
    expect(isSettingsWriteRequestV1({ ...base, patch: { theme: 'chartreuse' } })).toBe(false);
    expect(isSettingsWriteRequestV1({ ...base, patch: { spellCheck: 'yes' } })).toBe(false);
  });

  it('rejects an empty patch, which would be a write that changes nothing', () => {
    expect(isSettingsWriteRequestV1({ ...base, patch: {} })).toBe(false);
  });
});
