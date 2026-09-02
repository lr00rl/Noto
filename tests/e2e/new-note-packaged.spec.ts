import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { packagedExecutable } from './packaged-app';

const resultRoot = path.join(process.cwd(), 'test-results', 'new-note');

async function launch(name: string): Promise<{ app: ElectronApplication; page: Page; vault: string }> {
  const workspace = path.join(resultRoot, name);
  await rm(workspace, { recursive: true, force: true });
  const vault = path.join(workspace, 'vault');
  await mkdir(vault, { recursive: true });
  await mkdir(path.join(workspace, 'user-data'), { recursive: true });
  await writeFile(path.join(vault, 'existing.md'), '# Existing\n', 'utf8');
  const app = await electron.launch({
    executablePath: packagedExecutable(),
    args: [`--user-data-dir=${path.join(workspace, 'user-data')}`, vault],
  });
  const page = await app.firstWindow();
  await page.waitForSelector('[data-testid="file-tree"]', { state: 'visible', timeout: 30_000 });
  await page.setViewportSize({ width: 1100, height: 700 });
  return { app, page, vault };
}

async function invokeMenu(app: ElectronApplication, id: string): Promise<void> {
  await app.evaluate(({ Menu }, itemId) => {
    const find = (items: Electron.MenuItem[]): Electron.MenuItem | null => {
      for (const item of items) {
        if (item.id === itemId) return item;
        const nested = item.submenu ? find(item.submenu.items) : null;
        if (nested) return nested;
      }
      return null;
    };
    const menu = Menu.getApplicationMenu();
    const target = menu ? find(menu.items) : null;
    if (!target) throw new Error(`No menu item with id ${itemId}`);
    target.click();
  }, id);
}

test.describe('making a new note', () => {
  test('puts it in the open folder and opens it ready to write', async () => {
    const { app, page, vault } = await launch('create');
    try {
      await invokeMenu(app, 'new-file');

      await expect.poll(async () => readdir(vault)).toContain('Untitled.md');
      // It is the note in front, and it is empty.
      await expect(page.locator('.titlebar')).toContainText('Untitled.md');
      expect(await readFile(path.join(vault, 'Untitled.md'), 'utf8')).toBe('');

      // And it can be written to and saved like any other.
      await page.locator('.ProseMirror').click();
      await page.keyboard.type('First words.');
      await page.getByTestId('save-button').click();
      await expect.poll(async () => readFile(path.join(vault, 'Untitled.md'), 'utf8'))
        .toContain('First words.');
    } finally {
      await app.close();
    }
  });

  test('never writes over a note that is already there', async () => {
    const { app, page, vault } = await launch('collide');
    try {
      await writeFile(path.join(vault, 'Untitled.md'), '# Mine\n\nDo not lose this.\n', 'utf8');

      await invokeMenu(app, 'new-file');
      await expect.poll(async () => readdir(vault)).toContain('Untitled 2.md');

      // The one that was there is untouched.
      expect(await readFile(path.join(vault, 'Untitled.md'), 'utf8')).toBe('# Mine\n\nDo not lose this.\n');
      await expect(page.locator('.titlebar')).toContainText('Untitled 2.md');
    } finally {
      await app.close();
    }
  });

  test('says where a note would go when no folder is open', async () => {
    const workspace = path.join(resultRoot, 'nowhere');
    await rm(workspace, { recursive: true, force: true });
    await mkdir(path.join(workspace, 'user-data'), { recursive: true });
    const app = await electron.launch({
      executablePath: packagedExecutable(),
      args: [`--user-data-dir=${path.join(workspace, 'user-data')}`],
    });
    try {
      const page = await app.firstWindow();
      await page.waitForSelector('[data-testid="empty-state"]', { state: 'visible', timeout: 30_000 });
      await invokeMenu(app, 'new-file');
      await expect(page.locator('body')).toContainText('Open a folder first');
    } finally {
      await app.close();
    }
  });
});
