import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { packagedExecutable } from './packaged-app';

async function launch(name: string, extra: Readonly<Record<string, string>> = {}): Promise<{ app: ElectronApplication; page: Page; vault: string }> {
  const workspace = path.join(process.cwd(), 'test-results', 'tree-drag', name);
  await rm(workspace, { recursive: true, force: true });
  await mkdir(path.join(workspace, 'user-data'), { recursive: true });
  const vault = path.join(workspace, 'vault');
  await mkdir(path.join(vault, 'topics'), { recursive: true });
  await mkdir(path.join(vault, 'archive'), { recursive: true });
  await writeFile(path.join(vault, 'loose.md'), '# Loose\n\nA note at the root.\n', 'utf8');
  await writeFile(path.join(vault, 'topics', 'kept.md'), '# Kept\n', 'utf8');
  // The tree is listed when the folder opens, so anything a test needs to see
  // has to be on disk before the window is.
  for (const [name, body] of Object.entries(extra)) await writeFile(path.join(vault, name), body, 'utf8');
  const app = await electron.launch({
    executablePath: packagedExecutable(),
    args: [`--user-data-dir=${path.join(workspace, 'user-data')}`, vault],
  });
  const page = await app.firstWindow();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForSelector('[data-testid="file-tree"]', { state: 'visible', timeout: 30_000 });
  return { app, page, vault };
}

/**
 * Drag one row onto another. The browser's own drag cannot be driven by the
 * mouse in a test, so the events are dispatched with a DataTransfer of their
 * own, which is what the handlers read.
 */
async function dragOnto(page: Page, source: string, target: string): Promise<void> {
  await page.evaluate(([from, to]) => {
    const find = (path: string) => Array.from(document.querySelectorAll<HTMLElement>('.tree-row'))
      .find((row) => row.getAttribute('title') === path || row.dataset.path === path
        || row.querySelector('.tree-name')?.textContent === path);
    const start = find(from as string);
    const end = find(to as string);
    if (!start || !end) throw new Error(`no row for ${!start ? from : to}`);
    const data = new DataTransfer();
    start.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: data }));
    end.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: data }));
    end.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data }));
    start.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: data }));
  }, [source, target]);
}

test.describe('dragging in the tree', () => {
  test('moves a note into the folder it is dropped on, and back to the vault', async () => {
    const { app, page, vault } = await launch('move');
    try {
      await dragOnto(page, 'loose.md', 'archive');
      await expect.poll(() => readdir(path.join(vault, 'archive'))).toEqual(['loose.md']);
      await expect.poll(() => readdir(vault)).toEqual(['archive', 'topics']);
      // The tree shows it in its new place.
      await page.getByTestId('tree-directory').filter({ hasText: 'archive' }).click();
      await expect(page.getByTestId('tree-file').filter({ hasText: 'loose' })).toHaveCount(1);

      // And back onto the vault row, which is a folder too.
      await dragOnto(page, 'loose.md', path.basename(vault));
      await expect.poll(() => readdir(vault)).toEqual(['archive', 'loose.md', 'topics']);
    } finally {
      await app.close();
    }
  });

  test('refuses a folder into itself and says when a name is taken', async () => {
    const { app, page, vault } = await launch('refuse', { 'kept.md': '# Another\n' });
    try {
      // A folder cannot be dropped into itself.
      await dragOnto(page, 'topics', 'topics');
      await expect.poll(() => readdir(path.join(vault, 'topics'))).toEqual(['kept.md']);

      // A note whose name is already taken there is refused, and said so.
      await dragOnto(page, 'kept.md', 'topics');
      await expect(page.getByTestId('file-truth-alert')).toContainText('already called that', { timeout: 15_000 });
      await expect.poll(() => readdir(vault)).toContain('kept.md');
      await expect.poll(() => readdir(path.join(vault, 'topics'))).toEqual(['kept.md']);
    } finally {
      await app.close();
    }
  });
});
