import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { expect, test } from '@playwright/test';

/**
 * What the shipped release build is allowed to contain.
 *
 * Replaces the retired release-surface spec, which asserted that test controls
 * were correctly gated. They are gone now, so this asserts they are absent
 * instead, which is the stronger property.
 */

const run = promisify(execFile);
const root = path.resolve(__dirname, '../..');

function releaseDirectory(): string {
  return path.join(root, `out/release/Noto-${process.platform}-${process.arch}`);
}

function releaseExecutable(): string {
  const directory = releaseDirectory();
  if (process.platform === 'darwin') return path.join(directory, 'Noto.app/Contents/MacOS/Noto');
  if (process.platform === 'win32') return path.join(directory, 'Noto.exe');
  return path.join(directory, 'noto');
}

async function exists(candidate: string): Promise<boolean> {
  try {
    await access(candidate);
    return true;
  } catch {
    return false;
  }
}

test.describe('release build surface', () => {
  // The release variant is built separately from the e2e variant, so these skip
  // rather than fail when only the e2e package is present.
  let packaged = false;
  test.beforeAll(async () => {
    packaged = await exists(releaseExecutable());
  });

  test('ships the executable and the asar Electron loads', async () => {
    test.skip(!packaged, 'run `pnpm package:release` first');
    expect(await exists(releaseExecutable())).toBe(true);
    const archive = process.platform === 'darwin'
      ? path.join(releaseDirectory(), 'Noto.app/Contents/Resources/app.asar')
      : path.join(releaseDirectory(), 'resources/app.asar');
    expect(await exists(archive)).toBe(true);
  });

  test('locks the release fuses that keep Node out of the packaged app', async () => {
    test.skip(!packaged, 'run `pnpm package:release` first');
    // Fuse inspection is only meaningful for the macOS bundle layout; the other
    // platforms are covered by the same Forge configuration.
    test.skip(process.platform !== 'darwin', 'fuse layout is macOS specific');

    // Invoked directly rather than through `pnpm exec`, whose own output would
    // otherwise be mixed in. The tool is not consistent about which stream it
    // reports on, so both are considered.
    const result = await run(
      path.join(root, 'node_modules/.bin/electron-fuses'),
      ['read', '--app', path.join(releaseDirectory(), 'Noto.app')],
      { cwd: root },
    );
    // The tool colourises its output, so the escape sequences have to come out
    // before the values can be matched.
    const stdout = `${result.stdout}\n${result.stderr}`.replace(/\u001B\[[0-9;]*m/g, '');
    expect(stdout).toContain('Fuse Version');

    // Release must not be able to run as plain Node, honour NODE_OPTIONS, or
    // accept an inspector, and must only load code from a validated asar.
    expect(stdout).toMatch(/RunAsNode\s+is\s+Disabled/i);
    expect(stdout).toMatch(/EnableNodeOptionsEnvironmentVariable\s+is\s+Disabled/i);
    expect(stdout).toMatch(/EnableNodeCliInspectArguments\s+is\s+Disabled/i);
    expect(stdout).toMatch(/OnlyLoadAppFromAsar\s+is\s+Enabled/i);
    expect(stdout).toMatch(/EnableEmbeddedAsarIntegrityValidation\s+is\s+Enabled/i);
  });

  test('exposes no test-only bridge in the packaged bundles', async () => {
    test.skip(!packaged, 'run `pnpm package:release` first');
    const buildRoot = process.platform === 'darwin'
      ? path.join(releaseDirectory(), 'Noto.app/Contents/Resources')
      : path.join(releaseDirectory(), 'resources');
    // The asar is a container, but the strings still appear in it verbatim, so
    // a leaked test channel would be visible here.
    const archive = await readFile(path.join(buildRoot, 'app.asar'), 'latin1');
    expect(archive).not.toContain('notoFileTruthTest');
    expect(archive).not.toContain('NTO_G003_TEST_CONTROLS');
    expect(archive).not.toContain('noto:file-truth:v1:test-control');
    expect(archive).not.toContain('noto:v1:test-control');
  });
});
