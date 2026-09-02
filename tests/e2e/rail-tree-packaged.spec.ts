import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { packagedExecutable } from './packaged-app';

const resultRoot = path.join(process.cwd(), 'test-results', 'rail-tree');

/** Enough files in one folder that the rail has to scroll through it. */
const MANY = 60;

/**
 * A vault named on the command line, as `noto ~/notes`, with a folder deep
 * enough and long enough to scroll inside.
 */
async function launch(name: string): Promise<{ app: ElectronApplication; page: Page; vault: string }> {
  const workspace = path.join(resultRoot, name);
  await rm(workspace, { recursive: true, force: true });
  const vault = path.join(workspace, 'vault');
  const chapters = path.join(vault, 'chapters');
  await mkdir(path.join(chapters, 'drafts'), { recursive: true });
  await mkdir(path.join(workspace, 'user-data'), { recursive: true });
  await writeFile(path.join(vault, 'index.md'), '# Index\n', 'utf8');
  await writeFile(path.join(vault, 'notes.md'), '# Notes\n', 'utf8');
  for (let index = 1; index <= MANY; index += 1) {
    await writeFile(path.join(chapters, `chapter-${String(index).padStart(2, '0')}.md`), `# ${index}\n`, 'utf8');
  }
  await writeFile(path.join(chapters, 'drafts', 'idea.md'), '# Idea\n', 'utf8');

  const app = await electron.launch({
    executablePath: packagedExecutable(),
    args: [`--user-data-dir=${path.join(workspace, 'user-data')}`, vault],
  });
  const page = await app.firstWindow();
  // Sized before the tree is awaited: under a tiling window manager a new
  // window can open at the 720px floor, where the rail is hidden.
  await page.setViewportSize({ width: 1100, height: 600 });
  await page.waitForSelector('[data-testid="file-tree"]', { state: 'visible', timeout: 30_000 });
  return { app, page, vault };
}

test.describe('the rail tree', () => {
  test('opens a folder named on the command line, headed by its own row', async () => {
    const { app, page } = await launch('cli');
    try {
      const vaultRow = page.getByTestId('tree-vault');
      await expect(vaultRow).toHaveText('vault');
      // The first level hangs from the folder's row like every deeper level:
      // it is a connected level, not the bare root list it used to be.
      const firstLevel = page.locator('.tree-vault > .tree-level');
      await expect(firstLevel).toHaveCount(1);
      await expect(firstLevel).not.toHaveClass(/is-root/);
      await expect(firstLevel.locator('> .tree-node')).toHaveCount(3);
      await expect(page.getByTestId('empty-state')).toBeVisible();
      await expect(page.getByTestId('empty-open-folder')).toBeVisible();
    } finally {
      await app.close();
    }
  });

  test('holds the path to the current file at the top while the rest scrolls', async () => {
    const { app, page } = await launch('sticky');
    try {
      const chapters = page.getByTestId('tree-directory').filter({ hasText: 'chapters' });
      await chapters.click();
      const first = page.getByTestId('tree-file').filter({ hasText: 'chapter-01' });
      await expect(first).toBeVisible();
      // An open folder that is not on the way to the current file scrolls
      // like anything else; there is no current file yet.
      await expect(chapters).not.toHaveCSS('position', 'sticky');

      // Open the first chapter: the folder is now on the path and holds at the
      // top of the first level; the file's own row holds a row beneath it.
      await first.click();
      const firstNode = page.locator('.tree-node-active');
      await expect(chapters).toHaveCSS('position', 'sticky');
      await expect(chapters).toHaveCSS('top', '0px');
      // The file's whole node holds, since its row fills the node.
      await expect(firstNode).toHaveCSS('position', 'sticky');
      // One row down, and a row is Typora's 32.
      await expect(firstNode).toHaveCSS('top', '32px');
      await expect(page.getByTestId('tree-vault')).not.toHaveCSS('position', 'sticky');
      await expect(chapters).not.toHaveAttribute('data-stuck');

      // Scroll the rail down through the chapters, and both hold.
      await page.getByTestId('tree-file').filter({ hasText: 'chapter-60' }).scrollIntoViewIfNeeded();
      await expect(chapters).toHaveAttribute('data-stuck');
      await expect(firstNode).toHaveAttribute('data-stuck');
      const offset = await page.evaluate(() => {
        const scroller = document.querySelector<HTMLElement>('.rail-view')!;
        const row = document.querySelector<HTMLElement>('.tree-file-active')!;
        return row.getBoundingClientRect().top - scroller.getBoundingClientRect().top
          - Number.parseFloat(getComputedStyle(scroller).paddingTop);
      });
      expect(Math.round(offset)).toBe(32);

      // A sibling folder opened off the path does not join the stack.
      const drafts = page.getByTestId('tree-directory').filter({ hasText: 'drafts' });
      await drafts.scrollIntoViewIfNeeded();
      await drafts.click();
      await expect(drafts).not.toHaveCSS('position', 'sticky');

      // Back at the top, the folder rests in place again.
      await page.locator('.rail-view').evaluate((element) => element.scrollTo(0, 0));
      await expect(chapters).not.toHaveAttribute('data-stuck');
    } finally {
      await app.close();
    }
  });
});
