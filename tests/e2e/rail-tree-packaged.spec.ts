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
      // The name, not the row: the row also carries the folder's action menu.
      await expect(vaultRow.locator('.tree-name')).toHaveText('vault');
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

  test('lights only the branch that leads to the note in front', async () => {
    const { app, page } = await launch('lit-branch');
    try {
      // Open a note, then expand a folder that has nothing to do with it.
      await page.getByTestId('tree-file').first().click();
      await page.waitForSelector('[data-testid="noto-editor"]', { state: 'visible' });
      await page.getByTestId('tree-directory').first().click();
      await expect(page.getByTestId('tree-directory')).not.toHaveCount(1);

      const lit = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.tree-body .tree-level')]
        .map((level) => ({
          // The lit length is what the accent stem is drawn to.
          lit: getComputedStyle(level).backgroundSize.split(',')[0].trim(),
          onPath: Boolean(level.querySelector(
            ':scope > .tree-node-active, :scope > .tree-node:has(> .tree-on-path)')),
        })));

      // These are custom properties, so a level nested inside a lit one used to
      // inherit its length and draw a stub of accent against its own first
      // child: a branch highlight pointing at a file nobody had opened.
      expect(lit.length).toBeGreaterThan(1);
      for (const level of lit) {
        if (!level.onPath) expect(level.lit).toBe('1px 0px');
      }
      expect(lit.some((level) => level.onPath && level.lit !== '1px 0px')).toBe(true);
    } finally {
      await app.close();
    }
  });
});

test.describe('a note opened on its own', () => {
  /** One note among others, opened directly, the way Finder opens a file. */
  async function launchFile(name: string) {
    const workspace = path.join(resultRoot, name);
    await rm(workspace, { recursive: true, force: true });
    const vault = path.join(workspace, 'vault');
    await mkdir(path.join(vault, 'sub'), { recursive: true });
    await mkdir(path.join(workspace, 'user-data'), { recursive: true });
    await writeFile(path.join(vault, 'opened.md'), '# Opened\n', 'utf8');
    await writeFile(path.join(vault, 'sibling.md'), '# Sibling\n', 'utf8');
    await writeFile(path.join(vault, 'sub', 'deeper.md'), '# Deeper\n', 'utf8');
    const app = await electron.launch({
      executablePath: packagedExecutable(),
      args: [`--user-data-dir=${path.join(workspace, 'user-data')}`, `--open=${path.join(vault, 'opened.md')}`],
    });
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1100, height: 600 });
    await page.waitForSelector('[data-testid="noto-editor"]', { state: 'visible', timeout: 30_000 });
    return { app, page };
  }

  /** The shortcut is a menu accelerator, which only the menu item can fire. */
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

  test('leaves no band across the title bar in a window too narrow for the rail', async () => {
    const { app, page } = await launchFile('narrow');
    try {
      // Below 900 the rail is hidden and the document takes the window. The
      // title bar paints the rail's ground above where the rail would be, and
      // that width is an inline style no stylesheet can outrank, so it reads
      // it through a property of its own.
      await page.setViewportSize({ width: 640, height: 700 });
      await invokeMenu(app, 'toggle-sidebar');
      await expect(page.getByTestId('file-tree')).toBeHidden();
      const band = await page.locator('.titlebar').evaluate(
        (element) => getComputedStyle(element).getPropertyValue('--titlebar-rail').trim(),
      );
      expect(band).toBe('0px');

      // Wide again, and the band comes back with the rail.
      await page.setViewportSize({ width: 1200, height: 700 });
      await expect(page.getByTestId('file-tree')).toBeVisible();
      const wide = await page.locator('.titlebar').evaluate(
        (element) => getComputedStyle(element).getPropertyValue('--titlebar-rail').trim(),
      );
      expect(wide).not.toBe('0px');
    } finally {
      await app.close();
    }
  });

  test('brings its own folder with it, so quick open has something to search', async () => {
    const { app, page } = await launchFile('lone-file');
    try {
      // The rail stays shut: the reader did not ask for this folder, and the
      // setting that decides whether it opens at launch is off by default.
      await expect(page.getByTestId('file-tree')).toBeHidden();

      await invokeMenu(app, 'quick-open');
      await page.getByTestId('quick-input').fill('deeper');
      await expect(page.getByTestId('quick-result').first()).toContainText('deeper.md');

      await page.keyboard.press('Escape');
      // And the tree knows the folder once it is asked for.
      await page.getByTestId('sidebar-toggle').click();
      await expect(page.getByTestId('tree-vault')).toContainText('vault');
      await expect(page.getByTestId('file-tree')).toContainText('sibling.md');
    } finally {
      await app.close();
    }
  });
});
