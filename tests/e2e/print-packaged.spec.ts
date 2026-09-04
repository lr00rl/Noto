import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, _electron as electron } from '@playwright/test';
import { packagedExecutable } from './packaged-app';

test('Print sends the window to the system dialog with the chrome gone', async () => {
  const workspace = path.join(process.cwd(), 'test-results', 'print');
  await rm(workspace, { recursive: true, force: true });
  await mkdir(path.join(workspace, 'user-data'), { recursive: true });
  const vault = path.join(workspace, 'vault');
  await mkdir(vault, { recursive: true });
  await writeFile(path.join(vault, 'note.md'), '# Printed\n\nA paragraph to print.\n', 'utf8');
  const app = await electron.launch({
    executablePath: packagedExecutable(),
    args: [`--user-data-dir=${path.join(workspace, 'user-data')}`, vault],
  });
  try {
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.waitForSelector('[data-testid="file-tree"]', { state: 'visible', timeout: 30_000 });
    await page.getByTestId('tree-file').first().click();
    await page.locator('.canvas-slot:not([hidden]) .ProseMirror').waitFor({ state: 'visible' });

    // The system dialog cannot be driven, so the call into it is recorded.
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      const contents = window.webContents as unknown as {
        print: (options: unknown, callback: (ok: boolean, reason: string) => void) => void;
      };
      contents.print = (options, callback) => {
        (globalThis as unknown as { printed: unknown }).printed = options;
        callback(true, '');
      };
    });
    await app.evaluate(({ Menu }) => {
      const find = (items: Electron.MenuItem[]): Electron.MenuItem | null => {
        for (const item of items) {
          if (item.id === 'print') return item;
          const nested = item.submenu ? find(item.submenu.items) : null;
          if (nested) return nested;
        }
        return null;
      };
      find(Menu.getApplicationMenu()!.items)!.click();
    });
    await expect.poll(() => app.evaluate(() => (globalThis as unknown as { printed?: { printBackground?: boolean } }).printed))
      .toMatchObject({ printBackground: true });

    // On paper: the note, and none of the window around it.
    await page.emulateMedia({ media: 'print' });
    await expect(page.getByTestId('file-tree')).toBeHidden();
    await expect(page.locator('.operational-status')).toBeHidden();
    await expect(page.locator('.canvas-slot:not([hidden]) h1')).toBeVisible();
    await expect(page.locator('.canvas-slot:not([hidden]) h1')).toHaveText('Printed');
  } finally {
    await app.close();
  }
});
