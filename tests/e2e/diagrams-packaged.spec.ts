import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { packagedExecutable } from './packaged-app';

const resultRoot = path.join(process.cwd(), 'test-results', 'diagrams');

const SOURCE = [
  '# Diagrams',
  '',
  'Before.',
  '',
  '```mermaid',
  'graph TD',
  '  A[Start] --> B[End]',
  '```',
  '',
  'After.',
  '',
].join('\n');

async function launch(name: string, markdown: string): Promise<{ app: ElectronApplication; page: Page; file: string }> {
  const workspace = path.join(resultRoot, name);
  await rm(workspace, { recursive: true, force: true });
  await mkdir(path.join(workspace, 'user-data'), { recursive: true });
  const file = path.join(workspace, 'note.md');
  await writeFile(file, markdown, 'utf8');
  const app = await electron.launch({
    executablePath: packagedExecutable(),
    args: [`--user-data-dir=${path.join(workspace, 'user-data')}`, `--open=${file}`],
  });
  const page = await app.firstWindow();
  await page.waitForSelector('[data-testid="noto-editor"]', { state: 'visible', timeout: 30_000 });
  await page.setViewportSize({ width: 1280, height: 800 });
  return { app, page, file };
}

test.describe('diagrams', () => {
  test('draws a mermaid fence, keeps the source out of sight, and gives it back to a press', async () => {
    const { app, page, file } = await launch('draw', SOURCE);
    try {
      const fence = page.locator('pre.noto-fence[data-lang="mermaid"]');
      const diagram = fence.locator('.noto-diagram');
      await expect(diagram).toHaveAttribute('data-state', 'rendered', { timeout: 20_000 });
      const frame = diagram.locator('iframe');
      const drawn = await frame.evaluate((element) => element.getBoundingClientRect().height);
      expect(drawn).toBeGreaterThan(80);

      // The caret is in the heading, so only the drawing shows: the source is
      // in the page but not in sight, and the fence has no box.
      const hidden = await fence.locator('.noto-fence-code').evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width <= 1 && rect.height <= 1;
      });
      expect(hidden).toBe(true);
      await expect(fence).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');

      // A press on the drawing puts the caret in the source, which comes back.
      await diagram.click({ position: { x: 30, y: 30 } });
      await expect(fence).toHaveClass(/noto-active-block/);
      const shown = await fence.locator('.noto-fence-code').evaluate((element) => element.getBoundingClientRect().height);
      expect(shown).toBeGreaterThan(20);

      // A change redraws, taller. The caret is at the top of the source; End
      // scrolls on macOS rather than moving, so the line's end is Command+Right.
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowRight' : 'End');
      await page.keyboard.type('\n  B --> C[Then]\n  C --> D[Last]');
      await expect(diagram).toHaveAttribute('data-state', 'rendered');
      await expect.poll(async () => frame.evaluate((element) => element.getBoundingClientRect().height), { timeout: 10_000 })
        .toBeGreaterThan(drawn + 40);

      // The file holds the source and nothing of the drawing.
      await page.getByTestId('save-button').click();
      await expect.poll(async () => readFile(file, 'utf8')).toContain('  B --> C[Then]\n  C --> D[Last]\n```');
      expect(await readFile(file, 'utf8')).not.toContain('svg');
    } finally {
      await app.close();
    }
  });

  test('says when a diagram cannot be drawn, without touching the source', async () => {
    const broken = SOURCE.replace('graph TD\n  A[Start] --> B[End]', 'graph TD\n  A[Start] --> ');
    const { app, page } = await launch('broken', broken);
    try {
      const diagram = page.locator('pre.noto-fence[data-lang="mermaid"] .noto-diagram');
      await expect(diagram).toHaveAttribute('data-state', 'failed', { timeout: 20_000 });
      await expect(diagram.locator('.noto-diagram-status')).toContainText('could not be drawn');
      await expect(page.locator('pre.noto-fence[data-lang="mermaid"] .noto-fence-code')).toHaveText('graph TD\n  A[Start] --> ');
    } finally {
      await app.close();
    }
  });
});
