import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { packagedExecutable, placeCaret } from './packaged-app';

const resultRoot = path.join(process.cwd(), 'test-results', 'line-endings');

/** A file written the way sixteen percent of the author's vault is written. */
const CRLF_NOTE = ['# Endings', '', 'First paragraph.', '', '- one', '- two', '', 'Last paragraph.', ''].join('\r\n');

async function launch(): Promise<{ app: ElectronApplication; page: Page; file: string }> {
  const workspace = path.join(resultRoot, 'crlf');
  await rm(workspace, { recursive: true, force: true });
  await mkdir(path.join(workspace, 'user-data'), { recursive: true });
  const file = path.join(workspace, 'note.md');
  await writeFile(file, CRLF_NOTE, 'utf8');
  const app = await electron.launch({
    executablePath: packagedExecutable(),
    args: [`--user-data-dir=${path.join(workspace, 'user-data')}`, `--open=${file}`],
  });
  const page = await app.firstWindow();
  await page.waitForSelector('[data-testid="noto-editor"]', { state: 'visible', timeout: 30_000 });
  await page.setViewportSize({ width: 1100, height: 700 });
  return { app, page, file };
}

test.describe('a file written with carriage returns', () => {
  test('keeps them, in the block that was edited as well as the rest', async () => {
    const { app, page, file } = await launch();
    try {
      await placeCaret(page, page.locator('.ProseMirror > p').first());
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowRight' : 'End');
      await page.keyboard.type(' edited');
      await page.getByTestId('save-button').click();

      await expect.poll(async () => readFile(file, 'utf8')).toContain('First paragraph. edited');
      const saved = await readFile(file, 'utf8');
      // Every newline still has its carriage return, including the edited
      // block's, so the file has not become a mixture of the two.
      expect(saved.match(/\n/g)?.length).toBe(saved.match(/\r\n/g)?.length);
      expect(saved).toContain('- one\r\n- two');
    } finally {
      await app.close();
    }
  });
});
