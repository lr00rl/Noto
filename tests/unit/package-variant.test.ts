import path from 'node:path';
import { access, readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
// @ts-expect-error The executable wrapper is intentionally plain Node ESM.
import { assertPackagingRuntime, executableRelativePath, isContainedPath, packageDirectoryName } from '../../scripts/package-variant.mjs';

describe('explicit package variants', () => {
  it('derives a platform package directory and enforces containment', () => {
    expect(packageDirectoryName('darwin', 'arm64')).toBe('Noto-darwin-arm64');
    expect(isContainedPath('/tmp/noto/out', '/tmp/noto/out/release/Noto-darwin-arm64')).toBe(true);
    expect(isContainedPath('/tmp/noto/out', path.resolve('/tmp/noto/out', '..', 'victim'))).toBe(false);
  });

  it('resolves the packaged executable for every platform Noto ships to', () => {
    // Each platform lays the package out differently, and the e2e suite has to
    // find the binary on all three rather than assuming a macOS bundle.
    expect(executableRelativePath('darwin')).toBe(path.join('Noto.app', 'Contents', 'MacOS', 'Noto'));
    expect(executableRelativePath('win32')).toBe('Noto.exe');
    // Lower case on Linux. This is not a style choice: the Forge config sets
    // `executableName` to `noto` there, so anything looking for `Noto` would
    // not find the binary that was actually built.
    expect(executableRelativePath('linux')).toBe('noto');
  });

  it('fails closed outside the executed Node 22 packaging runtime', () => {
    expect(() => assertPackagingRuntime('22.19.0')).not.toThrow();
    expect(() => assertPackagingRuntime('26.5.0')).toThrow(/requires the installed Node 22 runtime/);
  });

  it('keeps plugin manifests in the resource tree selected by Forge packaging', async () => {
    const forgeSource = await readFile(new URL('../../forge.config.ts', import.meta.url), 'utf8');
    expect(forgeSource).toContain("path.resolve(__dirname, 'resources')");
    await expect(access(new URL('../../resources/plugins/renderer-proof/manifest.json', import.meta.url)))
      .resolves.toBeUndefined();
    await expect(access(new URL('../../resources/plugins/filesystem-proof/manifest.json', import.meta.url)))
      .resolves.toBeUndefined();
  });
});
