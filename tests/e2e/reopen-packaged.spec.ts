import { mkdir, rm, writeFile } from 'node:fs/promises';
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

test('Reopen Closed File brings back the note closed last', async () => {
  const workspace = path.join(process.cwd(), 'test-results', 'reopen');
  await rm(workspace, { recursive: true, force: true });
  await mkdir(path.join(workspace, 'user-data'), { recursive: true });
  const vault = path.join(workspace, 'vault');
  await mkdir(vault, { recursive: true });
  await writeFile(path.join(vault, 'first.md'), '# First\n\nThe first note.\n', 'utf8');
  await writeFile(path.join(vault, 'second.md'), '# Second\n\nThe second note.\n', 'utf8');
  const app = await electron.launch({
    executablePath: packagedExecutable(),
    args: [`--user-data-dir=${path.join(workspace, 'user-data')}`, vault],
  });
  try {
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.waitForSelector('[data-testid="file-tree"]', { state: 'visible', timeout: 30_000 });
    const editor = page.locator('.canvas-slot:not([hidden]) .ProseMirror');
    await page.getByTestId('tree-file').filter({ hasText: 'first' }).click();
    await expect(editor).toContainText('The first note.');
    await page.getByTestId('tree-file').filter({ hasText: 'second' }).click();
    await expect(editor).toContainText('The second note.');

    // Close the second, then the first: nothing is open.
    await invokeMenu(app, 'close-tab');
    await expect(editor).toContainText('The first note.');
    await invokeMenu(app, 'close-tab');
    await expect(page.locator('.canvas-slot:not([hidden]) .ProseMirror')).toHaveCount(0);

    // Reopening brings the first back, the one closed last, then the second.
    await invokeMenu(app, 'reopen-closed');
    await expect(page.locator('.canvas-slot:not([hidden]) .ProseMirror')).toContainText('The first note.');
    await invokeMenu(app, 'reopen-closed');
    await expect(page.locator('.canvas-slot:not([hidden]) .ProseMirror')).toContainText('The second note.');
    // And with nothing left to reopen, nothing changes.
    await invokeMenu(app, 'reopen-closed');
    await expect(page.locator('.canvas-slot:not([hidden]) .ProseMirror')).toContainText('The second note.');
  } finally {
    await app.close();
  }
});
