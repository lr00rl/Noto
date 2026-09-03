/**
 * Bringing a document that is not markdown into the vault.
 *
 * Pandoc does the conversion, as it does for Typora. Noto does not ship it and
 * does not try to: it is a 200MB Haskell binary with its own release cadence,
 * and a reader who wants to import a Word document either has it or can install
 * it in one command. What Noto owes them is to say so plainly rather than to
 * fail with nothing on screen.
 *
 * The parts that decide things are pure and tested. What is left is one
 * subprocess call, made with an argument array and never through a shell, so
 * a filename holding a quote or a semicolon is a filename and not a command.
 */

import path from 'node:path';
import { execFile } from 'node:child_process';
import { access, mkdir, readdir, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';

/**
 * What pandoc should read a file as, by its name.
 *
 * Named explicitly rather than left to pandoc's own guess, because its guess
 * for an unknown extension is to read the file as markdown, which would import
 * a binary document as a page of mojibake instead of failing.
 */
const FORMATS = new Map<string, string>([
  ['.docx', 'docx'],
  ['.odt', 'odt'],
  ['.rtf', 'rtf'],
  ['.epub', 'epub'],
  ['.html', 'html'],
  ['.htm', 'html'],
  ['.xhtml', 'html'],
  ['.tex', 'latex'],
  ['.latex', 'latex'],
  ['.rst', 'rst'],
  ['.org', 'org'],
  ['.textile', 'textile'],
  ['.wiki', 'mediawiki'],
  ['.ipynb', 'ipynb'],
  ['.opml', 'opml'],
  ['.docbook', 'docbook'],
  ['.man', 'man'],
]);

/** The formats offered in the file dialog, without their dots. */
export const IMPORTABLE_EXTENSIONS: readonly string[] = [...FORMATS.keys()]
  .map((extension) => extension.slice(1))
  .sort();

export function pandocFormatFor(fileName: string): string | null {
  const dot = fileName.lastIndexOf('.');
  if (dot < 0) return null;
  return FORMATS.get(fileName.slice(dot).toLowerCase()) ?? null;
}

/**
 * The arguments pandoc is run with.
 *
 * `--wrap=none` because pandoc otherwise hard-wraps at 72 columns, which turns
 * every imported paragraph into a stack of short lines and is wrong twice over
 * for a vault written in Chinese, where the wrap lands mid-sentence and the
 * column count does not mean what pandoc thinks it means.
 *
 * `--extract-media` puts the pictures inside a Word document into a folder in
 * the vault and rewrites the references to point at it, so an imported document
 * arrives with its illustrations rather than with holes where they were.
 *
 * The output goes to standard output rather than to a file pandoc names, so the
 * only thing this writes is a file whose path Noto worked out itself.
 */
export function pandocArguments(source: string, format: string, mediaDirectory: string): string[] {
  return [
    '--from', format,
    // GitHub markdown is the dialect Noto reads: tables, task lists,
    // strikethrough and footnotes, and nothing that would not round trip.
    '--to', 'gfm',
    '--wrap', 'none',
    '--extract-media', mediaDirectory,
    '--', source,
  ];
}

/**
 * A free name for the imported note, from the name of what it came from.
 *
 * The same collision loop a new note uses, so importing the same document twice
 * gives two notes rather than one overwritten one.
 */
export function importedFileName(sourceName: string, taken: ReadonlySet<string>): string {
  const dot = sourceName.lastIndexOf('.');
  const stem = dot > 0 ? sourceName.slice(0, dot) : sourceName;
  if (!taken.has(`${stem}.md`)) return `${stem}.md`;
  for (let index = 2; index < 1_000; index += 1) {
    const candidate = `${stem} ${index}.md`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${stem} ${taken.size + 1}.md`;
}

/**
 * Where pandoc might be, when the app's own PATH does not have it.
 *
 * A GUI application on macOS is launched by the window server and inherits a
 * PATH that has none of the places a person installs things, so `pandoc` is on
 * this machine's shell PATH and absent from this process's. Looking in the two
 * places Homebrew uses, and the one MacPorts uses, is the difference between
 * the feature working and the feature never working for anybody who installed
 * it the ordinary way.
 */
const LIKELY_PATHS = [
  '/opt/homebrew/bin/pandoc',
  '/usr/local/bin/pandoc',
  '/opt/local/bin/pandoc',
  '/usr/bin/pandoc',
];

export async function findPandoc(
  exists: (candidate: string) => Promise<boolean> = executable,
): Promise<string | null> {
  for (const candidate of LIKELY_PATHS) {
    if (await exists(candidate)) return candidate;
  }
  // Last, and only as a name: if the process PATH does have it, the operating
  // system finds it, and if it does not this fails and the caller reports it.
  return null;
}

async function executable(candidate: string): Promise<boolean> {
  try {
    await access(candidate, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export type ImportRefusal = 'no-folder' | 'cancelled' | 'no-pandoc' | 'unsupported' | 'failed';

export type ImportOutcome =
  | { readonly imported: true; readonly path: string }
  | { readonly imported: false; readonly reason: ImportRefusal; readonly detail?: string };

export interface ImportDeps {
  /** The folder the note is written into. Null when none is open. */
  readonly folder: string | null;
  /** The file the reader chose, or null when they dismissed the dialog. */
  readonly choose: () => Promise<string | null>;
  readonly findPandoc: () => Promise<string | null>;
  readonly run: (binary: string, args: readonly string[]) => Promise<string>;
}

/** The whole import, with everything that touches the world injected. */
export async function importDocument(deps: ImportDeps): Promise<ImportOutcome> {
  if (deps.folder === null) return { imported: false, reason: 'no-folder' };

  const source = await deps.choose();
  if (source === null) return { imported: false, reason: 'cancelled' };

  const format = pandocFormatFor(path.basename(source));
  if (format === null) return { imported: false, reason: 'unsupported' };

  const binary = await deps.findPandoc();
  if (binary === null) return { imported: false, reason: 'no-pandoc' };

  let taken: Set<string>;
  try {
    taken = new Set(await readdir(deps.folder));
  } catch {
    return { imported: false, reason: 'failed' };
  }
  const name = importedFileName(path.basename(source), taken);
  const media = path.join(deps.folder, `${name.slice(0, -3)}.assets`);

  let markdown: string;
  try {
    markdown = await deps.run(binary, pandocArguments(source, format, media));
  } catch (cause) {
    return {
      imported: false,
      reason: 'failed',
      detail: cause instanceof Error ? cause.message.slice(0, 400) : undefined,
    };
  }

  const target = path.join(deps.folder, name);
  try {
    // The pictures folder is only made when pandoc actually put something in
    // it, so a document with no images does not leave an empty one behind.
    await mkdir(deps.folder, { recursive: true });
    await writeFile(target, ensureFinalNewline(markdown), { encoding: 'utf8', flag: 'wx' });
  } catch {
    return { imported: false, reason: 'failed' };
  }
  return { imported: true, path: target };
}

/** Every note this app writes ends with a newline; an import is no exception. */
function ensureFinalNewline(text: string): string {
  return text.endsWith('\n') ? text : `${text}\n`;
}

/** Run pandoc, capturing what it writes, with no shell anywhere in the path. */
export function runPandoc(binary: string, args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(binary, [...args], {
      encoding: 'utf8',
      // A converted document is text. Sixty-four megabytes of it is far past
      // anything real and short of anything that would trouble the process.
      maxBuffer: 64 * 1024 * 1024,
      timeout: 120_000,
    }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(String(stderr || error.message).trim().slice(0, 400)));
        return;
      }
      resolve(stdout);
    });
  });
}
