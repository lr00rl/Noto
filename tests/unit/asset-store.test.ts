import { mkdir, mkdtemp, readdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  destinationFolder,
  noteRelativeReference,
  timestampName,
  writeAsset,
} from '../../src/main/workspace/asset-store';
import { DEFAULT_SETTINGS, type NotoSettingsV1 } from '../../src/shared/settings/v1/contracts';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 1, 2, 3]);

let base: string;
let vault: string;
let note: string;

const settings = (patch: Partial<NotoSettingsV1> = {}): NotoSettingsV1 => ({ ...DEFAULT_SETTINGS, ...patch });

const deps = (patch: Partial<NotoSettingsV1> = {}, documentPath: string | null = note) => ({
  documentPath,
  roots: [vault],
  settings: settings(patch),
  realpath,
  now: () => new Date(2026, 8, 2, 19, 5, 30, 123),
});

beforeEach(async () => {
  base = await realpath(await mkdtemp(path.join(os.tmpdir(), 'noto-asset-store-')));
  vault = path.join(base, 'vault');
  await mkdir(path.join(vault, 'notes'), { recursive: true });
  note = path.join(vault, 'notes', 'a note.md');
  await writeFile(note, '# a');
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

describe('destinationFolder', () => {
  it('puts the four choices where they say they go', () => {
    expect(destinationFolder('folder', '', '/v/n', 'a.md')).toBe('/v/n');
    expect(destinationFolder('assets', '', '/v/n', 'a.md')).toBe('/v/n/assets');
    expect(destinationFolder('note-assets', '', '/v/n', 'a.md')).toBe('/v/n/a.assets');
    expect(destinationFolder('custom', './pics', '/v/n', 'a.md')).toBe('/v/n/pics');
    expect(destinationFolder('custom', '/elsewhere', '/v/n', 'a.md')).toBe('/elsewhere');
  });

  it('strips only the last extension from a note name', () => {
    expect(destinationFolder('note-assets', '', '/v', 'notes.v2.md')).toBe('/v/notes.v2.assets');
  });

  it('falls back when the custom folder is blank', () => {
    expect(destinationFolder('custom', '   ', '/v', 'a.md')).toBe('/v/images');
  });
});

describe('timestampName', () => {
  it('is the stamp Typora writes, to the millisecond', () => {
    expect(timestampName(new Date(2026, 8, 2, 19, 5, 30, 7))).toBe('image-20260902190530007');
  });
});

describe('noteRelativeReference', () => {
  it('encodes a space so the serializer does not fall back to angle brackets', () => {
    expect(noteRelativeReference('/v/n', '/v/n/my pics/a.png', true)).toBe('./my%20pics/a.png');
  });

  it('leaves it alone when escaping is off', () => {
    expect(noteRelativeReference('/v/n', '/v/n/my pics/a.png', false)).toBe('./my pics/a.png');
  });

  it('encodes a Chinese folder name, which a real vault is full of', () => {
    expect(noteRelativeReference('/v', '/v/图片/a.png', true)).toBe(`./${encodeURIComponent('图片')}/a.png`);
  });

  it('keeps the dot segments of a path that climbs out of the note folder', () => {
    expect(noteRelativeReference('/v/n', '/v/shared/a.png', true)).toBe('../shared/a.png');
  });
});

describe('writeAsset', () => {
  it('writes into ./assets beside the note and answers with a relative reference', async () => {
    const reply = await writeAsset(PNG, deps());
    expect(reply.written).toBe(true);
    if (!reply.written) return;
    expect(reply.reference).toBe('./assets/image-20260902190530123.png');
    expect(reply.alt).toBe('image-20260902190530123');
    const written = await readFile(path.join(vault, 'notes', 'assets', 'image-20260902190530123.png'));
    expect(new Uint8Array(written)).toEqual(PNG);
  });

  it('refuses when no note is open, rather than guessing a folder', async () => {
    const reply = await writeAsset(PNG, deps({}, null));
    expect(reply).toEqual({ version: 1, written: false, reason: 'no-document' });
  });

  it('refuses bytes that are not a picture it could serve back', async () => {
    const reply = await writeAsset(new TextEncoder().encode('%PDF-1.7 and so on'), deps());
    expect(reply).toEqual({ version: 1, written: false, reason: 'unsupported-type' });
  });

  it('refuses a folder outside the vault and leaves nothing behind where it pointed', async () => {
    const reply = await writeAsset(PNG, deps({ imageDestination: 'custom', imageCustomFolder: path.join(base, 'outside', 'pics') }));
    expect(reply).toEqual({ version: 1, written: false, reason: 'outside-root' });
    // The guard has to create the folder before it can resolve it, so the
    // refusal must undo that. Otherwise a bad setting scatters empty folders.
    await expect(readdir(path.join(base, 'outside'))).rejects.toThrow();
  });

  it('refuses a folder that is a link out of the vault', async () => {
    await mkdir(path.join(base, 'outside'), { recursive: true });
    await symlink(path.join(base, 'outside'), path.join(vault, 'notes', 'assets'));
    const reply = await writeAsset(PNG, deps());
    expect(reply).toEqual({ version: 1, written: false, reason: 'outside-root' });
    expect(await readdir(path.join(base, 'outside'))).toEqual([]);
  });

  it('keeps a folder that already existed when it refuses for another reason', async () => {
    await mkdir(path.join(vault, 'notes', 'assets'), { recursive: true });
    await writeFile(path.join(vault, 'notes', 'assets', 'keep.png'), 'x');
    const reply = await writeAsset(new TextEncoder().encode('not a picture'), deps());
    expect(reply.written).toBe(false);
    expect(await readdir(path.join(vault, 'notes', 'assets'))).toEqual(['keep.png']);
  });

  it('never overwrites a picture that is already there on the same millisecond', async () => {
    const first = await writeAsset(PNG, deps());
    const second = await writeAsset(PNG, deps());
    expect(first.written && second.written).toBe(true);
    if (!first.written || !second.written) return;
    expect(first.reference).toBe('./assets/image-20260902190530123.png');
    expect(second.reference).toBe('./assets/image-20260902190530123-2.png');
  });

  it('writes beside the note when the destination is the note folder', async () => {
    const reply = await writeAsset(PNG, deps({ imageDestination: 'folder' }));
    expect(reply.written && reply.reference).toBe('./image-20260902190530123.png');
  });

  it('names the folder after the note when asked to', async () => {
    const reply = await writeAsset(PNG, deps({ imageDestination: 'note-assets' }));
    expect(reply.written && reply.reference).toBe('./a%20note.assets/image-20260902190530123.png');
  });

  it('does not encode the reference when the reader turned escaping off', async () => {
    const reply = await writeAsset(PNG, deps({ imageDestination: 'note-assets', imageEscapeUrl: false }));
    expect(reply.written && reply.reference).toBe('./a note.assets/image-20260902190530123.png');
  });

  it('gives the picture a URL the renderer can show it with', async () => {
    const reply = await writeAsset(PNG, deps());
    expect(reply.written && reply.url).toContain(encodeURIComponent(path.join(vault, 'notes', 'assets')));
  });
});
