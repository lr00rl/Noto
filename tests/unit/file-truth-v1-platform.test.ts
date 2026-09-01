import { chmod, mkdtemp, readFile, rename, rm, stat, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FileTruthPlatformOperationError, NodeFileTruthPlatform } from '../../src/main/file-truth/v1/node-platform';

const roots: string[] = [];
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'noto-ft1-platform-'));
  roots.push(root);
  const file = path.join(root, 'note.md');
  await writeFile(file, '# Note\n\nOriginal\n', { mode: 0o640 });
  return { root, file, platform: new NodeFileTruthPlatform() };
}
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

describe('macOS Node file-truth adapter', () => {
  it('captures content, object identity, nanosecond mtime, and POSIX mode from an opened handle', async () => {
    const { file, platform } = await fixture();
    const first = await platform.capture(file);
    expect(first.identity).toMatchObject({ version: 1, posixMode: 0o640 });
    expect(first.identity.canonicalPath).toBe(await import('node:fs/promises').then(({ realpath }) => realpath(file)));
    expect(first.identity.fingerprint.object.scheme).toBe('noto-file-object-v1');
    expect(first.identity.fingerprint.contentSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(first.identity.fingerprint.mtimeNanoseconds).toMatch(/^\d+$/);
  });

  it('detects same-length replacement with restored mtime and object transition', async () => {
    const { root, file, platform } = await fixture();
    const beforeStat = await stat(file);
    const before = await platform.capture(file);
    const replacement = path.join(root, 'replacement');
    const bytes = Buffer.from(await readFile(file));
    bytes[bytes.length - 2] = bytes[bytes.length - 2] === 0x61 ? 0x62 : 0x61;
    await writeFile(replacement, bytes, { mode: 0o640 });
    await utimes(replacement, beforeStat.atime, beforeStat.mtime);
    await rename(replacement, file);
    const after = await platform.capture(file);
    expect(after.identity.fingerprint.byteLength).toBe(before.identity.fingerprint.byteLength);
    expect(after.identity.fingerprint.contentSha256).not.toBe(before.identity.fingerprint.contentSha256);
    expect(after.identity.fingerprint.object.opaqueId).not.toBe(before.identity.fingerprint.object.opaqueId);
    expect(platform.sameFingerprint(before.identity.fingerprint, after.identity.fingerprint)).toBe(false);
  });

  it('uses same-directory exclusive owned temps and preserves mode through verified replacement', async () => {
    const { file, platform } = await fixture();
    const temp = platform.tempPathFor(file, 'attempt-1');
    expect(path.dirname(temp)).toBe(path.dirname(file));
    expect(path.basename(temp)).toMatch(/^\.noto-ft1-attempt-1\.tmp$/);
    const handle = await platform.createExclusiveTemp(temp);
    await platform.writeTemp(handle, Buffer.from('# Changed\n'));
    await platform.flush(handle);
    await platform.applyAndVerifyMode(handle, 0o640);
    await handle.close();
    await platform.replace(temp, file);
    await platform.syncDirectory(path.dirname(file));
    const identity = await platform.verifyReadback(file, Buffer.from('# Changed\n'), 0o640);
    expect(identity.posixMode).toBe(0o640);
    expect((await stat(file)).mode & 0o7777).toBe(0o640);
  });

  it('runs expected-fingerprint validation and beforeReplace immediately before rename', async () => {
    const { file, platform } = await fixture();
    const captured = await platform.capture(file);
    const blockedTemp = platform.tempPathFor(file, 'blocked-validation');
    const blockedHandle = await platform.createExclusiveTemp(blockedTemp);
    await platform.writeTemp(blockedHandle, Buffer.from('# Blocked\n'));
    await platform.closeHandle(blockedHandle);
    platform.injector.arm('before-replace-validation');
    await expect(platform.validateExpectedAndReplace(blockedTemp, file, captured.identity.fingerprint)).rejects.toThrow('before-replace-validation');
    expect(await readFile(file, 'utf8')).toContain('Original');
    expect(await platform.exists(blockedTemp)).toBe(true);
    await rm(blockedTemp);

    const temp = platform.tempPathFor(file, 'validated');
    const handle = await platform.createExclusiveTemp(temp);
    await platform.writeTemp(handle, Buffer.from('# Validated\n'));
    await platform.closeHandle(handle);
    let beforeReplace = false;
    expect(await platform.validateExpectedAndReplace(temp, file, captured.identity.fingerprint, () => { beforeReplace = true; })).toEqual({ status: 'replaced' });
    expect(beforeReplace).toBe(true);
    expect(await readFile(file, 'utf8')).toBe('# Validated\n');
  });

  it('returns a discriminated conflict when the final target is missing', async () => {
    const { file, platform } = await fixture();
    const captured = await platform.capture(file);
    const temp = platform.tempPathFor(file, 'missing-target');
    const handle = await platform.createExclusiveTemp(temp);
    await platform.writeTemp(handle, Buffer.from('# Candidate\n'));
    await platform.closeHandle(handle);
    await rm(file);
    expect(await platform.validateExpectedAndReplace(temp, file, captured.identity.fingerprint)).toEqual({ status: 'conflict', current: null });
    expect(await platform.exists(temp)).toBe(true);
  });

  it('reports missing fingerprints and refuses symlinks', async () => {
    const { root, file, platform } = await fixture();
    await rm(file);
    expect(await platform.fingerprint(file)).toBeNull();
    await writeFile(file, 'x');
    const link = path.join(root, 'link.md');
    await import('node:fs/promises').then(({ symlink }) => symlink(file, link));
    await expect(platform.capture(link)).rejects.toThrow('UNSUPPORTED_FILE_TYPE');
    await chmod(file, 0o600);
  });

  it.each(['EACCES', 'EIO'])('exists propagates %s instead of masking it as absence', async (code) => {
    class FailingExistsPlatform extends NodeFileTruthPlatform {
      protected override async statPath(): Promise<never> {
        throw Object.assign(new Error(`stat ${code}`), { code });
      }
    }
    await expect(new FailingExistsPlatform().exists('/not-observed')).rejects.toMatchObject({ code });
  });

  it('reports close and journal-read failures deterministically', async () => {
    const { root, platform } = await fixture();
    const temp = path.join(root, 'close-evidence.tmp');
    const handle = await platform.createExclusiveTemp(temp);
    platform.injector.arm('temp-close');
    await expect(platform.closeHandle(handle)).rejects.toThrow('temp-close');
    await writeFile(path.join(root, 'journal.json'), '{}');
    platform.injector.arm('journal-read');
    await expect(platform.readBytes(path.join(root, 'journal.json'), true)).rejects.toThrow('journal-read');
  });

  it.each(['durable-write', 'durable-sync', 'durable-rename'] as const)('cleans private durable temp after %s failure', async (point) => {
    const { root, platform } = await fixture();
    const target = path.join(root, 'record.payload');
    platform.injector.arm(point);
    await expect(platform.writeDurableFile(target, Buffer.from('candidate'))).rejects.toBeInstanceOf(FileTruthPlatformOperationError);
    expect(await platform.listDurableInternalTemps(root)).toEqual([]);
  });

  it('reports the exact private durable temp when its cleanup also fails', async () => {
    const { root, platform } = await fixture();
    const target = path.join(root, 'record.payload');
    platform.injector.arm('durable-write');
    platform.injector.arm('durable-remove');
    const error = await platform.writeDurableFile(target, Buffer.from('candidate')).catch((value) => value);
    expect(error).toBeInstanceOf(FileTruthPlatformOperationError);
    expect(error.residuePaths).toHaveLength(1);
    expect(error.residuePaths[0]).toMatch(/record\.payload\.tmp-[a-f0-9]+$/);
    expect(await platform.listDurableInternalTemps(root)).toEqual(error.residuePaths);
    await rm(error.residuePaths[0], { force: true });
  });

  it('discovers stale private payload and journal temps without including unrelated files', async () => {
    const { root, platform } = await fixture();
    const payloadTemp = path.join(root, 'record.payload.tmp-acde');
    const journalTemp = path.join(root, 'record.journal.json.tmp-beef');
    await writeFile(payloadTemp, 'payload');
    await writeFile(journalTemp, 'journal');
    await writeFile(path.join(root, 'unrelated.tmp-acde'), 'other');
    expect((await platform.listDurableInternalTemps(root)).sort()).toEqual([journalTemp, payloadTemp].sort());
  });

  it('never deletes an externally replaced copy destination while reporting publish failure', async () => {
    const { root, platform } = await fixture();
    const target = path.join(root, 'copy.md');
    const temp = platform.tempPathFor(target, 'copy-ownership');
    const expected = Buffer.from('# Copy\n');
    const external = Buffer.from('# External copy writer\n');
    const handle = await platform.createExclusiveTemp(temp);
    await platform.writeTemp(handle, expected);
    await platform.flush(handle);
    await platform.applyAndVerifyMode(handle, 0o640);
    await platform.closeHandle(handle);
    platform.verifyReadback = async () => {
      await platform.replaceExternally(target, external);
      throw new Error('readback interrupted after external replacement');
    };
    await expect(platform.publishExclusive(temp, target, expected, 0o640)).rejects.toBeInstanceOf(FileTruthPlatformOperationError);
    expect(Buffer.from(await readFile(target)).equals(external)).toBe(true);
    expect(await platform.exists(temp)).toBe(false);
  });
});
