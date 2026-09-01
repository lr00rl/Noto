/**
 * Splits the cost of a keystroke into the part we control and the part we do
 * not.
 *
 * A keypress does two things: ProseMirror applies a transaction and updates the
 * DOM, which is our JavaScript, and then the engine lays the page out and
 * paints it, which is not. Knowing which of the two dominates decides where to
 * look, and guessing has already cost one wrong fix.
 */

import { copyFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { _electron as electron } from 'playwright';

const ROOT = process.cwd();
const workspace = path.join(ROOT, 'out/bench/typing-probe');

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

for (const name of process.argv.slice(2).length ? process.argv.slice(2) : ['medium', 'large']) {
  await rm(workspace, { recursive: true, force: true });
  await mkdir(path.join(workspace, 'user-data'), { recursive: true });
  const file = path.join(workspace, `${name}.md`);
  await copyFile(path.join(ROOT, 'out/bench/corpus', `${name}.md`), file);

  const app = await electron.launch({
    executablePath: path.join(ROOT, 'out/e2e/Noto-darwin-arm64/Noto.app/Contents/MacOS/Noto'),
    args: [`--user-data-dir=${path.join(workspace, 'user-data')}`],
  });
  const page = await app.firstWindow();
  await page.waitForSelector('[data-testid="empty-state"]', { state: 'visible', timeout: 60_000 });
  await page.evaluate((target) => window.notoWorkspace.openPath({
    version: 1, requestId: 'typing-probe', path: target,
  }), file);
  await page.waitForSelector('.ProseMirror', { state: 'visible', timeout: 180_000 });
  await page.waitForTimeout(1000);

  const paragraphs = page.locator('.ProseMirror > p');
  await paragraphs.nth(Math.floor((await paragraphs.count()) / 2)).click();

  const samples = await page.evaluate(async () => {
    const script = [];
    const paint = [];
    for (let stroke = 0; stroke < 14; stroke += 1) {
      const begin = performance.now();
      // Everything our code does: the transaction, the plugins, the DOM update.
      document.execCommand('insertText', false, 'x');
      const afterScript = performance.now();
      // Whatever the engine does before the next frame can be produced.
      await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
      const afterFrame = performance.now();
      script.push(afterScript - begin);
      paint.push(afterFrame - afterScript);
    }
    return { script, paint };
  });

  // The first strokes carry one-off costs, so they are dropped.
  const script = median(samples.script.slice(3));
  const paint = median(samples.paint.slice(3));
  process.stdout.write(
    `${name.padEnd(7)} script ${script.toFixed(1).padStart(7)} ms   `
    + `layout and paint ${paint.toFixed(1).padStart(7)} ms   `
    + `total ${(script + paint).toFixed(1).padStart(7)} ms\n`,
  );

  await app.close();
}
