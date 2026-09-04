import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { packagedExecutable, placeCaret } from './packaged-app';

const resultRoot = path.join(process.cwd(), 'test-results', 'task-status');

const NOTE = '# Tasks\n\n- [ ] first\n- [x] second\n- third\n';

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
    const found = menu ? find(menu.items) : null;
    if (!found) throw new Error(`No menu item with id ${itemId}`);
    found.click();
  }, id);
}

const checked = (page: Page) => page.locator('.ProseMirror li.noto-task-item')
  .evaluateAll((items) => items.map((item) => item.getAttribute('data-checked')));

test.describe('ticking a task', () => {
  test('presses the box, which was not reachable at all before', async () => {
    const { app, page, file } = await launch('click');
    try {
      expect(await checked(page)).toEqual(['false', 'true']);

      // The box is a pseudo-element, so a press on it is reported against the
      // item. Anything left of the item's own content is the box.
      const first = page.locator('.ProseMirror li.noto-task-item').first();
      const box = await first.boundingBox();
      if (!box) throw new Error('no task item on screen');
      await page.mouse.click(box.x + 1, box.y + box.height / 2);
      await expect.poll(() => checked(page)).toEqual(['true', 'true']);

      await page.getByTestId('save-button').click();
      await expect.poll(() => readFile(file, 'utf8'), { timeout: 15_000 })
        .toBe('# Tasks\n\n- [x] first\n- [x] second\n- third\n');
    } finally {
      await app.close();
    }
  });

  test('leaves the caret alone when the press is on the words', async () => {
    const { app, page } = await launch('words');
    try {
      const first = page.locator('.ProseMirror li.noto-task-item').first();
      await first.click();
      expect(await checked(page)).toEqual(['false', 'true']);
    } finally {
      await app.close();
    }
  });

  test('toggles from the keyboard, and sets the state outright from the menu', async () => {
    const { app, page, file } = await launch('keyboard');
    try {
      await placeCaret(page, page.locator('.ProseMirror li.noto-task-item').nth(1));
      await run(app, 'task-toggle');
      await expect.poll(() => checked(page)).toEqual(['false', 'false']);

      await run(app, 'task-complete');
      await expect.poll(() => checked(page)).toEqual(['false', 'true']);
      // Setting it to what it already is does nothing rather than flipping it.
      await run(app, 'task-complete');
      await expect.poll(() => checked(page)).toEqual(['false', 'true']);

      await run(app, 'task-incomplete');
      await expect.poll(() => checked(page)).toEqual(['false', 'false']);

      await page.getByTestId('save-button').click();
      await expect.poll(() => readFile(file, 'utf8'), { timeout: 15_000 })
        .toBe('# Tasks\n\n- [ ] first\n- [ ] second\n- third\n');
    } finally {
      await app.close();
    }
  });

  test('does nothing on a bullet that is not a task', async () => {
    const { app, page } = await launch('plain');
    try {
      // The third item is an ordinary bullet: there is no state to flip, and
      // the command must not invent one.
      await placeCaret(page, page.locator('.ProseMirror li').nth(2));
      await run(app, 'task-toggle');
      await expect(page.locator('.ProseMirror li.noto-task-item')).toHaveCount(2);
    } finally {
      await app.close();
    }
  });
});
