import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { packagedExecutable, placeCaret } from './packaged-app';

const resultRoot = path.join(process.cwd(), 'test-results', 'broken-lines');

/**
 * A paragraph the author wrapped by hand, the way most of the vault is
 * written. The breaks are content, not formatting, and typing into the
 * paragraph must not join the lines.
 */
const NOTE = [
  '# Wrapped',
  '',
  'The first line of a paragraph the author broke.',
  'The second line, which belongs to the same paragraph.',
  'The third line, ending the paragraph.',
  '',
  'A separate paragraph that must not move.',
  '',
].join('\n');

async function launch(name: string, body = NOTE): Promise<{ app: ElectronApplication; page: Page; file: string }> {
  const workspace = path.join(resultRoot, name);
  await rm(workspace, { recursive: true, force: true });
  await mkdir(path.join(workspace, 'user-data'), { recursive: true });
  const file = path.join(workspace, 'note.md');
  await writeFile(file, body, 'utf8');
  const app = await electron.launch({
    executablePath: packagedExecutable(),
    args: [`--user-data-dir=${path.join(workspace, 'user-data')}`, `--open=${file}`],
  });
  const page = await app.firstWindow();
  await page.waitForSelector('[data-testid="noto-editor"]', { state: 'visible', timeout: 30_000 });
  await page.setViewportSize({ width: 1100, height: 700 });
  return { app, page, file };
}

test.describe('a paragraph the author broke across lines', () => {
  test('keeps its breaks when a letter is typed into it', async () => {
    const { app, page, file } = await launch('typing');
    try {
      await placeCaret(page, page.locator('.ProseMirror > p').first());
      await page.keyboard.type('X');
      await page.getByTestId('save-button').click();

      await expect.poll(async () => readFile(file, 'utf8')).toContain('X');
      const saved = await readFile(file, 'utf8');
      // Three lines still, and the file is the original with one letter in it.
      expect(saved.split('\n').slice(2, 5)).toHaveLength(3);
      expect(saved.replace('X', '')).toBe(NOTE);
    } finally {
      await app.close();
    }
  });

  test('keeps them in a file written with carriage returns', async () => {
    const crlf = NOTE.replaceAll('\n', '\r\n');
    const { app, page, file } = await launch('crlf', crlf);
    try {
      await placeCaret(page, page.locator('.ProseMirror > p').first());
      await page.keyboard.type('X');
      await page.getByTestId('save-button').click();

      await expect.poll(async () => readFile(file, 'utf8')).toContain('X');
      const saved = await readFile(file, 'utf8');
      expect(saved.replace('X', '')).toBe(crlf);
    } finally {
      await app.close();
    }
  });
});
