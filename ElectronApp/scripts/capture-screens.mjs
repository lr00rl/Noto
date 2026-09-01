/**
 * Capture the shell at the widths the design rules require.
 *
 * Not part of the test suite: this exists so a human can look at the product
 * rather than infer it from assertions.
 */

import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'test-results/screens');
const workspace = path.join(outDir, 'workspace');

const SAMPLE = `---
title: Noto
---

# Noto

A quiet writing surface. Everything below is a real editable node, not frozen
source: tables, tasks, math, footnotes and fenced code all behave like the rest
of the document.

## Tables

| Construct | Editable | Notes |
| --- | :--: | --- |
| Table | yes | including alignment |
| Task list | yes | with checked state |
| Math | yes | source preserved |

## Tasks

- [x] own the markdown pipeline
- [x] own the ProseMirror schema
- [ ] finish the plugin tier

## Math

$$
\\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx = \\sqrt{\\pi}
$$

## Code

\`\`\`ts
export function capture(doc: Node): Transaction {
  return { units: doc.children.map(toUnit) };
}
\`\`\`

## Prose

Some *emphasis*, some **strength**, a bit of \`inline code\`, a [link](https://example.com)
and a footnote reference.[^1]

[^1]: Footnotes are ordinary blocks too.
`;

async function main() {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(workspace, { recursive: true });
  const file = path.join(workspace, 'showcase.md');
  await writeFile(file, SAMPLE, 'utf8');

  const executable = process.platform === 'darwin'
    ? path.join(root, `out/e2e/Noto-${process.platform}-${process.arch}/Noto.app/Contents/MacOS/Noto`)
    : path.join(root, `out/e2e/Noto-${process.platform}-${process.arch}`, process.platform === 'win32' ? 'Noto.exe' : 'noto');

  for (const [name, width, height, open] of [
    ['empty-1440', 1440, 900, false],
    ['document-1440', 1440, 900, true],
    ['document-dark-1440', 1440, 900, true],
    ['code-1440', 1440, 900, true],
    ['code-dark-1440', 1440, 900, true],
    ['document-375', 375, 820, true],
  ]) {
    const userData = path.join(outDir, `user-data-${name}`);
    await mkdir(userData, { recursive: true });
    const args = [`--user-data-dir=${userData}`];
    if (open) args.push(`--open=${file}`);
    const app = await electron.launch({ executablePath: executable, args });
    const page = await app.firstWindow();
    await page.waitForSelector('[data-testid="noto-app"]', { timeout: 30_000 });
    await page.setViewportSize({ width, height });
    if (open) {
      await page.waitForSelector('[data-testid="noto-editor"]', { timeout: 30_000 });
      if (width >= 900) await page.getByTestId('outline-toggle').click();
    }
    if (name.includes('dark')) await page.getByTestId('theme-button').click();
    // The code shots exist to show highlighting, which sits below the fold.
    if (name.startsWith('code')) {
      await page.locator('.ProseMirror pre').first().scrollIntoViewIfNeeded();
    }
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(outDir, `${name}.png`) });
    await app.close();
    console.log(`captured ${name}`);
  }
}

await main();
