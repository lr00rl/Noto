import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { packagedExecutable, placeCaret } from './packaged-app';

const resultRoot = path.join(process.cwd(), 'test-results', 'read-only');

const NOTE = '# Note\n\nThe body as it was.\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n';

async function launch(name: string): Promise<{ app: ElectronApplication; page: Page; file: string }> {
  const workspace = path.join(resultRoot, name);
  await rm(workspace, { recursive: true, force: true });
  await mkdir(path.join(workspace, 'user-data'), { recursive: true });
  const file = path.join(workspace, 'note.md');
  await writeFile(file, NOTE, 'utf8');
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

test.describe('read-only mode', () => {
  test('refuses typing, says so, and lets go again', async () => {
    const { app, page, file } = await launch('typing');
    try {
      await run(app, 'toggle-read-only');
      await expect(page.getByTestId('read-only-flag')).toBeVisible();

      await placeCaret(page, page.locator('.ProseMirror > p').first());
      await page.keyboard.type('This should not appear.');
      await expect(page.locator('.ProseMirror')).not.toContainText('This should not appear.');

      // A block command is refused too, not only the keyboard.
      await run(app, 'block-heading-2');
      await expect(page.locator('.ProseMirror h2')).toHaveCount(0);

      // Nothing about the file changed, and nothing was marked unsaved.
      expect(await readFile(file, 'utf8')).toBe(NOTE);

      await run(app, 'toggle-read-only');
      await expect(page.getByTestId('read-only-flag')).toHaveCount(0);
      await placeCaret(page, page.locator('.ProseMirror > p').first());
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowRight' : 'End');
      await page.keyboard.type(' And now it does.');
      await expect(page.locator('.ProseMirror')).toContainText('And now it does.');
    } finally {
      await app.close();
    }
  });

  test('refuses a table drag, which a node view could otherwise still take', async () => {
    const { app, page, file } = await launch('table-drag');
    try {
      await run(app, 'toggle-read-only');
      const cell = page.locator('.ProseMirror td').first();
      await cell.hover();
      const handle = page.locator('.noto-table-handle').first();
      if (await handle.count() > 0) {
        const box = await handle.boundingBox();
        if (box) {
          await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
          await page.mouse.down();
          await page.mouse.move(box.x + 200, box.y, { steps: 8 });
          await page.mouse.up();
        }
      }
      expect(await readFile(file, 'utf8')).toBe(NOTE);
    } finally {
      await app.close();
    }
  });
});

test.describe('copying a selection as something else', () => {
  test('gives markdown, HTML and the words alone from the same selection', async () => {
    const { app, page } = await launch('copy-as');
    try {
      await placeCaret(page, page.locator('.ProseMirror h1').first());
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a');

      // Read from main. The renderer denies every permission request by
      // design, so it cannot read its own clipboard back.
      const read = async () => app.evaluate(({ clipboard }) => clipboard.readText());

      await run(app, 'copy-as-markdown');
      await expect.poll(read).toContain('# Note');

      await run(app, 'copy-as-html');
      await expect.poll(read).toContain('<h1>Note</h1>');
      expect(await read()).toContain('<table');

      await run(app, 'copy-as-plain');
      const plain = await read();
      expect(plain).toContain('Note');
      // The point of it: none of the punctuation that carries the structure.
      expect(plain).not.toContain('#');
      expect(plain).not.toContain('|');
    } finally {
      await app.close();
    }
  });
});
