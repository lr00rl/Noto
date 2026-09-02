import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { packagedExecutable, placeCaret } from './packaged-app';

const resultRoot = path.join(process.cwd(), 'test-results', 'links');

const NOTE = [
  '# Links',
  '',
  'Read the paper today.',
  '',
  'Or read [the other one](https://example.com/old) instead.',
  '',
].join('\n');

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

/** Select a whole paragraph, the way three clicks do. */
async function selectParagraph(page: Page, text: string): Promise<void> {
  await page.getByText(text, { exact: false }).first().click({ clickCount: 3 });
}

test.describe('making and changing a link', () => {
  test('wraps the selected words and writes the address to the file', async () => {
    const { app, page, file } = await launch('create');
    try {
      await selectParagraph(page, 'Read the paper today.');
      await invokeMenu(app, 'insert-link');
      await expect(page.getByTestId('link-input')).toBeVisible();

      await page.getByTestId('link-input').fill('https://example.com/new');
      await page.keyboard.press('Enter');
      await expect(page.getByTestId('link-input')).toBeHidden();

      await page.getByTestId('save-button').click();
      await expect.poll(async () => readFile(file, 'utf8')).toContain('](https://example.com/new)');
    } finally {
      await app.close();
    }
  });

  test('opens on a link the caret is already in, showing its address', async () => {
    const { app, page, file } = await launch('change');
    try {
      await placeCaret(page, page.getByText('the other one'));
      await invokeMenu(app, 'insert-link');
      await expect(page.getByTestId('link-input')).toHaveValue('https://example.com/old');

      await page.getByTestId('link-input').fill('https://example.com/changed');
      await page.keyboard.press('Enter');

      await page.getByTestId('save-button').click();
      await expect.poll(async () => readFile(file, 'utf8')).toContain('](https://example.com/changed)');
    } finally {
      await app.close();
    }
  });

  test('leaves the address alone when the panel is dismissed', async () => {
    const { app, page, file } = await launch('escape');
    try {
      await placeCaret(page, page.getByText('the other one'));
      await invokeMenu(app, 'insert-link');
      await page.getByTestId('link-input').fill('https://example.com/never');
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('link-input')).toBeHidden();

      // Nothing was written, so there is nothing to save and no save button.
      await expect(page.getByTestId('save-button')).toBeHidden();
      expect(await readFile(file, 'utf8')).toContain('](https://example.com/old)');
    } finally {
      await app.close();
    }
  });

  test('takes the link off but keeps the words', async () => {
    const { app, page, file } = await launch('remove');
    try {
      await placeCaret(page, page.getByText('the other one'));
      await invokeMenu(app, 'insert-link');
      await page.getByTestId('link-remove').click();

      await page.getByTestId('save-button').click();
      await expect.poll(async () => readFile(file, 'utf8')).toContain('Or read the other one instead.');
    } finally {
      await app.close();
    }
  });
});
