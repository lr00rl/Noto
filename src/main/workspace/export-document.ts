/**
 * Taking a note out of the vault as something other than markdown.
 *
 * Two different jobs wearing one menu. The document formats, Word and the rest,
 * are a conversion of the markdown, and Pandoc does them from the file on disk:
 * the note is the source of truth and converting the source rather than the
 * screen keeps a heading a heading rather than a run of styled text. PDF and
 * HTML are the opposite: what they are for is the document as Noto draws it, so
 * they come from the renderer's own HTML and its own stylesheet.
 *
 * This file owns the first job and the naming for both. The decisions are pure
 * and tested; the one impure part is the same `execFile` the import uses, with
 * an argument array and no shell.
 */

import path from 'node:path';
import { EXPORT_KINDS, type WorkspaceExportKindV1 } from '../../shared/workspace/v1/contracts';

/** What the File menu offers, in the order Typora lists its own. */
export const EXPORT_TARGETS = EXPORT_KINDS;

/**
 * The same set the IPC carries, not a second list.
 *
 * They were two lists once, and `html-plain` was in one and not the other. The
 * cast that bridged them turned a missing entry into a crash at the moment of
 * export rather than a type error at the moment of writing, which is exactly
 * backwards.
 */
export type ExportTarget = WorkspaceExportKindV1;

interface TargetShape {
  /** What the menu calls it. */
  readonly label: string;
  /** The extension the file is given, without its dot. */
  readonly extension: string;
  /**
   * The Pandoc writer, or null when Noto renders it itself.
   *
   * PDF and HTML are rendered rather than converted because what they are for
   * is the document as it looks, which Pandoc has never seen.
   */
  readonly writer: string | null;
}

const TARGETS: Readonly<Record<ExportTarget, TargetShape>> = {
  pdf: { label: 'PDF', extension: 'pdf', writer: null },
  html: { label: 'HTML', extension: 'html', writer: null },
  'html-plain': { label: 'HTML without styles', extension: 'html', writer: null },
  docx: { label: 'Word (.docx)', extension: 'docx', writer: 'docx' },
  odt: { label: 'OpenDocument', extension: 'odt', writer: 'odt' },
  rtf: { label: 'RTF', extension: 'rtf', writer: 'rtf' },
  epub: { label: 'EPUB', extension: 'epub', writer: 'epub3' },
  latex: { label: 'LaTeX', extension: 'tex', writer: 'latex' },
  mediawiki: { label: 'MediaWiki', extension: 'wiki', writer: 'mediawiki' },
  rst: { label: 'reStructuredText', extension: 'rst', writer: 'rst' },
  textile: { label: 'Textile', extension: 'textile', writer: 'textile' },
  opml: { label: 'OPML', extension: 'opml', writer: 'opml' },
};

export const exportShape = (target: ExportTarget): TargetShape => TARGETS[target];

/** Whether Pandoc does this one, as opposed to Noto rendering it. */
export const needsPandoc = (target: ExportTarget): boolean => TARGETS[target].writer !== null;

/**
 * What the exported file is called, offered in the save dialog.
 *
 * The note's own name with a different extension, which is what every editor
 * suggests and what makes a folder of exports readable next to the notes.
 */
export function suggestedName(notePath: string, target: ExportTarget): string {
  const base = path.basename(notePath);
  const dot = base.lastIndexOf('.');
  const stem = dot > 0 ? base.slice(0, dot) : base;
  return `${stem}.${TARGETS[target].extension}`;
}

/**
 * The arguments Pandoc is run with.
 *
 * `--standalone` so the result is a document rather than a fragment, which for
 * every one of these formats is the only useful answer. `--resource-path` is
 * the note's own folder, so a relative picture reference resolves the way it
 * does in the note rather than against wherever the process happens to be.
 *
 * The filenames go behind the end-of-options marker, so a note called
 * `--version.md` is a note.
 */
export function exportArguments(
  source: string,
  destination: string,
  target: ExportTarget,
): string[] {
  const writer = TARGETS[target].writer;
  if (writer === null) throw new Error(`EXPORT_NOT_PANDOC:${target}`);
  return [
    '--from', 'gfm',
    '--to', writer,
    '--standalone',
    '--resource-path', path.dirname(source),
    '--output', destination,
    '--', source,
  ];
}

export type ExportRefusal = 'no-document' | 'unsaved' | 'cancelled' | 'no-pandoc' | 'failed';

export type ExportOutcome =
  | { readonly exported: true; readonly path: string }
  | { readonly exported: false; readonly reason: ExportRefusal; readonly detail?: string };

export interface ExportDeps {
  /** The note in front, on disk. Null when nothing is open. */
  readonly notePath: string | null;
  /** True when the note has changes that have not been written. */
  readonly dirty: boolean;
  /** Where to write it, or null when the reader dismissed the dialog. */
  readonly choose: (suggested: string) => Promise<string | null>;
  readonly findPandoc: () => Promise<string | null>;
  readonly run: (binary: string, args: readonly string[]) => Promise<string>;
}

/**
 * Export through Pandoc.
 *
 * Refused while the note has unsaved changes, because this converts the file
 * rather than the screen: exporting would quietly produce a document of the
 * last saved version while the reader was looking at a newer one, which is the
 * kind of wrong that is only noticed after it has been sent to somebody.
 */
export async function exportThroughPandoc(
  target: ExportTarget,
  deps: ExportDeps,
): Promise<ExportOutcome> {
  if (!deps.notePath) return { exported: false, reason: 'no-document' };
  if (deps.dirty) return { exported: false, reason: 'unsaved' };

  const destination = await deps.choose(suggestedName(deps.notePath, target));
  if (destination === null) return { exported: false, reason: 'cancelled' };

  const binary = await deps.findPandoc();
  if (binary === null) return { exported: false, reason: 'no-pandoc' };

  try {
    await deps.run(binary, exportArguments(deps.notePath, destination, target));
  } catch (cause) {
    return {
      exported: false,
      reason: 'failed',
      detail: cause instanceof Error ? cause.message.slice(0, 400) : undefined,
    };
  }
  return { exported: true, path: destination };
}
