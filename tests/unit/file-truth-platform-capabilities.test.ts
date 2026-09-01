import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { capabilitiesFor } from '../../src/main/file-truth/v1/platform-capabilities';
import { NodeFileTruthPlatform, objectIdentity } from '../../src/main/file-truth/v1/node-platform';

/**
 * Cross-platform behaviour, exercised on whatever host runs the suite.
 *
 * The Windows and Linux capability sets are applied explicitly rather than
 * inferred from `process.platform`, so the branches that only ever execute on
 * another OS are still covered here. What cannot be faked, mainly NTFS
 * semantics, is left to the CI matrix.
 */

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture(mode = 0o640) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'noto-caps-'));
  roots.push(root);
  const file = path.join(root, 'note.md');
  await writeFile(file, '# Title\n\nBody.\n', { mode });
  return { root, file };
}

describe('platform capabilities', () => {
  it('describes each supported platform honestly', () => {
    expect(capabilitiesFor('darwin')).toMatchObject({
      id: 'darwin', preservesPosixMode: true, canSyncDirectory: true,
    });
    expect(capabilitiesFor('linux')).toMatchObject({
      id: 'linux', preservesPosixMode: true, canSyncDirectory: true,
    });
    // Windows cannot verify POSIX bits and cannot fsync a directory handle.
    expect(capabilitiesFor('win32')).toMatchObject({
      id: 'win32', preservesPosixMode: false, canSyncDirectory: false,
    });
  });

  it('treats an unrecognised Unix platform as Linux rather than weakening guarantees', () => {
    expect(capabilitiesFor('freebsd')).toMatchObject({ id: 'linux', preservesPosixMode: true });
  });
});

describe('file object identity', () => {
  it('uses the device and inode pair when the filesystem provides one', () => {
    const identity = objectIdentity(66n, 1234n, '/tmp/note.md');
    expect(identity.scheme).toBe('noto-file-object-v1');
    expect(identity.basis).toBe('inode');
    expect(identity).not.toHaveProperty('dev');
  });

  it('says so when the filesystem reports no inode, instead of faking one', () => {
    const identity = objectIdentity(0n, 0n, '/tmp/note.md');
    expect(identity.basis).toBe('path');
  });

  it('distinguishes different objects and matches the same one', () => {
    expect(objectIdentity(1n, 2n, '/a').opaqueId).not.toBe(objectIdentity(1n, 3n, '/a').opaqueId);
    expect(objectIdentity(1n, 2n, '/a').opaqueId).toBe(objectIdentity(1n, 2n, '/b').opaqueId);
    // Path-based identity has to distinguish by path, since that is all it has.
    expect(objectIdentity(0n, 0n, '/a').opaqueId).not.toBe(objectIdentity(0n, 0n, '/b').opaqueId);
  });

  it('never leaks a raw device or inode number into the wire value', () => {
    expect(objectIdentity(66n, 1234n, '/tmp/note.md').opaqueId).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe('capture produces a platform-neutral fingerprint', () => {
  it('emits the neutral scheme on the host platform', async () => {
    const { file } = await fixture();
    const platform = new NodeFileTruthPlatform();
    const captured = await platform.capture(file);
    expect(captured.identity.fingerprint.object.scheme).toBe('noto-file-object-v1');
    expect(['inode', 'path']).toContain(captured.identity.fingerprint.object.basis);
  });
});

describe('mode handling follows the platform', () => {
  it('verifies exact permission bits where they round trip', async () => {
    const { file } = await fixture(0o640);
    const platform = new NodeFileTruthPlatform(undefined, capabilitiesFor('linux'));
    const handle = await platform.createExclusiveTemp(path.join(path.dirname(file), '.noto-ft1-modes.tmp'));
    try {
      await platform.applyAndVerifyMode(handle, 0o640);

      // Asking for the setuid and sticky bits must never report success unless
      // the filesystem actually stored them. Whether it does is a property of
      // the host, not of this code, so the invariant under test is the
      // agreement between the outcome and the bits on disk rather than an
      // assumption that the request fails.
      const requested = 0o7777;
      const outcome = await platform.applyAndVerifyMode(handle, requested)
        .then(() => 'granted' as const, (cause: unknown) => {
          expect(String(cause)).toMatch(/MODE_VERIFY_FAILED/);
          return 'refused' as const;
        });
      const stored = (await handle.stat()).mode & 0o7777;
      expect(outcome).toBe(stored === requested ? 'granted' : 'refused');
    } finally {
      await handle.close();
    }
  });

  it('skips the exact-bits check where the platform cannot honour it', async () => {
    const { file } = await fixture(0o640);
    const platform = new NodeFileTruthPlatform(undefined, capabilitiesFor('win32'));
    const handle = await platform.createExclusiveTemp(path.join(path.dirname(file), '.noto-ft1-win.tmp'));
    try {
      // On Windows this mode can never be observed back, so verifying it would
      // fail every save. The call still applies what the OS supports.
      await expect(platform.applyAndVerifyMode(handle, 0o7777)).resolves.toBeUndefined();
    } finally {
      await handle.close();
    }
  });

  it('does not fail a readback over permission bits the platform cannot preserve', async () => {
    const { file } = await fixture(0o640);
    const expected = new TextEncoder().encode('# Title\n\nBody.\n');
    const win = new NodeFileTruthPlatform(undefined, capabilitiesFor('win32'));
    // A mode the file certainly does not have; Windows must not reject on it.
    await expect(win.verifyReadback(file, expected, 0o600)).resolves.toBeTruthy();

    const unix = new NodeFileTruthPlatform(undefined, capabilitiesFor('linux'));
    await expect(unix.verifyReadback(file, expected, 0o600)).rejects.toThrow('READBACK_MODE_MISMATCH');
  });

  it('still detects changed bytes on every platform', async () => {
    const { file } = await fixture();
    const win = new NodeFileTruthPlatform(undefined, capabilitiesFor('win32'));
    await expect(win.verifyReadback(file, new TextEncoder().encode('different'), 0o640))
      .rejects.toThrow('READBACK_BYTES_MISMATCH');
  });
});

describe('directory durability follows the platform', () => {
  it('flushes the directory entry where the platform allows it', async () => {
    const { root } = await fixture();
    const platform = new NodeFileTruthPlatform(undefined, capabilitiesFor('linux'));
    await expect(platform.syncDirectory(root)).resolves.toBeUndefined();
  });

  it('skips the flush on Windows rather than failing the save', async () => {
    const { root } = await fixture();
    const platform = new NodeFileTruthPlatform(undefined, capabilitiesFor('win32'));
    // Opening a directory as a file throws on Windows. The capability check has
    // to short circuit before that, or every save would fail there.
    await expect(platform.syncDirectory(root)).resolves.toBeUndefined();
  });

  it('completes a durable write under Windows capabilities', async () => {
    const { root } = await fixture();
    const platform = new NodeFileTruthPlatform(undefined, capabilitiesFor('win32'));
    const target = path.join(root, 'journal', 'record.json');
    await platform.writeDurableFile(target, new TextEncoder().encode('{"stage":"cleanup"}\n'), 0o600);
    expect(await platform.exists(target)).toBe(true);
    expect((await stat(target)).size).toBeGreaterThan(0);
  });
});
