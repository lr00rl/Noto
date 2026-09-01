import { access, mkdir, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(scriptPath), '..');
const outRoot = path.join(root, 'out');
const expectedBundleId = 'dev.lr00rl.noto';
const require = createRequire(import.meta.url);

export function packageDirectoryName(platform, arch) {
  return `Noto-${platform}-${arch}`;
}

export function assertPackagingRuntime(version = process.versions.node) {
  const major = Number(version.split('.', 1)[0]);
  if (major !== 22) {
    throw new Error(`Packaging requires the installed Node 22 runtime; received Node ${version}`);
  }
}

export function isContainedPath(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative.length > 0 && !relative.startsWith('..') && !path.isAbsolute(relative);
}

async function exists(candidate) {
  try { await access(candidate); return true; } catch { return false; }
}

/**
 * The executable a packaged build produces, per platform.
 *
 * Exported so tests and the e2e suite resolve it the same way the packager
 * does, instead of each hardcoding a macOS bundle path.
 */
export function executableRelativePath(platform = process.platform) {
  if (platform === 'darwin') return path.join('Noto.app', 'Contents', 'MacOS', 'Noto');
  if (platform === 'win32') return 'Noto.exe';
  // Lower case on Linux, matching `executableName` in the Forge config, which
  // follows the convention for a binary on PATH.
  return 'noto';
}

/**
 * Confirm the directory really holds a Noto package before deleting or moving
 * anything, so a wrong path cannot turn a relocation into data loss.
 */
async function assertExpectedPackage(packageDirectory, platform = process.platform) {
  if (platform === 'darwin') {
    const plist = path.join(packageDirectory, 'Noto.app', 'Contents', 'Info.plist');
    const content = await readFile(plist, 'utf8');
    if (!content.includes(`<string>${expectedBundleId}</string>`)
      || !content.includes('<key>CFBundleExecutable</key>')
      || !content.includes('<string>Noto</string>')) {
      throw new Error(`Refusing package relocation for unexpected app identity at ${packageDirectory}`);
    }
    return;
  }
  // Windows and Linux produce a plain directory, so identity is the executable
  // plus the asar Electron actually loads.
  const executable = path.join(packageDirectory, executableRelativePath(platform));
  const archive = path.join(packageDirectory, 'resources', 'app.asar');
  if (!await exists(executable) || !await exists(archive)) {
    throw new Error(`Refusing package relocation for unexpected app identity at ${packageDirectory}`);
  }
}

async function runForge(variant, arch, stagingRoot, platform) {
  process.env.NTO_PACKAGE_VARIANT = variant;
  const { api } = require('@electron-forge/core');
  return api.package({
    dir: root,
    arch,
    platform,
    outDir: stagingRoot,
    // Never prompt. This runs in CI as often as it runs on a laptop.
    interactive: false,
  });
}

/**
 * Package the app, by default for the machine doing the packaging.
 *
 * The target is overridable because otherwise a platform can only ever be
 * packaged from itself, and a configuration mistake for a platform nobody has a
 * machine for stays invisible until someone with that machine tries. Packaging
 * a Windows tree from a laptop does not prove Noto runs on Windows, and is not
 * claimed to; it proves the Forge configuration produces the tree it should.
 */
export async function packageVariant(variant, target = {}) {
  assertPackagingRuntime();
  if (variant !== 'e2e' && variant !== 'release') throw new Error('Expected explicit e2e or release package variant');
  const platform = target.platform ?? process.platform;
  const arch = target.arch ?? process.arch;
  const directoryName = packageDirectoryName(platform, arch);
  const stagingRoot = path.join(outRoot, '.package-staging', variant);
  const destinationRoot = path.join(outRoot, variant);
  const destination = path.join(destinationRoot, directoryName);
  if (!isContainedPath(outRoot, stagingRoot)
    || !isContainedPath(outRoot, destinationRoot)
    || !isContainedPath(destinationRoot, destination)) {
    throw new Error('Package paths escaped the out directory');
  }

  await rm(stagingRoot, { recursive: true, force: true });
  await runForge(variant, arch, stagingRoot, platform);
  const source = path.join(stagingRoot, directoryName);
  if (!isContainedPath(stagingRoot, source) || path.basename(source) !== directoryName) {
    throw new Error('Forge package output escaped the expected staging directory');
  }
  await assertExpectedPackage(source, platform);
  if (await exists(destination)) await assertExpectedPackage(destination, platform);
  await mkdir(destinationRoot, { recursive: true });
  await rm(destination, { recursive: true, force: true });
  await rename(source, destination);
  process.stdout.write(`${destination}\n`);
  return destination;
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  const flag = (name) => {
    const match = process.argv.find((argument) => argument.startsWith(`--${name}=`));
    return match ? match.slice(name.length + 3) : undefined;
  };
  await packageVariant(process.argv[2], { platform: flag('platform'), arch: flag('arch') });
}
