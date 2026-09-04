import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { packagedExecutable, placeCaret } from './packaged-app';

const resultRoot = path.join(process.cwd(), 'test-results', 'list-enter');

async function launch(name: string, contents: string): Promise<{
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

const atEnd = async (page: Page, item: ReturnType<Page['locator']>) => {
  await placeCaret(page, item);
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowRight' : 'End');
};

test.describe('Enter on an empty list item', () => {
  test('climbs out one level rather than dropping the bullet', async () => {
    const { app, page, file } = await launch('nested', '# List\n\n- one\n  - deep\n');
    try {
      await atEnd(page, page.locator('.ProseMirror li li').first());
      // Empty the nested item, then press Enter at the end of it.
      await page.keyboard.press('Enter');
      await expect(page.locator('.ProseMirror li li')).toHaveCount(2);
      await page.keyboard.press('Enter');

      // It became a sibling of `one` rather than a line with no bullet at all.
      await expect(page.locator('.ProseMirror li li')).toHaveCount(1);
      await expect(page.locator('.ProseMirror > ul > li')).toHaveCount(2);

      await page.keyboard.type('two');
      await page.getByTestId('save-button').click();
      await expect.poll(() => readFile(file, 'utf8'), { timeout: 15_000 })
        .toBe('# List\n\n- one\n  - deep\n- two\n');
    } finally {
      await app.close();
    }
  });

  test('leaves the list entirely from an empty item at the top level', async () => {
    const { app, page, file } = await launch('top', '# List\n\n- one\n');
    try {
      await atEnd(page, page.locator('.ProseMirror li').first());
      await page.keyboard.press('Enter');
      await page.keyboard.press('Enter');
      await expect(page.locator('.ProseMirror > ul > li')).toHaveCount(1);

      await page.keyboard.type('After the list.');
      await page.getByTestId('save-button').click();
      await expect.poll(() => readFile(file, 'utf8'), { timeout: 15_000 })
        .toBe('# List\n\n- one\n\nAfter the list.\n');
    } finally {
      await app.close();
    }
  });

  test('still splits an item that has words in it', async () => {
    // The guard that keeps this from outdenting every Enter inside a list.
    const { app, page, file } = await launch('split', '# List\n\n- one\n');
    try {
      await atEnd(page, page.locator('.ProseMirror li').first());
      await page.keyboard.press('Enter');
      await page.keyboard.type('two');
      await expect(page.locator('.ProseMirror > ul > li')).toHaveCount(2);
      await page.getByTestId('save-button').click();
      await expect.poll(() => readFile(file, 'utf8'), { timeout: 15_000 })
        .toBe('# List\n\n- one\n- two\n');
    } finally {
      await app.close();
    }
  });
});
