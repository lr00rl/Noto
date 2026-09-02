import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { packagedExecutable } from './packaged-app';

const resultRoot = path.join(process.cwd(), 'test-results', 'images');

/** A 1x1 PNG, which is enough for `naturalWidth` to say it loaded. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

async function invokeMenu(app: ElectronApplication, id: string): Promise<void> {
  await app.evaluate(({ Menu }, itemId) => {
    const find = (items: Electron.MenuItem[]): Electron.MenuItem | null => {
      for (const item of items) {
        if (item.id === itemId) return item;
        const nested = item.submenu ? find(item.submenu.items) : null;
        if (nested) return nested;
      }
      return null;
    };
    const menu = Menu.getApplicationMenu();
    const target = menu ? find(menu.items) : null;
    if (!target) throw new Error(`No menu item with id ${itemId}`);
    target.click();
  }, id);
}

interface Workspace {
  app: ElectronApplication;
  page: Page;
  vault: string;
  outside: string;
}

/**
 * A vault with a note two levels down, a picture beside it, a picture in a
 * sibling assets folder one level up, and a picture outside the vault.
 */
async function launch(name: string): Promise<Workspace> {
  const workspace = path.join(resultRoot, name);
  await rm(workspace, { recursive: true, force: true });
  const vault = path.join(workspace, 'vault');
  const notes = path.join(vault, 'notes');
  await mkdir(path.join(notes, 'pics'), { recursive: true });
  await mkdir(path.join(vault, 'assets'), { recursive: true });
  await writeFile(path.join(notes, 'pics', 'with space.png'), PNG);
  await writeFile(path.join(vault, 'assets', 'dot.png'), PNG);
  const outside = path.join(workspace, 'outside.png');
  await writeFile(outside, PNG);
  await writeFile(path.join(notes, 'note.md'), [
    '# Pictures',
    '',
    'Beside: ![beside](./pics/with%20space.png)',
    '',
    'Up: ![up](../assets/dot.png)',
    '',
    'Out: ![out](../../outside.png)',
    '',
    'Web: ![web](https://images.invalid/never.png)',
    '',
    'Ref: ![ref][dot]',
    '',
    '[dot]: ../assets/dot.png',
    '',
  ].join('\n'), 'utf8');

  const app = await electron.launch({
    executablePath: packagedExecutable(),
    args: [`--user-data-dir=${path.join(workspace, 'user-data')}`, `--open=${path.join(notes, 'note.md')}`],
  });
  const page = await app.firstWindow();
  await page.waitForSelector('[data-testid="noto-editor"]', { state: 'visible', timeout: 30_000 });
  await page.setViewportSize({ width: 1280, height: 900 });
  return { app, page, vault, outside };
}

async function openFolder(app: ElectronApplication, page: Page, folder: string): Promise<void> {
  await app.evaluate(({ dialog }, target) => {
    (dialog as unknown as { showOpenDialog: unknown }).showOpenDialog =
      async () => ({ canceled: false, filePaths: [target] });
  }, folder);
  await invokeMenu(app, 'open-folder');
  await expect(page.getByTestId('file-tree')).toBeVisible();
}

/** Whether the picture with this alt text has actually decoded. */
const loaded = (page: Page, alt: string) => page.evaluate((text) => {
  const img = document.querySelector<HTMLImageElement>(`img.noto-image[alt="${text}"]`);
  return img !== null && img.complete && img.naturalWidth > 0;
}, alt);

/** Ask the asset origin directly, the way the renderer would, and see whether it answers. */
const assetAnswers = (page: Page, absolutePath: string) => page.evaluate((target) => new Promise<string>((resolve) => {
  const img = new Image();
  img.onload = () => resolve('served');
  img.onerror = () => resolve('refused');
  img.src = `noto://asset/${encodeURIComponent(target)}`;
}), absolutePath);

const placeholder = (page: Page, alt: string) =>
  page.locator('.noto-image-placeholder', { has: page.locator('.noto-image-name', { hasText: alt }) });

test.describe('images', () => {
  test('shows pictures beside the note and in the open folder, and refuses one outside', async () => {
    const { app, page, vault, outside } = await launch('local');
    try {
      // Opened without a folder, the note sees only its own folder.
      await expect.poll(() => loaded(page, 'beside')).toBe(true);
      await expect(placeholder(page, 'up')).toHaveAttribute('data-reason', 'missing');
      await expect(placeholder(page, 'out')).toHaveAttribute('data-reason', 'missing');

      // Opening the vault widens what main will serve, and the note follows
      // without being reopened.
      await openFolder(app, page, vault);
      await expect.poll(() => loaded(page, 'up')).toBe(true);
      await expect.poll(() => loaded(page, 'beside')).toBe(true);
      await expect(placeholder(page, 'out')).toHaveAttribute('data-reason', 'missing');

      // A reference image resolves through its definition line. (One without a
      // definition is not an image at all to the parser, so it is plain text.)
      await expect.poll(() => loaded(page, 'ref')).toBe(true);

      // The origin itself refuses what the guard refuses, whatever the note says.
      await expect.poll(() => assetAnswers(page, path.join(vault, 'assets', 'dot.png'))).toBe('served');
      await expect.poll(() => assetAnswers(page, outside)).toBe('refused');
      await expect.poll(() => assetAnswers(page, path.join(vault, 'notes', 'note.md'))).toBe('refused');
    } finally {
      await app.close();
    }
  });

  test('web images follow the setting, at once and in both directions', async () => {
    const { app, page } = await launch('remote');
    try {
      const write = (remoteImages: boolean) => page.evaluate(async (value) => {
        const result = await (window as unknown as {
          notoSettings: { write(request: unknown): Promise<{ ok: boolean }> };
        }).notoSettings.write({ version: 1, requestId: `e2e-remote-${value}`, patch: { remoteImages: value } });
        return result.ok;
      }, remoteImages);

      // On by default: the picture is asked for. It cannot load from an
      // invalid host, but it is never held back as "web images off".
      await expect(page.locator('.noto-image-placeholder[data-reason="remote-off"]')).toHaveCount(0);

      expect(await write(false)).toBe(true);
      // The placeholder carries the alt text when there is one, so the note's
      // own words for the picture are what the reader sees in its place.
      await expect(placeholder(page, 'web')).toHaveAttribute('data-reason', 'remote-off');
      await expect(page.locator('img.noto-image[src^="https:"]')).toHaveCount(0);

      expect(await write(true)).toBe(true);
      await expect(page.locator('.noto-image-placeholder[data-reason="remote-off"]')).toHaveCount(0);
    } finally {
      await app.close();
    }
  });
});
