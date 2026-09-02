import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { packagedExecutable, placeCaret } from './packaged-app';

const resultRoot = path.join(process.cwd(), 'test-results', 'callout');

async function launch(name: string): Promise<{ app: ElectronApplication; page: Page; file: string }> {
  const workspace = path.join(resultRoot, name);
  await rm(workspace, { recursive: true, force: true });
  await mkdir(path.join(workspace, 'user-data'), { recursive: true });
  const file = path.join(workspace, 'note.md');
  await writeFile(file, '# Notes\n\nMind the gap.\n\nAnother paragraph.\n', 'utf8');
  const app = await electron.launch({
    executablePath: packagedExecutable(),
    args: [`--user-data-dir=${path.join(workspace, 'user-data')}`, `--open=${file}`],
  });
  const page = await app.firstWindow();
  await page.waitForSelector('[data-testid="noto-editor"]', { state: 'visible', timeout: 30_000 });
  await page.setViewportSize({ width: 1100, height: 700 });
  return { app, page, file };
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

test.describe('making a callout', () => {
  test('draws it as one and writes the marker the file holds', async () => {
    const { app, page, file } = await launch('make');
    try {
      await placeCaret(page, page.getByText('Mind the gap.'));
      await invokeMenu(app, 'block-alert-warning');

      // Drawn as a callout, with the title chip standing in for the marker.
      await expect(page.locator('.noto-alert-warning')).toBeVisible();
      await expect(page.locator('.noto-alert-title')).toContainText('Warning');

      await page.getByTestId('save-button').click();
      await expect.poll(async () => readFile(file, 'utf8')).toContain('> [!WARNING]\n> Mind the gap.');
    } finally {
      await app.close();
    }
  });

  test('switches kind rather than nesting a second callout', async () => {
    const { app, page, file } = await launch('switch');
    try {
      await placeCaret(page, page.getByText('Mind the gap.'));
      await invokeMenu(app, 'block-alert-warning');
      await expect(page.locator('.noto-alert-warning')).toBeVisible();
      await invokeMenu(app, 'block-alert-tip');

      await expect(page.locator('.noto-alert-tip')).toBeVisible();
      await expect(page.locator('.noto-alert-warning')).toHaveCount(0);

      await page.getByTestId('save-button').click();
      await expect.poll(async () => readFile(file, 'utf8')).toContain('> [!TIP]\n> Mind the gap.');
      const saved = await readFile(file, 'utf8');
      expect(saved).not.toContain('WARNING');
      // The paragraph that was not touched is untouched.
      expect(saved).toContain('Another paragraph.');
    } finally {
      await app.close();
    }
  });

  test('is undone by one press, not two', async () => {
    const { app, page } = await launch('undo');
    try {
      await placeCaret(page, page.getByText('Mind the gap.'));
      await invokeMenu(app, 'block-alert-note');
      await expect(page.locator('.noto-alert-note')).toBeVisible();

      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
      await expect(page.locator('.noto-alert-note')).toHaveCount(0);
      await expect(page.getByText('Mind the gap.')).toBeVisible();
    } finally {
      await app.close();
    }
  });
});
