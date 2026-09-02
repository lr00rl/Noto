import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { packagedExecutable, placeCaret } from './packaged-app';

const resultRoot = path.join(process.cwd(), 'test-results', 'math');


const SOURCE = [
  '# Formulas',
  '',
  'Inline $E = mc^2$ in a sentence.',
  '',
  '$$',
  '\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}',
  '$$',
  '',
  'Closing paragraph.',
  '',
].join('\n');

async function launch(name: string, source = SOURCE): Promise<{
  app: ElectronApplication; page: Page; file: string;
}> {
  const workspace = path.join(resultRoot, name);
  await rm(workspace, { recursive: true, force: true });
  await mkdir(path.join(workspace, 'user-data'), { recursive: true });
  const file = path.join(workspace, 'math.md');
  await writeFile(file, source, 'utf8');

  const app = await electron.launch({
    executablePath: packagedExecutable(),
    args: [`--user-data-dir=${path.join(workspace, 'user-data')}`, `--open=${file}`],
  });
  const page = await app.firstWindow();
  await page.waitForSelector('[data-testid="noto-editor"]', { state: 'visible', timeout: 30_000 });
  await page.setViewportSize({ width: 1280, height: 900 });
  return { app, page, file };
}

test.describe('math', () => {
  test('renders formulas instead of showing LaTeX source', async () => {
    const { app, page } = await launch('render');
    try {
      // KaTeX output, not the raw source.
      await expect(page.locator('.noto-math-block .katex')).toHaveCount(1);
      await expect(page.locator('.noto-math-inline .katex')).toHaveCount(1);

      const block = page.locator('.noto-math-block .noto-math-render');
      await expect(block).toHaveAttribute('data-state', 'rendered');
      // The visual layer shows symbols, not backslash commands. KaTeX also
      // emits a MathML annotation holding the original TeX, which is why this
      // looks at the rendered HTML rather than the whole subtree.
      const visual = page.locator('.noto-math-block .katex-html');
      await expect(visual).toContainText('∑');
      await expect(visual).not.toContainText('\\sum');
    } finally {
      await app.close();
    }
  });

  test('reveals the source when the caret enters, and is editable there', async () => {
    const { app, page, file } = await launch('edit');
    try {
      const block = page.locator('.noto-math-block');
      await expect(block).not.toHaveClass(/noto-math-editing/);

      // Clicking the rendered formula puts the caret in its source.
      await page.locator('.noto-math-block .noto-math-render').click();
      await expect(block).toHaveClass(/noto-math-editing/);
      await expect(page.locator('.noto-math-block .noto-math-source')).toBeVisible();

      // It is ordinary editable text, not a widget.
      await page.keyboard.type(' + 0');
      await page.getByTestId('save-button').click();
      await expect(page.getByTestId('file-state')).toHaveText('Saved', { timeout: 15_000 });

      const saved = await readFile(file, 'utf8');
      expect(saved).toContain('\\frac{n(n+1)}{2} + 0');
      // Every other block is untouched, byte for byte.
      expect(saved).toContain('Inline $E = mc^2$ in a sentence.');
      expect(saved).toContain('Closing paragraph.');
    } finally {
      await app.close();
    }
  });

  test('re-renders after the caret leaves', async () => {
    const { app, page } = await launch('rerender');
    try {
      await page.locator('.noto-math-block .noto-math-render').click();
      await expect(page.locator('.noto-math-block')).toHaveClass(/noto-math-editing/);

      // Move the caret into ordinary prose.
      await placeCaret(page, page.locator('.ProseMirror p').last());
      await expect(page.locator('.noto-math-block')).not.toHaveClass(/noto-math-editing/);
      await expect(page.locator('.noto-math-block .katex')).toHaveCount(1);
    } finally {
      await app.close();
    }
  });

  test('reports a formula it cannot render without breaking the document', async () => {
    const source = '# Broken\n\n$$\n\\frac{1\n$$\n\nStill here.\n';
    const { app, page } = await launch('invalid', source);
    try {
      const render = page.locator('.noto-math-block .noto-math-render');
      await expect(render).toHaveAttribute('data-state', 'error');
      // The rest of the document still renders.
      await expect(page.locator('.ProseMirror')).toContainText('Still here.');
    } finally {
      await app.close();
    }
  });

  test('saves an untouched document byte for byte', async () => {
    const { app, page, file } = await launch('fidelity');
    try {
      // Make one unrelated edit so there is something to save.
      await placeCaret(page, page.locator('.ProseMirror p').last());
      await page.keyboard.type('!');
      await page.getByTestId('save-button').click();
      await expect(page.getByTestId('file-state')).toHaveText('Saved', { timeout: 15_000 });

      // The math blocks were never entered, so they are exactly as written,
      // including the fence style and line breaks.
      expect(await readFile(file, 'utf8'))
        .toBe(SOURCE.replace('Closing paragraph.', 'Closing paragraph.!'));
    } finally {
      await app.close();
    }
  });
});
