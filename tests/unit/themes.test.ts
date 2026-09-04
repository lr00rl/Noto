import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { listThemes, themeLabel } from '../../src/main/workspace/themes';

const made: string[] = [];
afterEach(async () => {
  for (const folder of made.splice(0)) await rm(folder, { recursive: true, force: true });
});

async function folderWith(names: readonly string[]): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'noto-themes-'));
  made.push(root);
  for (const name of names) await writeFile(path.join(root, name), 'body { color: red }', 'utf8');
  return root;
}

describe('the name a theme goes by', () => {
  it('is the file without its extension, read as words', () => {
    expect(themeLabel('claude-like.css')).toBe('Claude like');
    expect(themeLabel('night_owl.CSS')).toBe('Night owl');
    expect(themeLabel('Newsprint.css')).toBe('Newsprint');
  });
});

describe('the themes in a folder', () => {
  it('are the stylesheets in it, by name', async () => {
    const folder = await folderWith(['zeta.css', 'alpha.css', 'notes.md', '.hidden.css']);
    const themes = await listThemes(folder);
    expect(themes.map((theme) => theme.label)).toEqual(['Alpha', 'Zeta']);
    expect(themes[0].path).toBe(path.join(folder, 'alpha.css'));
  });

  it('are nothing at all when the folder is not there', async () => {
    await expect(listThemes(path.join(os.tmpdir(), 'noto-themes-absent-xyz'))).resolves.toEqual([]);
  });

  it('leave a folder that holds something else alone', async () => {
    const folder = await folderWith([]);
    await mkdir(path.join(folder, 'inner.css'), { recursive: true });
    // A directory named like a stylesheet is listed; reading it fails later
    // and the editor says so, which is better than a listing that lies.
    await expect(listThemes(folder)).resolves.toHaveLength(1);
  });
});
