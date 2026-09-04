import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, _electron as electron } from '@playwright/test';
import { packagedExecutable } from './packaged-app';

test('the document font can be changed, and is remembered', async () => {
  const workspace = path.join(process.cwd(), 'test-results', 'prose-face');
  await rm(workspace, { recursive: true, force: true });
  const userData = path.join(workspace, 'user-data');
  await mkdir(userData, { recursive: true });
  const vault = path.join(workspace, 'vault');
  await mkdir(vault, { recursive: true });
  await writeFile(path.join(vault, 'note.md'), '# 字体\n\n这是一段中文。\n', 'utf8');
  const launch = () => electron.launch({
    executablePath: packagedExecutable(),
    args: [`--user-data-dir=${userData}`, vault],
  });

  let app = await launch();
  try {
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.waitForSelector('[data-testid="file-tree"]', { state: 'visible', timeout: 30_000 });
    await page.getByTestId('tree-file').first().click();
    const editor = page.locator('.canvas-slot:not([hidden]) .ProseMirror');
    await editor.waitFor({ state: 'visible' });
    const family = () => editor.evaluate((node) => getComputedStyle(node).fontFamily);
    expect(await family()).toContain('Songti');

    await page.getByTestId('settings-toggle').click();
    await page.waitForSelector('[data-testid="settings-panel"]', { state: 'visible' });
    // The Appearance pane is the one that opens; the face is in it.
    await page.getByTestId('face-mono').click();
    await page.getByTestId('settings-close').click();
    await expect.poll(family).toContain('Menlo');
  } finally {
    await app.close();
  }

  // The choice survives a restart, since it is written where the rest are.
  app = await launch();
  try {
    const page = await app.firstWindow();
    await page.waitForSelector('[data-testid="file-tree"]', { state: 'visible', timeout: 30_000 });
    await page.getByTestId('tree-file').first().click();
    const editor = page.locator('.canvas-slot:not([hidden]) .ProseMirror');
    await editor.waitFor({ state: 'visible' });
    await expect.poll(() => editor.evaluate((node) => getComputedStyle(node).fontFamily)).toContain('Menlo');
  } finally {
    await app.close();
  }
});
