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
  const workspace = path.join(process.cwd(), 'test-results', 'guides-help', name);
  await rm(workspace, { recursive: true, force: true });
  await mkdir(path.join(workspace, 'user-data'), { recursive: true });
  const vault = path.join(workspace, 'vault');
  const deep = path.join(vault, 'works', 'jobs', 'data');
  await mkdir(deep, { recursive: true });
  for (let index = 1; index <= 30; index += 1) {
    await writeFile(path.join(deep, `note_${String(index).padStart(2, '0')}.md`), `# ${index}\n`, 'utf8');
  }
  const app = await electron.launch({
    executablePath: packagedExecutable(),
    args: [`--user-data-dir=${path.join(workspace, 'user-data')}`, vault],
  });
  const page = await app.firstWindow();
  await page.setViewportSize({ width: 1100, height: 620 });
  await page.waitForSelector('[data-testid="file-tree"]', { state: 'visible', timeout: 30_000 });
  return { app, page };
}

test.describe('the guide lines under a held row', () => {
  test('begin below the row that holds them, and are drawn over the stack', async () => {
    const { app, page } = await launch('stems');
    try {
      for (const name of ['works', 'jobs', 'data']) {
        await page.getByTestId('tree-directory').filter({ hasText: name }).first().click();
      }
      await page.getByTestId('tree-file').filter({ hasText: 'note_28' }).click();
      await expect(page.locator('[data-stuck]').first()).toBeVisible();

      // Every level whose folder row is held starts its stems at that row's
      // bottom, so no line is drawn through the row it hangs from.
      const measured = await page.evaluate(() => Array.from(
        document.querySelectorAll<HTMLElement>('.tree-level:not(.is-root)'),
      ).map((level) => {
        const row = level.parentElement?.querySelector<HTMLElement>(':scope > .tree-row');
        const start = Number.parseFloat(level.style.getPropertyValue('--stem-start') || '0');
        const gap = row ? row.getBoundingClientRect().bottom - (level.getBoundingClientRect().top + start) : 0;
        const stuck = row?.hasAttribute('data-stuck') ?? false;
        return { start, gap, stuck };
      }));
      expect(measured.some((level) => level.stuck)).toBe(true);
      for (const level of measured) {
        if (level.stuck) expect(level.start).toBeGreaterThan(0);
        // The stem begins exactly where the row ends, within a pixel.
        expect(Math.abs(level.gap)).toBeLessThan(1.5);
      }

      // The stems paint above the held rows, which carry an opaque band.
      const order = await page.evaluate(() => {
        const level = document.querySelector<HTMLElement>('.tree-level:not(.is-root)');
        const stem = level ? getComputedStyle(level, '::before').zIndex : '';
        // The row itself is what holds; the file's whole node is what holds
        // for a leaf. Either way it is the thing carrying the opaque band.
        const row = document.querySelector<HTMLElement>('.tree-directory[data-stuck]');
        return { stem, row: row ? getComputedStyle(row).zIndex : '' };
      });
      expect(Number(order.stem)).toBeGreaterThan(Number(order.row));
    } finally {
      await app.close();
    }
  });

  test('light the branch only as far as the corner that finishes it', async () => {
    const { app, page } = await launch('lit');
    try {
      await page.getByTestId('tree-directory').filter({ hasText: 'works' }).first().click();
      await page.getByTestId('tree-directory').filter({ hasText: 'jobs' }).first().click();
      await page.getByTestId('tree-directory').filter({ hasText: 'data' }).first().click();
      // The last row of its level: the lit stem must stop at its top, where
      // the corner takes over, rather than running down through the curve.
      await page.getByTestId('tree-file').filter({ hasText: 'note_30' }).click();
      await expect(page.locator('.tree-node-active')).toBeVisible();
      const geometry = await page.evaluate(() => {
        const level = Array.from(document.querySelectorAll<HTMLElement>('.tree-level'))
          .find((candidate) => candidate.querySelector(':scope > .tree-node-active'));
        if (!level) return null;
        const last = level.lastElementChild as HTMLElement;
        return {
          lit: Number.parseFloat(level.style.getPropertyValue('--path-stop')),
          quiet: Number.parseFloat(level.style.getPropertyValue('--stem-stop')),
          activeIsLast: last.classList.contains('tree-node-active'),
        };
      });
      expect(geometry?.activeIsLast).toBe(true);
      // Both stems stop in the same place, which is the top of that last row.
      expect(geometry?.lit).toBe(geometry?.quiet);
    } finally {
      await app.close();
    }
  });
});

test('the Help menu says what the app can do', async () => {
  const { app, page } = await launch('help');
  try {
    await invokeMenu(app, 'shortcuts');
    const panel = page.getByTestId('shortcuts-panel');
    await expect(panel).toBeVisible();
    await expect(page.getByTestId('shortcuts-search')).toBeFocused();
    const rows = page.getByTestId('shortcuts-row');
    expect(await rows.count()).toBeGreaterThan(12);
    await expect(panel).toContainText('Search the whole vault from the rail');

    // It can be searched, since a list this long is not read end to end.
    await page.getByTestId('shortcuts-search').fill('picgo');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('PicGo');
    await page.getByTestId('shortcuts-search').fill('nothing like this');
    await expect(panel).toContainText('Nothing here matches that.');

    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
  } finally {
    await app.close();
  }
});
