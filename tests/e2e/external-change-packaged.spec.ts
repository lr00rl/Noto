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

test.describe('following the file when it changes underneath', () => {
  test('takes another program\'s edit into a note with nothing unsaved', async () => {
    const { app, page, file } = await launch('follow-clean');
    try {
      await expect(page.locator('.ProseMirror')).toContainText('The body as it was.');

      // A pull, a sync client, another editor. Nothing here is unsaved, so
      // there is nothing to lose and no reason to ask.
      await writeFile(file, '# Shared\n\nRewritten by something else.\n', 'utf8');

      await expect(page.locator('.ProseMirror')).toContainText('Rewritten by something else.', { timeout: 20_000 });
      await expect(page.locator('.ProseMirror')).not.toContainText('The body as it was.');

      // Taken as one undoable step, so it can be walked back like any change.
      await placeCaret(page, page.locator('.ProseMirror > p').first());
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
      await expect(page.locator('.ProseMirror')).toContainText('The body as it was.');
    } finally {
      await app.close();
    }
  });

  test('never replaces unsaved work, and offers the reload instead', async () => {
    const { app, page, file } = await launch('follow-dirty');
    try {
      await placeCaret(page, page.locator('.ProseMirror > p').first());
      await page.keyboard.type(' Mine, not saved.');

      await writeFile(file, '# Shared\n\nTheirs, on disk.\n', 'utf8');

      await expect(page.getByTestId('file-truth-alert')).toContainText('Changed on disk', { timeout: 20_000 });
      // The unsaved sentence is still there. That is the whole point.
      await expect(page.locator('.ProseMirror')).toContainText('Mine, not saved.');

      await page.getByTestId('reload-from-disk').click();
      await expect(page.locator('.ProseMirror')).toContainText('Theirs, on disk.', { timeout: 20_000 });
    } finally {
      await app.close();
    }
  });

  test('saves cleanly after taking the other version, which the conflict used to block', async () => {
    const { app, page, file } = await launch('reload-then-save');
    try {
      await writeFile(file, '# Shared\n\nTheirs, on disk.\n', 'utf8');
      await expect(page.locator('.ProseMirror')).toContainText('Theirs, on disk.', { timeout: 20_000 });

      // The reload moved the identity a save checks against, so writing now
      // succeeds instead of being refused against a file that no longer exists.
      await placeCaret(page, page.locator('.ProseMirror > p').first());
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowRight' : 'End');
      await page.keyboard.type(' And mine after it.');
      await page.getByTestId('save-button').click();
      await expect.poll(() => readFile(file, 'utf8'), { timeout: 20_000 })
        .toContain('Theirs, on disk. And mine after it.');
    } finally {
      await app.close();
    }
  });

  test('says the file is gone without throwing away the only copy left', async () => {
    const { app, page, file } = await launch('removed');
    try {
      await expect(page.locator('.ProseMirror')).toContainText('The body as it was.');
      await rm(file);
      await expect(page.getByTestId('file-truth-alert')).toContainText('File removed', { timeout: 20_000 });
      // What is on screen is now the only copy of this note anywhere.
      await expect(page.locator('.ProseMirror')).toContainText('The body as it was.');
    } finally {
      await app.close();
    }
  });
});
