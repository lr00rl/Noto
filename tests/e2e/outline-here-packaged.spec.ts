import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { packagedExecutable, placeCaret } from './packaged-app';

const resultRoot = path.join(process.cwd(), 'test-results', 'outline-here');

const NOTE = [
  '# Title', '', 'Under the title.', '',
  '## First section', '', 'Under the first.', '',
  '## Second section', '', 'Under the second.', '',
].join('\n');

async function launch(): Promise<{ app: ElectronApplication; page: Page }> {
  const workspace = path.join(resultRoot, 'here');
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
  // Through the menu: the rail starts closed, so its tabs do not exist yet.
  await app.evaluate(({ Menu }) => {
    const find = (items: Electron.MenuItem[]): Electron.MenuItem | null => {
      for (const item of items) {
        if (item.id === 'toggle-outline') return item;
        const nested = item.submenu ? find(item.submenu.items) : null;
        if (nested) return nested;
      }
      return null;
    };
    Menu.getApplicationMenu()!.items.flatMap((item) => (item.submenu ? item.submenu.items : [item]));
    const target = find(Menu.getApplicationMenu()!.items);
    if (!target) throw new Error('no toggle-outline');
    target.click();
  });
  await page.waitForSelector('[data-testid="outline-panel"]', { state: 'visible', timeout: 10_000 });
  return { app, page };
}

test.describe('the outline says where you are', () => {
  test('marks the heading the caret is under, and follows it', async () => {
    const { app, page } = await launch();
    try {
      const current = page.locator('.outline-entry.is-current');

      // In a paragraph under the first section.
      await placeCaret(page, page.locator('.ProseMirror > p').nth(1));
      await expect(current).toHaveCount(1);
      await expect(current).toHaveText('First section');

      // Move down to the second, and the mark follows.
      await placeCaret(page, page.locator('.ProseMirror > p').nth(2));
      await expect(current).toHaveText('Second section');

      // In the heading itself, that heading is the one marked.
      await placeCaret(page, page.locator('.ProseMirror h1'));
      await expect(current).toHaveText('Title');
    } finally {
      await app.close();
    }
  });
});
