import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { packagedExecutable } from './packaged-app';

const resultRoot = path.join(process.cwd(), 'test-results', 'indent-guides');

const NOTE = [
  '# Guides', '',
  '```python',
  'def f(x):',
  '    if x:',
  '        for i in range(3):',
  '            print(i)',
  '    return x',
  '```', '',
].join('\n');

async function launch(): Promise<{ app: ElectronApplication; page: Page }> {
  const workspace = path.join(resultRoot, 'guides');
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
  await page.setViewportSize({ width: 1000, height: 700 });
  return { app, page };
}

test.describe('indent guides', () => {
  test('draw a rule on the indentation, and go when the setting says so', async () => {
    const { app, page } = await launch();
    try {
      // One span per line that has a step to its left: the two deepest lines.
      const guides = page.locator('.ProseMirror pre code span[style*="linear-gradient"]');
      await expect(guides).toHaveCount(2);

      // The rules are drawn in the guide colour, which the theme supplies.
      /** True when every colour in the gradient is fully see-through. */
      const invisible = () => guides.first().evaluate((el) => {
        const image = getComputedStyle(el).backgroundImage;
        // Both spellings a browser may compute: `rgba(r, g, b, a)` and the
        // wide-gamut `color(srgb r g b / a)` that a colour mix resolves to.
        const colours = image.match(/(?:rgba?|color)\([^)]*\)/g) ?? [];
        return colours.every((colour) => {
          const slashed = colour.match(/\/\s*([\d.]+)\s*\)/);
          if (slashed) return Number(slashed[1]) === 0;
          const parts = colour.match(/[\d.]+/g) ?? [];
          return parts.length >= 4 && Number(parts[3]) === 0;
        });
      });
      expect(await guides.first().evaluate((el) => getComputedStyle(el).backgroundImage)).toContain('gradient');
      expect(await invisible()).toBe(false);

      // The whitespace is real text, so the code still copies as code.
      expect(await page.locator('.ProseMirror pre code').innerText()).toContain('    if x:');

      // Off: the spans stay, since they are the document's own whitespace, but
      // nothing is painted on them.
      await page.evaluate(() => window.notoSettings.write({
        version: 1, requestId: 'guides-off', patch: { codeIndentGuides: false },
      }));
      await expect(page.locator('html')).toHaveAttribute('data-code-indent-guides', 'off');
      await expect.poll(invisible).toBe(true);
    } finally {
      await app.close();
    }
  });
});
