import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { packagedExecutable, placeCaret } from './packaged-app';

const resultRoot = path.join(process.cwd(), 'test-results', 'move');

const NOTE = [
  '# Moving things',
  '',
  'First para.',
  '',
  'Second para.',
  '',
  'Third para.',
  '',
  '| head a | head b |',
  '| --- | --- |',
  '| one | two |',
  '| three | four |',
  '',
  '```js',
  'const a = 1;',
  'const b = 2;',
  '```',
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
  await page.setViewportSize({ width: 1100, height: 800 });
  return { app, page, file };
}

/** The document's paragraphs, in the order they are drawn. */
const paragraphs = (page: Page) => page.locator('.ProseMirror > p').allInnerTexts();

test.describe('moving what the caret is in', () => {
  test('takes a paragraph past its neighbour and back', async () => {
    const { app, page } = await launch('paragraph');
    try {
      await placeCaret(page, page.locator('.ProseMirror > p', { hasText: 'Second para.' }));
      await page.keyboard.press('Alt+ArrowUp');
      expect(await paragraphs(page)).toEqual(['Second para.', 'First para.', 'Third para.']);

      // The caret went with it, so the same key moves the same paragraph again.
      await page.keyboard.press('Alt+ArrowDown');
      expect(await paragraphs(page)).toEqual(['First para.', 'Second para.', 'Third para.']);
    } finally {
      await app.close();
    }
  });

  test('takes a table row with it, and writes the file back that way', async () => {
    const { app, page, file } = await launch('row');
    try {
      await placeCaret(page, page.locator('.ProseMirror td', { hasText: 'three' }));
      await page.keyboard.press('Alt+ArrowUp');
      // Row 0 is the header, which never moves, so the first body row is row 1.
      await expect(page.locator('.ProseMirror tr').nth(1)).toContainText('three');

      await page.getByTestId('save-button').click();
      await expect.poll(async () => readFile(file, 'utf8')).toContain('| three | four |\n| one | two |');
    } finally {
      await app.close();
    }
  });

  test('moves a line inside a fence rather than the fence', async () => {
    const { app, page } = await launch('fence');
    try {
      // The last token in the fence is on its second line.
      await placeCaret(page, page.locator('.noto-fence-code .token').last());
      await page.keyboard.press('Alt+ArrowUp');
      await expect(page.locator('.noto-fence-code')).toContainText('const b = 2;\nconst a = 1;');
    } finally {
      await app.close();
    }
  });

  test('moves a table column, header and body together', async () => {
    const { app, page } = await launch('column');
    try {
      await placeCaret(page, page.locator('.ProseMirror th', { hasText: 'head b' }));
      // The same key everywhere: the old chord was Command with Control,
      // which off macOS is Control with Control and cannot be pressed.
      await page.keyboard.press('Alt+Shift+ArrowLeft');
      await expect(page.locator('.ProseMirror th').first()).toHaveText('head b');
      await expect(page.locator('.ProseMirror tr').nth(1).locator('td').first()).toHaveText('two');
    } finally {
      await app.close();
    }
  });
});
