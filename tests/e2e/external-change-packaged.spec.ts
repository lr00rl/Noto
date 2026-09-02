import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { packagedExecutable, placeCaret } from './packaged-app';

const resultRoot = path.join(process.cwd(), 'test-results', 'external-change');

const NOTE = '# Shared\n\nThe body as it was.\n';

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

test.describe('a note that changed on disk while it was open', () => {
  test('refuses the save rather than writing over the other change', async () => {
    const { app, page, file } = await launch('conflict');
    try {
      await placeCaret(page, page.locator('.ProseMirror > p').first());
      await page.keyboard.type(' Edited here.');

      // Somebody else writes the file: a pull, another editor, a script.
      const theirs = '# Shared\n\nThe body as somebody else wrote it.\n';
      await writeFile(file, theirs, 'utf8');

      await page.getByTestId('save-button').click();

      // Their work is still on disk, untouched.
      await expect.poll(async () => readFile(file, 'utf8')).toBe(theirs);
      // And ours is still in the window, not thrown away.
      await expect(page.locator('.ProseMirror')).toContainText('Edited here.');
    } finally {
      await app.close();
    }
  });

  test('says so, rather than failing quietly', async () => {
    const { app, page, file } = await launch('reported');
    try {
      await placeCaret(page, page.locator('.ProseMirror > p').first());
      await page.keyboard.type('X');
      await writeFile(file, '# Shared\n\nSomething else entirely.\n', 'utf8');
      await page.getByTestId('save-button').click();

      // The window says what happened, and offers the one action it has.
      await expect(page.locator('body')).toContainText(/conflict/i);
      await expect(page.locator('body')).toContainText('Your work is still here');
      await expect(page.getByRole('button', { name: /save a copy/i })).toBeVisible();
    } finally {
      await app.close();
    }
  });
});
