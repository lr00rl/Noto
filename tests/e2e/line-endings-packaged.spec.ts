import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { packagedExecutable, placeCaret } from './packaged-app';

const resultRoot = path.join(process.cwd(), 'test-results', 'line-endings-menu');

const LF = '# Title\n\nFirst paragraph.\n\nLast.\n';

async function launch(name: string, contents = LF): Promise<{
  app: ElectronApplication; page: Page; file: string;
}> {
  const workspace = path.join(resultRoot, name);
  await rm(workspace, { recursive: true, force: true });
  await mkdir(path.join(workspace, 'user-data'), { recursive: true });
  const file = path.join(workspace, 'note.md');
  await writeFile(file, contents, 'utf8');
  const app = await electron.launch({
    executablePath: packagedExecutable(),
    args: [`--user-data-dir=${path.join(workspace, 'user-data')}`, `--open=${file}`],
  });
  const page = await app.firstWindow();
  await page.waitForSelector('[data-testid="noto-editor"]', { state: 'visible', timeout: 30_000 });
  await page.setViewportSize({ width: 1100, height: 700 });
  return { app, page, file };
}

async function run(app: ElectronApplication, id: string): Promise<void> {
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

/** What the menu currently shows as ticked, read from the real menu. */
async function ticks(app: ElectronApplication): Promise<Record<string, boolean>> {
  return app.evaluate(({ Menu }) => {
    const out: Record<string, boolean> = {};
    const walk = (items: Electron.MenuItem[]) => {
      for (const item of items) {
        if (item.id) out[item.id] = item.checked;
        if (item.submenu) walk(item.submenu.items);
      }
    };
    const menu = Menu.getApplicationMenu();
    if (menu) walk(menu.items);
    return out;
  });
}

test.describe('line endings', () => {
  test('converts the whole file on the next save, not before it', async () => {
    const { app, page, file } = await launch('to-crlf');
    try {
      await run(app, 'line-endings-crlf');
      // Nothing has been written yet. The choice is a pending change to the
      // file, which the ordinary save carries.
      expect(await readFile(file, 'utf8')).toBe(LF);
      await expect(page.getByTestId('save-button')).toBeEnabled();

      await page.getByTestId('save-button').click();
      await expect.poll(() => readFile(file, 'utf8'), { timeout: 15_000 })
        .toBe(LF.replaceAll('\n', '\r\n'));
    } finally {
      await app.close();
    }
  });

  test('converts back, leaving the words exactly as they were', async () => {
    const { app, page, file } = await launch('to-lf', LF.replaceAll('\n', '\r\n'));
    try {
      await run(app, 'line-endings-lf');
      await page.getByTestId('save-button').click();
      await expect.poll(() => readFile(file, 'utf8'), { timeout: 15_000 }).toBe(LF);
    } finally {
      await app.close();
    }
  });

  test('ticks what the file is, and follows the choice', async () => {
    const { app } = await launch('ticks');
    try {
      const before = await ticks(app);
      expect(before['line-endings-lf']).toBe(true);
      expect(before['line-endings-crlf']).toBe(false);

      await run(app, 'line-endings-crlf');
      await expect.poll(async () => (await ticks(app))['line-endings-crlf']).toBe(true);
      expect((await ticks(app))['line-endings-lf']).toBe(false);
    } finally {
      await app.close();
    }
  });

  test('carries an edit and the conversion in the same save', async () => {
    const { app, page, file } = await launch('with-edit');
    try {
      await placeCaret(page, page.locator('.ProseMirror > p').first());
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowRight' : 'End');
      await page.keyboard.type(' Edited.');
      await run(app, 'line-endings-crlf');
      await page.getByTestId('save-button').click();
      await expect.poll(() => readFile(file, 'utf8'), { timeout: 15_000 })
        .toBe('# Title\r\n\r\nFirst paragraph. Edited.\r\n\r\nLast.\r\n');
    } finally {
      await app.close();
    }
  });
});

test.describe('the final newline', () => {
  test('takes it away, and puts it back', async () => {
    const { app, page, file } = await launch('final-newline');
    try {
      await run(app, 'toggle-final-newline');
      await page.getByTestId('save-button').click();
      await expect.poll(() => readFile(file, 'utf8'), { timeout: 15_000 })
        .toBe('# Title\n\nFirst paragraph.\n\nLast.');

      await run(app, 'toggle-final-newline');
      await page.getByTestId('save-button').click();
      await expect.poll(() => readFile(file, 'utf8'), { timeout: 15_000 }).toBe(LF);
    } finally {
      await app.close();
    }
  });

  test('adds one to a file that never had one', async () => {
    const { app, page, file } = await launch('add-newline', '# Title\n\nNo newline here.');
    try {
      const before = await ticks(app);
      expect(before['toggle-final-newline']).toBe(false);
      await run(app, 'toggle-final-newline');
      await page.getByTestId('save-button').click();
      await expect.poll(() => readFile(file, 'utf8'), { timeout: 15_000 })
        .toBe('# Title\n\nNo newline here.\n');
    } finally {
      await app.close();
    }
  });
});

test.describe('import', () => {
  test('says Pandoc is needed rather than failing silently', async () => {
    const { app } = await launch('import');
    try {
      // Pandoc is not installed on this machine, which is the first thing that
      // happens to anybody who has not installed it either.
      const item = await app.evaluate(({ Menu }) => {
        const find = (items: Electron.MenuItem[]): Electron.MenuItem | null => {
          for (const candidate of items) {
            if (candidate.id === 'import-document') return candidate;
            const nested = candidate.submenu ? find(candidate.submenu.items) : null;
            if (nested) return nested;
          }
          return null;
        };
        const menu = Menu.getApplicationMenu();
        const found = menu ? find(menu.items) : null;
        return found ? { label: found.label, enabled: found.enabled } : null;
      });
      expect(item).toEqual({ label: 'Import…', enabled: true });
    } finally {
      await app.close();
    }
  });
});
