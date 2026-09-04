import { mkdir, rm, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, _electron as electron, type ElectronApplication } from '@playwright/test';
import { packagedExecutable } from './packaged-app';

async function invokeMenu(app: ElectronApplication, id: string): Promise<void> {
  await app.evaluate(({ Menu }, wanted) => {
    const find = (items: Electron.MenuItem[]): Electron.MenuItem | null => {
      for (const item of items) {
        if (item.id === wanted) return item;
        const nested = item.submenu ? find(item.submenu.items) : null;
        if (nested) return nested;
      }
      return null;
    };
    const target = find(Menu.getApplicationMenu()!.items);
    if (!target) throw new Error(`no menu item ${wanted}`);
    target.click();
  }, id);
}

test('the tree can be ordered and shut, and the order is remembered', async () => {
  const workspace = path.join(process.cwd(), 'test-results', 'tree-order');
  await rm(workspace, { recursive: true, force: true });
  const userData = path.join(workspace, 'user-data');
  await mkdir(userData, { recursive: true });
  const vault = path.join(workspace, 'vault');
  await mkdir(path.join(vault, 'folder'), { recursive: true });
  await writeFile(path.join(vault, 'folder', 'inside.md'), '# Inside\n', 'utf8');
  // Written oldest to newest, so the two orders differ.
  for (const [name, seconds] of [['apple.md', 1000], ['cherry.md', 3000], ['banana.md', 2000]] as const) {
    await writeFile(path.join(vault, name), `# ${name}\n`, 'utf8');
    await utimes(path.join(vault, name), seconds, seconds);
  }
  const launch = () => electron.launch({
    executablePath: packagedExecutable(),
    args: [`--user-data-dir=${userData}`, vault],
  });

  let app = await launch();
  try {
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.waitForSelector('[data-testid="file-tree"]', { state: 'visible', timeout: 30_000 });
    const files = () => page.getByTestId('tree-file').allTextContents();

    // By name to start with, the folder above the files.
    await expect.poll(files).toEqual(['apple.md', 'banana.md', 'cherry.md']);
    await expect(page.getByTestId('tree-directory').first()).toContainText('folder');

    await invokeMenu(app, 'tree-sort-modified');
    await expect.poll(files).toEqual(['cherry.md', 'banana.md', 'apple.md']);
    await invokeMenu(app, 'tree-sort-modified-old');
    await expect.poll(files).toEqual(['apple.md', 'banana.md', 'cherry.md']);
    await invokeMenu(app, 'tree-sort-name-desc');
    await expect.poll(files).toEqual(['cherry.md', 'banana.md', 'apple.md']);

    // Collapse All shuts a folder that was opened.
    await page.getByTestId('tree-directory').filter({ hasText: 'folder' }).click();
    await expect(page.getByTestId('tree-file').filter({ hasText: 'inside' })).toHaveCount(1);
    await invokeMenu(app, 'tree-collapse-all');
    await expect(page.getByTestId('tree-file').filter({ hasText: 'inside' })).toHaveCount(0);
  } finally {
    await app.close();
  }

  // The order is a setting, so it is still there next time.
  app = await launch();
  try {
    const page = await app.firstWindow();
    await page.waitForSelector('[data-testid="file-tree"]', { state: 'visible', timeout: 30_000 });
    await expect.poll(() => page.getByTestId('tree-file').allTextContents())
      .toEqual(['cherry.md', 'banana.md', 'apple.md']);
  } finally {
    await app.close();
  }
});
