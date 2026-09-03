/**
 * Importing a document that is not markdown.
 *
 * Pandoc does the conversion, so what is tested here is everything around it:
 * what gets read as what, what the note is called, what is run, and what
 * happens when pandoc is not installed, which on a fresh machine is the first
 * thing that happens.
 */

import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  IMPORTABLE_EXTENSIONS,
  findPandoc,
  importDocument,
  importedFileName,
  pandocArguments,
  pandocFormatFor,
} from '../../src/main/workspace/import-document';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function folder(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'noto-import-'));
  roots.push(root);
  return root;
}

describe('pandocFormatFor', () => {
  it('names the format rather than letting pandoc guess', () => {
    // Pandoc's guess for an unknown extension is markdown, which would import a
    // Word document as a page of mojibake instead of failing.
    expect(pandocFormatFor('report.docx')).toBe('docx');
    expect(pandocFormatFor('notes.ODT')).toBe('odt');
    expect(pandocFormatFor('page.htm')).toBe('html');
    expect(pandocFormatFor('paper.tex')).toBe('latex');
    expect(pandocFormatFor('book.epub')).toBe('epub');
    expect(pandocFormatFor('analysis.ipynb')).toBe('ipynb');
  });

  it('refuses what it does not know', () => {
    expect(pandocFormatFor('archive.zip')).toBeNull();
    expect(pandocFormatFor('photo.png')).toBeNull();
    expect(pandocFormatFor('README')).toBeNull();
    expect(pandocFormatFor('already.md')).toBeNull();
  });

  it('offers the same list to the file dialog', () => {
    expect(IMPORTABLE_EXTENSIONS).toContain('docx');
    expect(IMPORTABLE_EXTENSIONS).not.toContain('md');
    expect(IMPORTABLE_EXTENSIONS.every((extension) => !extension.startsWith('.'))).toBe(true);
  });
});

describe('pandocArguments', () => {
  it('asks for unwrapped GitHub markdown with the pictures extracted', () => {
    const args = pandocArguments('/in/report.docx', 'docx', '/vault/report.assets');
    expect(args).toEqual([
      '--from', 'docx',
      '--to', 'gfm',
      // Pandoc hard-wraps at 72 columns otherwise, which turns every imported
      // paragraph into a stack of short lines and is wrong twice over for
      // Chinese, where the wrap lands mid-sentence.
      '--wrap', 'none',
      '--extract-media', '/vault/report.assets',
      '--', '/in/report.docx',
    ]);
  });

  it('puts the filename behind the end-of-options marker', () => {
    // So a document called `--version.docx` is a document and not a flag.
    const args = pandocArguments('/in/--version.docx', 'docx', '/m');
    expect(args[args.length - 2]).toBe('--');
    expect(args[args.length - 1]).toBe('/in/--version.docx');
  });
});

describe('importedFileName', () => {
  it('keeps the name the document already had', () => {
    expect(importedFileName('Quarterly Report.docx', new Set())).toBe('Quarterly Report.md');
    expect(importedFileName('研究笔记.odt', new Set())).toBe('研究笔记.md');
  });

  it('numbers a second import rather than writing over the first', () => {
    const taken = new Set(['Report.md']);
    expect(importedFileName('Report.docx', taken)).toBe('Report 2.md');
    expect(importedFileName('Report.docx', new Set([...taken, 'Report 2.md']))).toBe('Report 3.md');
  });
});

describe('findPandoc', () => {
  it('looks where a person actually installs it, not only on the process PATH', async () => {
    // A window-server-launched application inherits a PATH with none of these
    // in it, so looking only there is the difference between the feature
    // working and never working for anybody.
    const seen: string[] = [];
    await findPandoc(async (candidate) => { seen.push(candidate); return false; });
    expect(seen).toContain('/opt/homebrew/bin/pandoc');
    expect(seen).toContain('/usr/local/bin/pandoc');
  });

  it('is null when it is nowhere, rather than a name that will fail later', async () => {
    expect(await findPandoc(async () => false)).toBeNull();
  });

  it('takes the first one it finds', async () => {
    expect(await findPandoc(async (candidate) => candidate === '/usr/local/bin/pandoc'))
      .toBe('/usr/local/bin/pandoc');
  });
});

describe('importDocument', () => {
  const never = async () => { throw new Error('should not have run'); };

  it('says so when pandoc is not installed, and runs nothing', async () => {
    expect(await importDocument({
      folder: '/vault',
      choose: async () => '/in/report.docx',
      findPandoc: async () => null,
      run: never,
    })).toEqual({ imported: false, reason: 'no-pandoc' });
  });

  it('refuses with nowhere to put the result', async () => {
    expect(await importDocument({
      folder: null,
      choose: never,
      findPandoc: never,
      run: never,
    })).toEqual({ imported: false, reason: 'no-folder' });
  });

  it('is quiet when the reader dismisses the dialog', async () => {
    expect(await importDocument({
      folder: '/vault',
      choose: async () => null,
      findPandoc: never,
      run: never,
    })).toEqual({ imported: false, reason: 'cancelled' });
  });

  it('refuses a file it has no format for, before looking for pandoc', async () => {
    expect(await importDocument({
      folder: '/vault',
      choose: async () => '/in/archive.zip',
      findPandoc: never,
      run: never,
    })).toEqual({ imported: false, reason: 'unsupported' });
  });

  it('writes what pandoc produced into the folder and says where', async () => {
    const root = await folder();
    const outcome = await importDocument({
      folder: root,
      choose: async () => '/in/Quarterly Report.docx',
      findPandoc: async () => '/opt/homebrew/bin/pandoc',
      run: async () => '# Quarterly Report\n\nThe body.',
    });
    expect(outcome).toEqual({ imported: true, path: path.join(root, 'Quarterly Report.md') });
    // Every note this app writes ends with a newline, imports included.
    expect(await readFile(path.join(root, 'Quarterly Report.md'), 'utf8'))
      .toBe('# Quarterly Report\n\nThe body.\n');
  });

  it('does not write over a note that is already there', async () => {
    const root = await folder();
    await writeFile(path.join(root, 'Report.md'), '# Mine\n', 'utf8');
    const outcome = await importDocument({
      folder: root,
      choose: async () => '/in/Report.docx',
      findPandoc: async () => '/p',
      run: async () => '# Converted\n',
    });
    expect(outcome).toEqual({ imported: true, path: path.join(root, 'Report 2.md') });
    expect(await readFile(path.join(root, 'Report.md'), 'utf8')).toBe('# Mine\n');
    expect((await readdir(root)).sort()).toEqual(['Report 2.md', 'Report.md']);
  });

  it('reports a conversion that failed, with what pandoc said', async () => {
    const root = await folder();
    const outcome = await importDocument({
      folder: root,
      choose: async () => '/in/broken.docx',
      findPandoc: async () => '/p',
      run: async () => { throw new Error('pandoc: broken.docx: not a docx'); },
    });
    expect(outcome).toMatchObject({ imported: false, reason: 'failed' });
    expect(outcome.imported === false && outcome.detail).toContain('not a docx');
    // Nothing half-written left behind.
    expect(await readdir(root)).toEqual([]);
  });

  it('names the pictures folder after the note, not after the source', async () => {
    const root = await folder();
    let args: readonly string[] = [];
    await importDocument({
      folder: root,
      choose: async () => '/in/Report.docx',
      findPandoc: async () => '/p',
      run: async (_binary, given) => { args = given; return '# x\n'; },
    });
    expect(args).toContain(path.join(root, 'Report.assets'));
  });
});
