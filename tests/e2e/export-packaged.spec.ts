import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { packagedExecutable } from './packaged-app';

const resultRoot = path.join(process.cwd(), 'test-results', 'export');

const NOTE = [
  '# 平台增长复盘',
  '',
  'A paragraph with **bold** and `code` in it.',
  '',
  '| 指标 | 说明 |',
  '| --- | --- |',
  '| DAU | 日活跃 |',
  '',
  '- one',
  '- two',
  '',
  '```js',
  'const x = 1;',
  '```',
  '',
].join('\n');

async function launch(name: string): Promise<{
  app: ElectronApplication; page: Page; out: string;
}> {
  const workspace = path.join(resultRoot, name);
  await rm(workspace, { recursive: true, force: true });
  await mkdir(path.join(workspace, 'user-data'), { recursive: true });
  const vault = path.join(workspace, 'vault');
  await mkdir(vault, { recursive: true });
  await writeFile(path.join(vault, 'note.md'), NOTE, 'utf8');
  const app = await electron.launch({
    executablePath: packagedExecutable(),
    args: [`--user-data-dir=${path.join(workspace, 'user-data')}`, vault],
  });
  const page = await app.firstWindow();
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.waitForSelector('[data-testid="file-tree"]', { state: 'visible', timeout: 30_000 });
  await page.getByTestId('tree-file').first().click();
  await page.waitForSelector('[data-testid="noto-editor"]', { state: 'visible', timeout: 30_000 });
  await page.waitForTimeout(600);
  return { app, page, out: path.join(workspace, 'out') };
}

/**
 * Answer the save dialog without opening one.
 *
 * A native dialog holds the input loop and no automated pointer can reach it,
 * so the dialog is replaced for the length of the call. Everything after it,
 * which is all of the export, is the code under test.
 */
async function exportTo(
  app: ElectronApplication,
  page: Page,
  target: string,
  destination: string,
): Promise<unknown> {
  await app.evaluate(({ dialog }, filePath) => {
    (dialog as unknown as { showSaveDialog: unknown }).showSaveDialog =
      async () => ({ canceled: false, filePath });
  }, destination);
  return page.evaluate(async ([kind, title]) => {
    const editor = document.querySelector('.ProseMirror');
    const result = await window.notoWorkspace.exportRendered({
      version: 1,
      requestId: `export:${Math.random().toString(36).slice(2)}`,
      target: kind as 'pdf',
      html: kind === 'pdf' || kind === 'html' || kind === 'html-plain'
        ? (editor ? editor.innerHTML : '')
        : null,
      title: title as string,
      dirty: false,
    });
    return result.ok ? result.value : { transport: result.error.message };
  }, [target, 'note']);
}

test.describe('export', () => {
  test('writes a standalone HTML page with the styles in it', async () => {
    const { app, page, out } = await launch('html');
    try {
      await mkdir(out, { recursive: true });
      const destination = path.join(out, 'note.html');
      expect(await exportTo(app, page, 'html', destination)).toMatchObject({ exported: true });

      const written = await readFile(destination, 'utf8');
      expect(written).toMatch(/^<!doctype html>/);
      expect(written).toContain('<title>note</title>');
      // Standalone: the styles travel with it.
      expect(written).toContain('<style>');
      // And the document itself came through, table and all.
      expect(written).toContain('平台增长复盘');
      expect(written).toContain('<table');
      expect(written).toContain('日活跃');
    } finally {
      await app.close();
    }
  });

  test('writes the markup alone when the styles are not wanted', async () => {
    const { app, page, out } = await launch('html-plain');
    try {
      await mkdir(out, { recursive: true });
      const destination = path.join(out, 'plain.html');
      expect(await exportTo(app, page, 'html-plain', destination)).toMatchObject({ exported: true });
      const written = await readFile(destination, 'utf8');
      expect(written).not.toContain('<style>');
      expect(written).toContain('平台增长复盘');
    } finally {
      await app.close();
    }
  });

  test('prints a PDF, in a window nobody sees', async () => {
    const { app, page, out } = await launch('pdf');
    try {
      await mkdir(out, { recursive: true });
      const destination = path.join(out, 'note.pdf');
      expect(await exportTo(app, page, 'pdf', destination)).toMatchObject({ exported: true });

      const bytes = await readFile(destination);
      // A PDF says so in its first five bytes, and a page of this note is not
      // an empty one.
      expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
      expect((await stat(destination)).size).toBeGreaterThan(2_000);
    } finally {
      await app.close();
    }
  });

  test('refuses a Pandoc format while the note has unsaved changes', async () => {
    const { app, page, out } = await launch('unsaved');
    try {
      await mkdir(out, { recursive: true });
      const refused = await page.evaluate(async () => {
        const result = await window.notoWorkspace.exportRendered({
          version: 1,
          requestId: 'export:dirty',
          target: 'docx',
          html: null,
          title: 'note',
          dirty: true,
        });
        return result.ok ? result.value : { transport: result.error.message };
      });
      // It converts the file, not the screen, so exporting now would produce a
      // document of the last saved version.
      expect(refused).toMatchObject({ exported: false, reason: 'unsaved' });
    } finally {
      await app.close();
    }
  });

  test('says Pandoc is needed for a format it cannot render itself', async () => {
    const { app, page, out } = await launch('no-pandoc');
    try {
      await mkdir(out, { recursive: true });
      // Pandoc is not installed on this machine.
      expect(await exportTo(app, page, 'docx', path.join(out, 'note.docx')))
        .toMatchObject({ exported: false, reason: 'no-pandoc' });
    } finally {
      await app.close();
    }
  });
});
