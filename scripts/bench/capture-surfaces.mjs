/**
 * Renders every surface of the shell and saves screenshots.
 *
 * Reading the code tells you what a screen is supposed to look like. This tells
 * you what it does look like, at the widths people actually use and with a
 * document that has real content in it rather than one paragraph.
 */

import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { _electron as electron } from 'playwright';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'out/bench/surfaces');
const workspace = path.join(ROOT, 'out/bench/surface-workspace');

const NOTES = `# Field notes on the estuary

A long-running record of the salt marsh survey, kept because the tide does not
care whether anyone is watching.

## Method

Counts are taken at low water, walking the transect from the sea wall outward.
Where the channel has moved, the transect moves with it and the offset is noted
rather than corrected.

- Two observers, one recorder
- [x] Baseline established in March
- [ ] Autumn repeat still outstanding
- Counts logged to the shared sheet the same evening

| Zone | Species | Count | Trend |
| --- | --- | ---: | --- |
| Upper | Salicornia | 412 | rising |
| Middle | Spartina | 1180 | steady |
| Lower | Zostera | 96 | falling |

> The lower zone is the one to watch. Two seasons of decline is weather; three
> is a pattern.

## Density

Density per quadrat is the count over the sampled area:

$$
\\rho = \\frac{1}{n}\\sum_{i=1}^{n} \\frac{c_i}{a_i}
$$

with inline $\\rho$ reported to two decimal places.

\`\`\`ts
export function density(counts: readonly number[], area: number): number {
  const total = counts.reduce((sum, count) => sum + count, 0);
  return total / (counts.length * area);
}
\`\`\`

## Open questions

Whether the falling Zostera count reflects the channel move or a real loss is
not yet answerable from these data.
`;

const SECOND = `# Tide tables

Reference figures copied from the harbour office.
`;

async function shot(page, name) {
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  process.stdout.write(`  ${name}.png\n`);
}

await rm(OUT, { recursive: true, force: true });
await rm(workspace, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
await mkdir(path.join(workspace, 'user-data'), { recursive: true });
await mkdir(path.join(workspace, 'notes'), { recursive: true });

const file = path.join(workspace, 'notes', 'estuary.md');
const second = path.join(workspace, 'notes', 'tides.md');
await writeFile(file, NOTES, 'utf8');
await writeFile(second, SECOND, 'utf8');

const app = await electron.launch({
  executablePath: path.join(ROOT, 'out/e2e/Noto-darwin-arm64/Noto.app/Contents/MacOS/Noto'),
  args: [`--user-data-dir=${path.join(workspace, 'user-data')}`],
});
const page = await app.firstWindow();
await page.waitForSelector('[data-testid="empty-state"]', { state: 'visible', timeout: 60_000 });

await page.setViewportSize({ width: 1440, height: 900 });
await shot(page, '01-empty-1440');

await page.evaluate((target) => window.notoWorkspace.openPath({
  version: 1, requestId: 'shot-open', path: target,
}), file);
await page.waitForSelector('.ProseMirror', { state: 'visible', timeout: 60_000 });
await page.waitForTimeout(600);
await shot(page, '02-document-1440');

// Caret in a paragraph, which is when the active block and its markers show.
await page.locator('.ProseMirror p').nth(1).click();
await page.waitForTimeout(200);
await shot(page, '03-active-block-1440');

await page.evaluate((target) => window.notoWorkspace.openPath({
  version: 1, requestId: 'shot-open-2', path: target,
}), second);
await page.waitForTimeout(500);
await shot(page, '04-tabs-1440');

const menu = async (id) => app.evaluate(({ Menu }, itemId) => {
  const find = (items) => {
    for (const item of items) {
      if (item.id === itemId) return item;
      const nested = item.submenu ? find(item.submenu.items) : null;
      if (nested) return nested;
    }
    return null;
  };
  const found = find(Menu.getApplicationMenu().items);
  if (found) found.click();
}, id);

await menu('toggle-sidebar');
await page.evaluate(({ dialog }) => undefined, {}).catch(() => undefined);
await app.evaluate(({ dialog }, target) => {
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [target] });
}, path.join(workspace, 'notes'));
await menu('open-folder');
await page.waitForTimeout(600);
await shot(page, '05-file-tree-1440');

await menu('toggle-outline');
await page.waitForTimeout(400);
await shot(page, '06-outline-1440');
await menu('toggle-outline');

await menu('find-replace');
await page.getByTestId('find-input').fill('zone');
await page.waitForTimeout(400);
await shot(page, '07-find-replace-1440');
await page.getByTestId('find-close').click();

await menu('settings');
await page.waitForTimeout(400);
await shot(page, '08-settings-1440');
await page.getByTestId('settings-close').click();

// Dark, because a writing app is used at night and the palette has to hold.
await menu('settings');
await page.getByTestId('theme-dark').click();
await page.getByTestId('settings-close').click();
await page.waitForTimeout(400);
await shot(page, '09-dark-1440');
await menu('settings');
await page.getByTestId('theme-light').click();
await page.getByTestId('settings-close').click();

// The narrow width, where a three column shell has to become one.
await page.setViewportSize({ width: 375, height: 812 });
await page.waitForTimeout(600);
await shot(page, '10-document-375');

await menu('find-replace');
await page.waitForTimeout(400);
await shot(page, '11-find-375');
await page.getByTestId('find-close').click();

await menu('settings');
await page.waitForTimeout(400);
await shot(page, '12-settings-375');

await app.close();
process.stdout.write(`\nwrote ${OUT}\n`);
