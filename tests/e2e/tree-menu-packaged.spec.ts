import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { packagedExecutable } from './packaged-app';

const resultRoot = path.join(process.cwd(), 'test-results', 'tree-menu');

async function launch(name: string): Promise<{ app: ElectronApplication; page: Page; vault: string; outside: string }> {
  const workspace = path.join(resultRoot, name);
  await rm(workspace, { recursive: true, force: true });
  const vault = path.join(workspace, 'vault');
  await mkdir(path.join(vault, 'sub'), { recursive: true });
  await mkdir(path.join(workspace, 'user-data'), { recursive: true });
  await writeFile(path.join(vault, 'note.md'), '# Note\n', 'utf8');
  await writeFile(path.join(vault, 'sub', 'deeper.md'), '# Deeper\n', 'utf8');
  const outside = path.join(workspace, 'secret.md');
  await writeFile(outside, '# Not in the vault\n', 'utf8');
  const app = await electron.launch({
    executablePath: packagedExecutable(),
    args: [`--user-data-dir=${path.join(workspace, 'user-data')}`, vault],
  });
  const page = await app.firstWindow();
  await page.setViewportSize({ width: 1100, height: 700 });
  await page.waitForSelector('[data-testid="file-tree"]', { state: 'visible', timeout: 30_000 });
  return { app, page, vault, outside };
}

/** Ask for the menu the way the tree does, without a real right click. */
async function ask(page: Page, target: string, kind: 'file' | 'directory') {
  return page.evaluate(async ([p, k]) => {
    const result = await window.notoWorkspace.treeMenu({
      version: 1, requestId: `tree-menu:${Math.random().toString(36).slice(2)}`, path: p as string,
      kind: k as 'file' | 'directory',
    });
    return result.ok ? result.value.accepted : `error:${result.error.message}`;
  }, [target, kind]);
}

test.describe('the menu on a row of the tree', () => {
  test('is refused for anything outside it, however it is named', async () => {
    const { app, page, vault, outside } = await launch('outside');
    try {
      // A sibling of the folder, named directly.
      expect(await ask(page, outside, 'file')).toBe(false);
      // And named by climbing out of the folder.
      expect(await ask(page, path.join(vault, '..', 'secret.md'), 'file')).toBe(false);
      expect(await ask(page, '/etc/hosts', 'file')).toBe(false);
    } finally {
      await app.close();
    }
  });

  /*
   * Only the refusal is driven here. A row that is accepted opens a native
   * menu, which holds the input loop until somebody dismisses it and no
   * automated pointer can reach, so the run hangs. What an accepted row offers
   * is read from the template instead, in `tests/unit/tree-row-menu.test.ts`.
   */
});
