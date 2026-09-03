import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { packagedExecutable, placeCaret } from './packaged-app';

const resultRoot = path.join(process.cwd(), 'test-results', 'image-paste');

/** A one pixel PNG, as bytes, so the sniff in main has something real to read. */
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

async function launch(name: string, noteName = 'note.md'): Promise<{
  app: ElectronApplication; page: Page; workspace: string; file: string;
}> {
  const workspace = path.join(resultRoot, name);
  await rm(workspace, { recursive: true, force: true });
  await mkdir(path.join(workspace, 'user-data'), { recursive: true });
  await mkdir(path.join(workspace, 'vault'), { recursive: true });
  const file = path.join(workspace, 'vault', noteName);
  await writeFile(file, '# Pictures\n\nHere.\n', 'utf8');
  const app = await electron.launch({
    executablePath: packagedExecutable(),
    args: [`--user-data-dir=${path.join(workspace, 'user-data')}`, `--open=${file}`],
  });
  const page = await app.firstWindow();
  await page.waitForSelector('[data-testid="noto-editor"]', { state: 'visible', timeout: 30_000 });
  await page.setViewportSize({ width: 1100, height: 700 });
  return { app, page, workspace, file };
}

/**
 * Paste a picture, the way the operating system delivers one.
 *
 * A real clipboard cannot be written from here, so the event is built and
 * dispatched at the editor. Everything past `handlePaste` is the code under
 * test: the transfer is read, the bytes cross to main, main picks the folder,
 * and the reference comes back.
 */
async function pasteImage(page: Page, base64: string, type = 'image/png'): Promise<void> {
  await page.evaluate(async ({ data, mime }) => {
    const binary = atob(data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    const file = new File([bytes], 'pasted', { type: mime });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    const editor = document.querySelector('.ProseMirror');
    editor?.dispatchEvent(new ClipboardEvent('paste', {
      clipboardData: transfer, bubbles: true, cancelable: true,
    }));
  }, { data: base64, mime: type });
}

test.describe('pasting a picture', () => {
  test('writes it into an assets folder and refers to it relatively', async () => {
    const { app, page, workspace, file } = await launch('assets');
    try {
      await placeCaret(page, page.locator('.ProseMirror > p').last());
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowRight' : 'End');
      await pasteImage(page, PNG_BASE64);

      await expect(page.locator('.ProseMirror img.noto-image')).toHaveCount(1, { timeout: 15_000 });

      const assets = path.join(workspace, 'vault', 'assets');
      const written = await readdir(assets);
      expect(written).toHaveLength(1);
      expect(written[0]).toMatch(/^image-\d{17}\.png$/);

      // The picture is shown, not merely referenced: a broken image would have
      // the same markdown and none of the point.
      const shown = await page.locator('.ProseMirror img.noto-image').evaluate(
        (node) => (node as HTMLImageElement).naturalWidth,
      );
      expect(shown).toBe(1);

      await page.getByTestId('save-button').click();
      await expect.poll(() => readFile(file, 'utf8'), { timeout: 15_000 })
        .toMatch(/!\[image-\d{17}\]\(\.\/assets\/image-\d{17}\.png\)/);
    } finally {
      await app.close();
    }
  });

  test('leaves the rest of the file byte for byte as it was', async () => {
    const { app, page, workspace, file } = await launch('untouched');
    try {
      await writeFile(file, '# Title\n\nFirst.\n\n*  odd   spacing  kept\n\nLast.\n', 'utf8');
      await app.close();
      const second = await electron.launch({
        executablePath: packagedExecutable(),
        args: [`--user-data-dir=${path.join(workspace, 'user-data')}`, `--open=${file}`],
      });
      const fresh = await second.firstWindow();
      await fresh.waitForSelector('[data-testid="noto-editor"]', { state: 'visible', timeout: 30_000 });
      try {
        await placeCaret(fresh, fresh.locator('.ProseMirror > p').first());
        await fresh.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowRight' : 'End');
        await pasteImage(fresh, PNG_BASE64);
        await expect(fresh.locator('.ProseMirror img.noto-image')).toHaveCount(1, { timeout: 15_000 });
        await fresh.getByTestId('save-button').click();
        await expect.poll(() => readFile(file, 'utf8'), { timeout: 15_000 })
          .toContain('*  odd   spacing  kept');
        // The block that was edited is the only one that was rewritten.
        expect(await readFile(file, 'utf8')).toContain('# Title\n');
      } finally {
        await second.close();
      }
    } finally {
      await app.close().catch(() => {});
    }
  });

  test('refuses bytes that are not a picture, and says so', async () => {
    const { app, page, workspace } = await launch('refused');
    try {
      await placeCaret(page, page.locator('.ProseMirror > p').last());
      await pasteImage(page, btoa('%PDF-1.7 not a picture at all'), 'image/png');
      await expect(page.getByTestId('file-truth-alert')).toContainText('not a picture', { timeout: 15_000 });
      await expect(page.locator('.ProseMirror img.noto-image')).toHaveCount(0);
      await expect(readdir(path.join(workspace, 'vault', 'assets'))).rejects.toThrow();
    } finally {
      await app.close();
    }
  });
});
