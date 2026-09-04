import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, _electron as electron, type ElectronApplication } from '@playwright/test';
import { packagedExecutable } from './packaged-app';

/** Click a theme by its label, wherever the Themes submenu sits. */
async function pickTheme(app: ElectronApplication, label: string): Promise<void> {
  await app.evaluate(({ Menu }, wanted) => {
    const find = (items: Electron.MenuItem[]): Electron.MenuItem | null => {
      for (const item of items) {
        if (item.label === 'Themes' && item.submenu) {
          const found = item.submenu.items.find((entry) => entry.label === wanted);
          if (found) return found;
        }
        const nested = item.submenu ? find(item.submenu.items) : null;
        if (nested) return nested;
      }
      return null;
    };
    const target = find(Menu.getApplicationMenu()!.items);
    if (!target) throw new Error(`no theme ${wanted}`);
    target.click();
  }, label);
}

const ticked = (app: ElectronApplication) => app.evaluate(({ Menu }) => {
  const find = (items: Electron.MenuItem[]): Electron.MenuItem[] | null => {
    for (const item of items) {
      if (item.label === 'Themes' && item.submenu) return item.submenu.items;
      const nested = item.submenu ? find(item.submenu.items) : null;
      if (nested) return nested;
    }
    return null;
  };
  return (find(Menu.getApplicationMenu()!.items) ?? []).filter((item) => item.checked).map((item) => item.label);
});

test('a theme in the folder can be chosen from the menu, and stays chosen', async () => {
  const workspace = path.join(process.cwd(), 'test-results', 'themes');
  await rm(workspace, { recursive: true, force: true });
  const userData = path.join(workspace, 'user-data');
  await mkdir(path.join(userData, 'themes'), { recursive: true });
  await writeFile(
    path.join(userData, 'themes', 'ink-blue.css'),
    ':root { --accent: rgb(20, 60, 200); }\n',
    'utf8',
  );
  const vault = path.join(workspace, 'vault');
  await mkdir(vault, { recursive: true });
  await writeFile(path.join(vault, 'note.md'), '# Theme\n\nA [link](https://example.com) in the accent.\n', 'utf8');
  const launch = () => electron.launch({
    executablePath: packagedExecutable(),
    args: [`--user-data-dir=${userData}`, vault],
  });

  let app = await launch();
  try {
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.waitForSelector('[data-testid="file-tree"]', { state: 'visible', timeout: 30_000 });
    await page.getByTestId('tree-file').first().click();
    const link = page.locator('.canvas-slot:not([hidden]) .ProseMirror a').first();
    await link.waitFor();

    // The built-in look to start with, and the folder's stylesheet on offer.
    expect(await ticked(app)).toEqual(['Noto']);
    await expect(link).toHaveCSS('color', 'rgb(168, 93, 59)');

    await pickTheme(app, 'Ink blue');
    await expect.poll(() => link.evaluate((node) => getComputedStyle(node).color)).toBe('rgb(20, 60, 200)');
    expect(await ticked(app)).toEqual(['Ink blue']);
  } finally {
    await app.close();
  }

  // Chosen means chosen: the next window comes up wearing it.
  app = await launch();
  try {
    const page = await app.firstWindow();
    await page.waitForSelector('[data-testid="file-tree"]', { state: 'visible', timeout: 30_000 });
    await page.getByTestId('tree-file').first().click();
    const link = page.locator('.canvas-slot:not([hidden]) .ProseMirror a').first();
    await link.waitFor();
    await expect.poll(() => link.evaluate((node) => getComputedStyle(node).color)).toBe('rgb(20, 60, 200)');
    expect(await ticked(app)).toEqual(['Ink blue']);
  } finally {
    await app.close();
  }
});
