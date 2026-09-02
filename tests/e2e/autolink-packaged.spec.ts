import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { packagedExecutable, placeCaret } from './packaged-app';

const resultRoot = path.join(process.cwd(), 'test-results', 'autolink');

const NOTE = [
  '# Links',
  '',
  '- https://example.com/one',
  '- [the docs](https://example.com/two)',
  '',
  'Trailing paragraph.',
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

test.describe('a URL written on its own', () => {
  test('shows no delimiters it does not have, and keeps its form when edited', async () => {
    const { app, page, file } = await launch('bare');
    try {
      const bare = page.locator('.ProseMirror a').first();
      await expect(bare).toHaveText('https://example.com/one');

      // The caret in that item: a written link reveals its brackets, a bare
      // URL has none to reveal.
      await placeCaret(page, bare);
      await expect(page.locator('.noto-syntax')).toHaveCount(0);

      const written = page.locator('.ProseMirror a').nth(1);
      await placeCaret(page, written);
      await expect(page.locator('.noto-syntax')).toHaveCount(2);

      // Editing the block leaves the bare URL bare.
      await placeCaret(page, page.locator('.ProseMirror > p').last());
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowRight' : 'End');
      await page.keyboard.type(' edited');
      await placeCaret(page, bare);
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowRight' : 'End');
      await page.keyboard.type('x');
      await page.getByTestId('save-button').click();
      await expect.poll(async () => readFile(file, 'utf8')).toContain('- https://example.com/onex');
      expect(await readFile(file, 'utf8')).not.toContain('<https://');
    } finally {
      await app.close();
    }
  });
});
