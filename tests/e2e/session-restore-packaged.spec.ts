import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, _electron as electron } from '@playwright/test';
import { packagedExecutable } from './packaged-app';

const resultRoot = path.join(process.cwd(), 'test-results', 'session-restore');

test.describe('launching with nothing named', () => {
  test('brings back the folder from last time, without springing the rail open', async () => {
    const ws = path.join(resultRoot, 'restore');
    await rm(ws, { recursive: true, force: true });
    const vault = path.join(ws, 'vault');
    const userData = path.join(ws, 'user-data');
    await mkdir(vault, { recursive: true });
    await mkdir(userData, { recursive: true });
    await writeFile(path.join(vault, 'first.md'), '# First\n', 'utf8');
    await writeFile(path.join(vault, 'second.md'), '# Second\n', 'utf8');

    const first = await electron.launch({
      executablePath: packagedExecutable(),
      args: [`--user-data-dir=${userData}`, vault],
    });
    const page = await first.firstWindow();
    await page.waitForSelector('[data-testid="file-tree"]', { state: 'visible', timeout: 30_000 });
    // The folder is remembered on disk asynchronously; closing on top of that
    // write is what makes this test race rather than the restore itself.
    await expect.poll(async () => readFile(path.join(userData, 'recent-folders.json'), 'utf8').catch(() => ''))
      .toContain('vault');
    await first.close();

    const second = await electron.launch({
      executablePath: packagedExecutable(),
      args: [`--user-data-dir=${userData}`],
    });
    try {
      const back = await second.firstWindow();
      await back.setViewportSize({ width: 1100, height: 700 });
      // The rail obeys its own setting rather than opening itself, so the tree
      // is asked for before it is looked at.
      await expect(back.getByTestId('file-tree')).toBeHidden();
      // A click that waits for the button, rather than one fired at whatever
      // happens to be in the document at that instant.
      await back.getByTestId('sidebar-toggle').click();
      await expect(back.getByTestId('tree-vault')).toContainText('vault');
      await expect(back.getByTestId('file-tree')).toContainText('second.md');
      // No note is opened for the reader: the folder came back, not a document.
      await expect(back.getByTestId('empty-state')).toBeVisible();
    } finally {
      await second.close();
    }
  });
});
