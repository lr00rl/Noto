import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { packagedExecutable } from './packaged-app';

async function invokeMenu(app: ElectronApplication, id: string): Promise<void> {
  await app.evaluate(({ Menu }, wanted) => {
    const find = (items: Electron.MenuItem[]): Electron.MenuItem | null => {
      for (const item of items) {
        if (item.id === wanted) return item;
        const nested = item.submenu ? find(item.submenu.items) : null;
        if (nested) return nested;
      }
      return null;
    };
    const target = find(Menu.getApplicationMenu()!.items);
    if (!target) throw new Error(`no menu item ${wanted}`);
    target.click();
  }, id);
}

async function launch(name: string): Promise<{ app: ElectronApplication; page: Page }> {
  const workspace = path.join(process.cwd(), 'test-results', 'paste-text', name);
  await rm(workspace, { recursive: true, force: true });
  await mkdir(path.join(workspace, 'user-data'), { recursive: true });
  const vault = path.join(workspace, 'vault');
  await mkdir(vault, { recursive: true });
  await writeFile(path.join(vault, 'note.md'), 'Start here.\n', 'utf8');
  const app = await electron.launch({
    executablePath: packagedExecutable(),
    args: [`--user-data-dir=${path.join(workspace, 'user-data')}`, vault],
  });
  const page = await app.firstWindow();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForSelector('[data-testid="file-tree"]', { state: 'visible', timeout: 30_000 });
  await page.getByTestId('tree-file').first().click();
  const editor = page.locator('.canvas-slot:not([hidden]) .ProseMirror');
  await editor.waitFor({ state: 'visible' });
  await editor.locator('p').first().click();
  await expect(editor.locator('.noto-active-block')).toHaveText('Start here.');
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowRight' : 'End');
  // The editor learns of the moved caret a moment after the browser moves it,
  // and the paste has to land after the words, not before them.
  await expect(page.locator('.canvas-slot:not([hidden]) [data-testid="noto-editor"]')).toHaveAttribute('data-caret', '12');
  return { app, page };
}

test.describe('pasting text', () => {
  test('reads plain text as markdown', async () => {
    const { app, page } = await launch('markdown');
    try {
      await app.evaluate(({ clipboard }) => clipboard.writeText('\n\n## Pasted\n\n- one\n- two\n'));
      // The clipboard is written asynchronously in this Electron.
      await app.evaluate(({ clipboard }) => clipboard.readText());
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.paste());
      const editor = page.locator('.canvas-slot:not([hidden]) .ProseMirror');
      await expect(editor.locator('h2')).toHaveText('Pasted');
      await expect(editor.locator('li')).toHaveCount(2);
      await expect(editor.locator('p').first()).toHaveText('Start here.');
    } finally {
      await app.close();
    }
  });

  test('Paste as Plain Text takes the text and leaves the rich form alone', async () => {
    const { app, page } = await launch('plain');
    try {
      await app.evaluate(({ clipboard, ClipboardItem }) => clipboard.write([new ClipboardItem({
        'text/plain': '\n\n# From the text\n\nplain *words*',
        'text/html': '<h2>From the markup</h2><p><b>bold</b></p>',
      })]));
      await invokeMenu(app, 'paste-plain');
      const editor = page.locator('.canvas-slot:not([hidden]) .ProseMirror');
      await expect(editor.locator('h1')).toHaveText('From the text');
      await expect(editor.locator('h2')).toHaveCount(0);
      await expect(editor.locator('em')).toHaveText('words');
      await expect(editor.locator('strong')).toHaveCount(0);
    } finally {
      await app.close();
    }
  });
});
