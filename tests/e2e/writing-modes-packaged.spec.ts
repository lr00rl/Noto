import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { packagedExecutable, placeCaret } from './packaged-app';

const resultRoot = path.join(process.cwd(), 'test-results', 'writing-modes');

/**
 * Enough paragraphs that the document is taller than the window. Separated by
 * a blank line, since a single newline is a line break inside one paragraph.
 */
const NOTE = `# Modes\n\n${Array.from({ length: 60 }, (_, i) => `Paragraph number ${i + 1}.`).join('\n\n')}\n`;

async function launch(name: string): Promise<{ app: ElectronApplication; page: Page }> {
  const workspace = path.join(resultRoot, name);
  await rm(workspace, { recursive: true, force: true });
  await mkdir(path.join(workspace, 'user-data'), { recursive: true });
  const file = path.join(workspace, 'note.md');
  await writeFile(file, NOTE, 'utf8');
  const app = await electron.launch({
    executablePath: packagedExecutable(),
    args: [`--user-data-dir=${path.join(workspace, 'user-data')}`, `--open=${file}`],
  });
  const page = await app.firstWindow();
  await page.waitForSelector('[data-testid="noto-editor"]', { state: 'visible', timeout: 30_000 });
  await page.setViewportSize({ width: 1100, height: 700 });
  return { app, page };
}

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

test.describe('the writing modes Typora has', () => {
  test('focus mode quietens every block but the one being written', async () => {
    const { app, page } = await launch('focus');
    try {
      const third = page.locator('.ProseMirror > p').nth(2);
      await placeCaret(page, third);
      // Off: every block is at full strength.
      await expect(page.locator('html')).toHaveAttribute('data-focus-mode', 'off');
      expect(await third.evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
      const other = page.locator('.ProseMirror > p').nth(8);
      expect(await other.evaluate((el) => getComputedStyle(el).opacity)).toBe('1');

      await invokeMenu(app, 'toggle-focus-mode');
      await expect(page.locator('html')).toHaveAttribute('data-focus-mode', 'on');
      // The block with the caret keeps its strength; the rest recede.
      await expect(third).toHaveClass(/noto-active-block/);
      expect(await third.evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
      await expect.poll(async () => other.evaluate((el) => getComputedStyle(el).opacity))
        .not.toBe('1');

      // And it is remembered, so it survives a reopen.
      await invokeMenu(app, 'toggle-focus-mode');
      await expect(page.locator('html')).toHaveAttribute('data-focus-mode', 'off');
    } finally {
      await app.close();
    }
  });

  test('typewriter mode brings the line being written to the middle', async () => {
    const { app, page } = await launch('typewriter');
    try {
      const canvas = page.locator('#document-canvas');
      const restingPoint = async () => canvas.evaluate((pane) => {
        const caret = document.querySelector('.noto-active-block')!.getBoundingClientRect();
        const box = pane.getBoundingClientRect();
        return (caret.top + caret.bottom) / 2 - box.top - box.height * 0.42;
      });

      // Off: typing does not move the page under the writer.
      const low = page.locator('.ProseMirror > p').nth(20);
      await low.scrollIntoViewIfNeeded();
      await placeCaret(page, low);
      const before = await canvas.evaluate((pane) => pane.scrollTop);
      await page.keyboard.type('x');
      await page.waitForTimeout(300);
      expect(await canvas.evaluate((pane) => pane.scrollTop)).toBeCloseTo(before, 0);

      await invokeMenu(app, 'toggle-typewriter');
      // On: the line being written is brought to its resting point.
      const next = page.locator('.ProseMirror > p').nth(24);
      await next.scrollIntoViewIfNeeded();
      await placeCaret(page, next);
      await page.keyboard.type('x');
      await expect.poll(async () => Math.abs(await restingPoint()), { timeout: 5_000 })
        .toBeLessThan(24);

      // And it keeps up as the writing moves down the page.
      const later = page.locator('.ProseMirror > p').nth(31);
      await placeCaret(page, later);
      await expect.poll(async () => Math.abs(await restingPoint()), { timeout: 5_000 })
        .toBeLessThan(24);
    } finally {
      await app.close();
    }
  });
});
