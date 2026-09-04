import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, _electron as electron, type ElectronApplication } from '@playwright/test';
import { packagedExecutable } from './packaged-app';

const NOTE = '# Table\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\nAfter.\n';

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

test('the table toolbar aligns a column, adds to the table, and takes it away', async () => {
  const workspace = path.join(process.cwd(), 'test-results', 'table-tools');
  await rm(workspace, { recursive: true, force: true });
  await mkdir(path.join(workspace, 'user-data'), { recursive: true });
  const vault = path.join(workspace, 'vault');
  await mkdir(vault, { recursive: true });
  const file = path.join(vault, 'note.md');
  await writeFile(file, NOTE, 'utf8');
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
    const tools = editor.locator('.noto-table-tools');

    // Hidden until the caret is in the table.
    await expect(tools).toHaveCSS('opacity', '0');
    await editor.locator('th').filter({ hasText: 'b' }).click();
    await expect(editor.locator('.noto-table-frame')).toHaveClass(/noto-active-block/);
    await expect(tools).toHaveCSS('opacity', '1');

    // Centre the column the caret is in: header and cell both, and the
    // caret is still in the cell afterwards.
    await tools.locator('[data-tool="align-center"]').click();
    await expect(editor.locator('th').nth(1)).toHaveCSS('text-align', 'center');
    await expect(editor.locator('td').nth(1)).toHaveCSS('text-align', 'center');
    await expect(editor.locator('th').nth(0)).not.toHaveCSS('text-align', 'center');
    await expect(tools).toHaveCSS('opacity', '1');

    // The same command from the Table menu, on the other column.
    const host = page.locator('.canvas-slot:not([hidden]) [data-testid="noto-editor"]');
    const before = (await host.getAttribute('data-caret')) ?? '';
    await editor.locator('th').filter({ hasText: 'a' }).click();
    // The editor learns of the click a moment after the browser does, and the
    // command aligns the column the editor thinks the caret is in.
    await expect(host).not.toHaveAttribute('data-caret', before);
    await invokeMenu(app, 'table-align-right');
    await expect(editor.locator('th').nth(0)).toHaveCSS('text-align', 'right');

    // A row and a column.
    await tools.locator('[data-tool="row"]').click();
    await expect(editor.locator('tr')).toHaveCount(3);
    await tools.locator('[data-tool="column"]').click();
    await expect(editor.locator('th')).toHaveCount(3);

    // Saved, the rule row carries the centring in the markdown.
    await invokeMenu(app, 'save');
    await expect.poll(() => readFile(file, 'utf8')).toMatch(/\|\s*:-+:\s*\|/);

    // And the table can go, leaving the note around it.
    await tools.locator('[data-tool="delete"]').click();
    await expect(editor.locator('table')).toHaveCount(0);
    await expect(editor).toContainText('After.');
  } finally {
    await app.close();
  }
});
