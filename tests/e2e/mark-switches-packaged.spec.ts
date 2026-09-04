import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, _electron as electron } from '@playwright/test';
import { packagedExecutable } from './packaged-app';

test('the marks Typora adds can each be turned off, and the caret comes back', async () => {
  const workspace = path.join(process.cwd(), 'test-results', 'mark-switches');
  await rm(workspace, { recursive: true, force: true });
  await mkdir(path.join(workspace, 'user-data'), { recursive: true });
  const vault = path.join(workspace, 'vault');
  await mkdir(vault, { recursive: true });
  await writeFile(path.join(vault, 'note.md'), '# Marks\n\nA ==hit==, x^2^ and H~2~O.\n', 'utf8');
  const app = await electron.launch({
    executablePath: packagedExecutable(),
    args: [`--user-data-dir=${path.join(workspace, 'user-data')}`, vault],
  });
  try {
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.waitForSelector('[data-testid="file-tree"]', { state: 'visible', timeout: 30_000 });
    await page.getByTestId('tree-file').first().click();
    const editor = page.locator('.canvas-slot:not([hidden]) .ProseMirror');
    await editor.waitFor({ state: 'visible' });

    // All three are drawn to start with.
    await expect(editor.locator('.noto-mark-highlight')).toHaveCount(1);
    await expect(editor.locator('.noto-mark-sup')).toHaveCount(1);
    await expect(editor.locator('.noto-mark-sub')).toHaveCount(1);

    // The superscript off: the carets are characters again and the rest stays.
    await page.getByTestId('settings-toggle').click();
    await page.waitForSelector('[data-testid="settings-panel"]', { state: 'visible' });
    await page.locator('.pref-dialog nav button').filter({ hasText: /markdown/i }).first().click();
    await page.getByTestId('setting-mark-superscript').click();
    await expect.poll(() => editor.locator('.noto-mark-sup').count()).toBe(0);
    await expect(editor.locator('.noto-mark-highlight')).toHaveCount(1);
    await expect(editor.locator('.noto-mark-sub')).toHaveCount(1);

    // And back on again.
    await page.getByTestId('setting-mark-superscript').click();
    await expect.poll(() => editor.locator('.noto-mark-sup').count()).toBe(1);

    // The other two, together.
    await page.getByTestId('setting-mark-highlight').click();
    await page.getByTestId('setting-mark-subscript').click();
    await expect.poll(() => editor.locator('.noto-mark-highlight').count()).toBe(0);
    await expect.poll(() => editor.locator('.noto-mark-sub').count()).toBe(0);
    await page.getByTestId('settings-close').click();
    // The text is untouched throughout: only the drawing changed.
    await expect(editor.locator('p').first()).toHaveText('A ==hit==, x^2^ and H~2~O.');
  } finally {
    await app.close();
  }
});
