/**
 * Writing a note out as something else.
 *
 * Two jobs behind one menu: the document formats are a conversion of the
 * markdown that Pandoc does from the file, and PDF and HTML are the document as
 * Noto draws it. What is tested here is the deciding, the naming and the
 * refusing, since the conversion itself is Pandoc's.
 */

import { describe, expect, it } from 'vitest';
import {
  EXPORT_TARGETS,
  exportArguments,
  exportShape,
  exportThroughPandoc,
  needsPandoc,
  suggestedName,
} from '../../src/main/workspace/export-document';
import { standaloneHtml, escapeHtml } from '../../src/shared/export/document-html';
import { EXPORT_KINDS } from '../../src/shared/workspace/v1/contracts';

describe('the export targets', () => {
  it('renders PDF and HTML itself, and converts the rest', () => {
    // What PDF and HTML are for is how the note looks, which Pandoc has never
    // seen, so they never go through it.
    expect(needsPandoc('pdf')).toBe(false);
    expect(needsPandoc('html')).toBe(false);
    expect(needsPandoc('docx')).toBe(true);
    expect(needsPandoc('epub')).toBe(true);
  });

  it('offers what Typora offers', () => {
    expect(EXPORT_TARGETS).toContain('docx');
    expect(EXPORT_TARGETS).toContain('opml');
    expect(EXPORT_TARGETS).toContain('mediawiki');
    expect(EXPORT_TARGETS).toContain('html-plain');
  });

  it('is the same set the boundary carries, not a second list beside it', () => {
    // They were two lists once and `html-plain` was in one and not the other,
    // which turned into a crash at the moment of export rather than a type
    // error at the moment of writing.
    expect([...EXPORT_TARGETS].sort()).toEqual([...EXPORT_KINDS].sort());
    for (const kind of EXPORT_KINDS) {
      expect(() => exportShape(kind)).not.toThrow();
      expect(typeof needsPandoc(kind)).toBe('boolean');
    }
  });

  it('gives each one the extension its format actually uses', () => {
    expect(exportShape('latex').extension).toBe('tex');
    expect(exportShape('mediawiki').extension).toBe('wiki');
    expect(exportShape('docx').extension).toBe('docx');
  });
});

describe('suggestedName', () => {
  it('keeps the note name and changes the extension', () => {
    expect(suggestedName('/vault/Quarterly Report.md', 'docx')).toBe('Quarterly Report.docx');
    expect(suggestedName('/vault/研究笔记.md', 'pdf')).toBe('研究笔记.pdf');
    expect(suggestedName('/vault/notes.v2.md', 'html')).toBe('notes.v2.html');
  });
});

describe('exportArguments', () => {
  it('asks for a standalone document, resolving pictures against the note', () => {
    expect(exportArguments('/vault/notes/report.md', '/out/report.docx', 'docx')).toEqual([
      '--from', 'gfm',
      '--to', 'docx',
      // A fragment is useless in every one of these formats.
      '--standalone',
      // So `![](./assets/a.png)` resolves the way it does in the note rather
      // than against wherever the process happens to be.
      '--resource-path', '/vault/notes',
      '--output', '/out/report.docx',
      '--', '/vault/notes/report.md',
    ]);
  });

  it('puts both filenames behind the end-of-options marker', () => {
    const args = exportArguments('/vault/--version.md', '/out/x.rtf', 'rtf');
    expect(args[args.length - 2]).toBe('--');
    expect(args[args.length - 1]).toBe('/vault/--version.md');
  });

  it('refuses to build arguments for a target it does not convert', () => {
    expect(() => exportArguments('/a.md', '/b.pdf', 'pdf')).toThrow(/EXPORT_NOT_PANDOC/);
  });
});

describe('exportThroughPandoc', () => {
  const never = async () => { throw new Error('should not have run'); };

  it('refuses a note with unsaved changes, rather than exporting the old version', () => {
    // The kind of wrong nobody notices until after they have sent it on.
    return expect(exportThroughPandoc('docx', {
      notePath: '/vault/a.md', dirty: true, choose: never, findPandoc: never, run: never,
    })).resolves.toEqual({ exported: false, reason: 'unsaved' });
  });

  it('refuses with nothing open', async () => {
    expect(await exportThroughPandoc('docx', {
      notePath: null, dirty: false, choose: never, findPandoc: never, run: never,
    })).toEqual({ exported: false, reason: 'no-document' });
  });

  it('is quiet when the reader dismisses the dialog, and runs nothing', async () => {
    expect(await exportThroughPandoc('docx', {
      notePath: '/vault/a.md', dirty: false, choose: async () => null, findPandoc: never, run: never,
    })).toEqual({ exported: false, reason: 'cancelled' });
  });

  it('says when Pandoc is missing', async () => {
    expect(await exportThroughPandoc('epub', {
      notePath: '/vault/a.md',
      dirty: false,
      choose: async () => '/out/a.epub',
      findPandoc: async () => null,
      run: never,
    })).toEqual({ exported: false, reason: 'no-pandoc' });
  });

  it('offers the note name and reports where it went', async () => {
    let offered = '';
    const outcome = await exportThroughPandoc('docx', {
      notePath: '/vault/Report.md',
      dirty: false,
      choose: async (suggested) => { offered = suggested; return '/out/Report.docx'; },
      findPandoc: async () => '/p',
      run: async () => '',
    });
    expect(offered).toBe('Report.docx');
    expect(outcome).toEqual({ exported: true, path: '/out/Report.docx' });
  });

  it('reports what Pandoc said when it failed', async () => {
    const outcome = await exportThroughPandoc('epub', {
      notePath: '/vault/a.md',
      dirty: false,
      choose: async () => '/out/a.epub',
      findPandoc: async () => '/p',
      run: async () => { throw new Error('pandoc: cannot produce epub'); },
    });
    expect(outcome).toMatchObject({ exported: false, reason: 'failed' });
    expect(outcome.exported === false && outcome.detail).toContain('cannot produce epub');
  });
});

describe('standaloneHtml', () => {
  it('is a whole page with the styles written into it', () => {
    // An exported file that needs a second file to look right is not one you
    // can send to anybody.
    const page = standaloneHtml({ title: 'Report', body: '<h1>Report</h1>', styled: true });
    expect(page).toMatch(/^<!doctype html>/);
    expect(page).toContain('<title>Report</title>');
    expect(page).toContain('<style>');
    expect(page).toContain('<h1>Report</h1>');
    expect(page).toContain('@media print');
  });

  it('leaves the styles out when asked, which is Typora\'s plain HTML', () => {
    const page = standaloneHtml({ title: 'Report', body: '<h1>Report</h1>', styled: false });
    expect(page).not.toContain('<style>');
    expect(page).toContain('<h1>Report</h1>');
  });

  it('escapes the title, which comes from a filename', () => {
    const page = standaloneHtml({ title: '<script>alert(1)</script>', body: '', styled: false });
    expect(page).toContain('&lt;script&gt;');
    expect(page).not.toContain('<script>alert');
  });

  it('escapes the five characters that can end an element or an attribute', () => {
    expect(escapeHtml(`<&>"'`)).toBe('&lt;&amp;&gt;&quot;&#39;');
  });
});
