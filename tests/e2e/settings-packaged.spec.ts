import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { packagedExecutable } from './packaged-app';

const resultRoot = path.join(process.cwd(), 'test-results', 'settings');


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

interface Workspace {
  app: ElectronApplication;
  page: Page;
  userData: string;
}

async function launch(name: string, reuse?: string): Promise<Workspace> {
  const workspace = path.join(resultRoot, name);
  const userData = reuse ?? path.join(workspace, 'user-data');
  if (!reuse) {
    await rm(workspace, { recursive: true, force: true });
    await mkdir(userData, { recursive: true });
  }
  const file = path.join(workspace, 'notes.md');
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, '# Notes\n\nBody.\n', 'utf8');

  const app = await electron.launch({
    executablePath: packagedExecutable(),
    args: [`--user-data-dir=${userData}`, `--open=${file}`],
  });
  const page = await app.firstWindow();
  await page.waitForSelector('[data-testid="noto-editor"]', { state: 'visible', timeout: 30_000 });
  await page.setViewportSize({ width: 1280, height: 900 });
  return { app, page, userData };
}

/** The measure, as the document actually resolved it. */
const measureOf = (page: Page) => page.evaluate(
  () => getComputedStyle(document.documentElement).getPropertyValue('--measure').trim(),
);

test.describe('settings', () => {
  test('opens from the menu and closes again', async () => {
    const { app, page } = await launch('open');
    try {
      await expect(page.getByTestId('settings-panel')).toBeHidden();
      await invokeMenu(app, 'settings');
      await expect(page.getByTestId('settings-panel')).toBeVisible();

      await page.getByTestId('settings-close').click();
      await expect(page.getByTestId('settings-panel')).toBeHidden();
    } finally {
      await app.close();
    }
  });

  test('applies a theme change immediately', async () => {
    const { app, page } = await launch('theme');
    try {
      await invokeMenu(app, 'settings');
      await page.getByTestId('theme-dark').click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

      await page.getByTestId('theme-light').click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    } finally {
      await app.close();
    }
  });

  test('changes the width of the text column', async () => {
    const { app, page } = await launch('measure');
    try {
      const host = page.locator('.noto-editor-host');
      const before = (await host.boundingBox())?.width ?? 0;

      // The measure is a number of characters now rather than three presets,
      // so the control is a slider and the column follows the value.
      await invokeMenu(app, 'settings');
      await page.getByTestId('setting-measure').fill('48');
      await expect.poll(() => measureOf(page)).toBe('48ch');
      const narrow = (await host.boundingBox())?.width ?? 0;

      await page.getByTestId('setting-measure').fill('96');
      await page.waitForTimeout(150);
      const wide = (await host.boundingBox())?.width ?? 0;

      expect(narrow).toBeLessThan(before);
      expect(wide).toBeGreaterThan(narrow);
    } finally {
      await app.close();
    }
  });

  test('turns spell checking off in the editor', async () => {
    const { app, page } = await launch('spell');
    try {
      await expect(page.locator('.ProseMirror')).toHaveAttribute('spellcheck', 'true');
      await invokeMenu(app, 'settings');
      // Editing settings live in their own section of preferences.
      await page.getByTestId('pref-editor').click();
      await page.getByTestId('setting-spell-check').uncheck();
      await page.getByTestId('settings-close').click();
      await expect(page.locator('.ProseMirror')).toHaveAttribute('spellcheck', 'false');
    } finally {
      await app.close();
    }
  });

  test('remembers the choice across a restart, and writes it where it says', async () => {
    const first = await launch('persist');
    try {
      await invokeMenu(first.app, 'settings');
      await first.page.getByTestId('theme-dark').click();
      await first.page.getByTestId('setting-measure').fill('84');
      await first.page.getByTestId('setting-font-size').fill('21');
      await expect(first.page.locator('html')).toHaveAttribute('data-theme', 'dark');
    } finally {
      await first.app.close();
    }

    const stored = JSON.parse(await readFile(path.join(first.userData, 'settings.json'), 'utf8'));
    expect(stored).toMatchObject({ theme: 'dark', measureCh: 84, fontSize: 21 });

    const second = await launch('persist', first.userData);
    try {
      await expect(second.page.locator('html')).toHaveAttribute('data-theme', 'dark');
      await expect.poll(() => measureOf(second.page)).toBe('84ch');
    } finally {
      await second.app.close();
    }
  });

  test('refuses a setting the app does not define', async () => {
    const { app, page } = await launch('reject');
    try {
      const outcome = await page.evaluate(async () => {
        const result = await (window as unknown as {
          notoSettings: { write(request: unknown): Promise<{ ok: boolean }> };
        }).notoSettings.write({ version: 1, requestId: 'e2e-bad', patch: { nonsense: true } });
        return result.ok;
      });
      expect(outcome).toBe(false);
    } finally {
      await app.close();
    }
  });
});
