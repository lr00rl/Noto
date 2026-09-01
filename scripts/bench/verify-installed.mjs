/**
 * Launches Noto from where a package manager installed it.
 *
 * Building a `.deb` proves a file can be produced. It does not prove the file
 * installs, that its declared dependencies are the ones it actually needs, or
 * that the binary starts once it is on the system rather than in a build
 * directory. This drives the installed application the same way the packaged
 * suite drives the built one.
 *
 * usage: node verify-installed.mjs <path-to-installed-binary>
 */

import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { _electron as electron } from 'playwright';

const binary = process.argv[2];
if (!binary) {
  process.stderr.write('usage: verify-installed.mjs <binary>\n');
  process.exit(2);
}

const workspace = '/tmp/noto-installed-check';
await rm(workspace, { recursive: true, force: true });
await mkdir(path.join(workspace, 'user-data'), { recursive: true });

const file = path.join(workspace, 'installed.md');
await writeFile(file, '# Installed\n\nOpened from a packaged install.\n', 'utf8');

const app = await electron.launch({
  executablePath: binary,
  args: [`--user-data-dir=${path.join(workspace, 'user-data')}`, '--no-sandbox'],
});

try {
  const page = await app.firstWindow();
  await page.waitForSelector('[data-testid="empty-state"]', { state: 'visible', timeout: 60_000 });
  process.stdout.write('installed app: window opened\n');

  // Opening a document exercises the whole chain the shell depends on: the
  // workspace IPC, the file-truth store and the editor.
  await page.evaluate((target) => window.notoWorkspace.openPath({
    version: 1, requestId: 'installed-check', path: target,
  }), file);
  await page.waitForSelector('.ProseMirror', { state: 'visible', timeout: 60_000 });

  const heading = await page.locator('.ProseMirror h1').first().innerText();
  const body = await page.locator('.ProseMirror p').first().innerText();
  process.stdout.write(`installed app: rendered heading "${heading}"\n`);
  process.stdout.write(`installed app: rendered body "${body}"\n`);

  if (heading !== 'Installed') throw new Error(`unexpected heading: ${heading}`);
  process.stdout.write('installed app: OK\n');
} finally {
  await app.close();
}
