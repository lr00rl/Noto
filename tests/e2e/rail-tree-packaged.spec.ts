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
  await page.waitForSelector('[data-testid="file-tree"]', { state: 'visible', timeout: 30_000 });
  await page.setViewportSize({ width: 1100, height: 600 });
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

  test('holds open folders at the top while their contents scroll', async () => {
    const { app, page } = await launch('sticky');
    try {
      const chapters = page.getByTestId('tree-directory').filter({ hasText: 'chapters' });
      await chapters.click();
      await expect(page.getByTestId('tree-file').filter({ hasText: 'chapter-60' })).toBeVisible();
      await expect(chapters).toHaveCSS('position', 'sticky');
      // Depth one: one row below the vault's own row.
      await expect(chapters).toHaveCSS('top', '26px');
      await expect(chapters).not.toHaveAttribute('data-stuck');

      // Scroll the rail down into the chapters, and the folder holds.
      const last = page.getByTestId('tree-file').filter({ hasText: 'chapter-60' });
      await last.scrollIntoViewIfNeeded();
      await expect(chapters).toHaveAttribute('data-stuck');
      await expect(page.getByTestId('tree-vault')).toHaveAttribute('data-stuck');
      // One row below the top of the scroller's content, under its padding.
      const offset = await page.evaluate(() => {
        const scroller = document.querySelector<HTMLElement>('.rail-view')!;
        const row = document.querySelector<HTMLElement>('.tree-directory[aria-expanded="true"]')!;
        return row.getBoundingClientRect().top - scroller.getBoundingClientRect().top
          - Number.parseFloat(getComputedStyle(scroller).paddingTop);
      });
      expect(Math.round(offset)).toBe(26);

      // Back at the top, it is an ordinary open folder again.
      await page.locator('.rail-view').evaluate((element) => element.scrollTo(0, 0));
      await expect(chapters).not.toHaveAttribute('data-stuck');
    } finally {
      await app.close();
    }
  });
});
