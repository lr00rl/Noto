/**
 * Lining a table's source up into columns.
 *
 * Not what the serializer does by default, and deliberately so: two thirds of
 * the author's 43,076 table rows are written unpadded, and reformatting a table
 * nobody asked about is exactly what this editor promises not to do. This runs
 * only when the reader asks for it, from Prettify Table.
 *
 * Width is measured as the terminal measures it, not by counting characters. A
 * Chinese character occupies two columns in every monospaced font, so padding a
 * table of Chinese by character count produces a source file that is more
 * ragged than the one it started from, which for this vault is the common case
 * rather than the exotic one.
 */

/**
 * How many columns a string occupies in a monospaced font.
 *
 * The wide ranges are the East Asian Wide and Fullwidth sets: the CJK
 * ideographs, the kana, Hangul, and the fullwidth punctuation that comes with
 * them. Combining marks take no width of their own.
 */
export function displayWidth(value: string): number {
  let width = 0;
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code >= 0x0300 && code <= 0x036f) continue;
    width += isWide(code) ? 2 : 1;
  }
  return width;
}

function isWide(code: number): boolean {
  return (code >= 0x1100 && code <= 0x115f)
    || (code >= 0x2e80 && code <= 0x303e)
    || (code >= 0x3041 && code <= 0x33ff)
    || (code >= 0x3400 && code <= 0x4dbf)
    || (code >= 0x4e00 && code <= 0x9fff)
    || (code >= 0xa000 && code <= 0xa4cf)
    || (code >= 0xac00 && code <= 0xd7a3)
    || (code >= 0xf900 && code <= 0xfaff)
    || (code >= 0xfe30 && code <= 0xfe6f)
    || (code >= 0xff00 && code <= 0xff60)
    || (code >= 0xffe0 && code <= 0xffe6)
    || (code >= 0x1f300 && code <= 0x1f64f)
    || (code >= 0x1f900 && code <= 0x1f9ff)
    || (code >= 0x20000 && code <= 0x3fffd);
}

/** The cells of one row, with the outer pipes dropped. */
function splitRow(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let escaped = false;
  let inCode = false;
  for (const character of line.trim().replace(/^\|/, '').replace(/\|$/, '')) {
    if (escaped) { current += character; escaped = false; continue; }
    if (character === '\\') { current += character; escaped = true; continue; }
    if (character === '`') { inCode = !inCode; current += character; continue; }
    // A pipe inside a code span or behind a backslash is content, not a
    // boundary, which is how a table row can hold `a | b` at all.
    if (character === '|' && !inCode) { cells.push(current); current = ''; continue; }
    current += character;
  }
  cells.push(current);
  return cells.map((cell) => cell.trim());
}

const DELIMITER = /^:?-+:?$/;

type Alignment = 'left' | 'right' | 'center' | null;

function alignmentOf(cell: string): Alignment {
  const left = cell.startsWith(':');
  const right = cell.endsWith(':');
  if (left && right) return 'center';
  if (right) return 'right';
  if (left) return 'left';
  return null;
}

function pad(value: string, width: number, alignment: Alignment): string {
  const slack = Math.max(0, width - displayWidth(value));
  if (alignment === 'right') return `${' '.repeat(slack)}${value}`;
  if (alignment === 'center') {
    const left = Math.floor(slack / 2);
    return `${' '.repeat(left)}${value}${' '.repeat(slack - left)}`;
  }
  return `${value}${' '.repeat(slack)}`;
}

function delimiterFor(width: number, alignment: Alignment): string {
  const left = alignment === 'left' || alignment === 'center' ? ':' : '';
  const right = alignment === 'right' || alignment === 'center' ? ':' : '';
  return `${left}${'-'.repeat(Math.max(3, width - left.length - right.length))}${right}`;
}

/**
 * The same table with every column padded to its widest cell.
 *
 * Returns the input unchanged when it is not a table, so the command that calls
 * this can be applied to anything without checking first.
 */
export function alignTableMarkdown(markdown: string): string {
  const lines = markdown.split('\n').filter((line) => line.trim().length > 0);
  if (lines.length < 2) return markdown;

  const rows = lines.map(splitRow);
  const delimiterRow = rows[1];
  if (delimiterRow.length === 0 || !delimiterRow.every((cell) => DELIMITER.test(cell))) return markdown;

  const columns = Math.max(...rows.map((row) => row.length));
  const alignments = Array.from({ length: columns }, (_, index) => alignmentOf(delimiterRow[index] ?? ''));

  const widths = Array.from({ length: columns }, (_, index) => {
    let widest = 3;
    rows.forEach((row, rowIndex) => {
      if (rowIndex === 1) return;
      widest = Math.max(widest, displayWidth(row[index] ?? ''));
    });
    // A delimiter needs room for its own colons before anything else.
    const marks = (alignments[index] === 'center' ? 2 : alignments[index] ? 1 : 0);
    return Math.max(widest, 3 + marks);
  });

  return rows.map((row, rowIndex) => {
    const cells = Array.from({ length: columns }, (_, index) => (rowIndex === 1
      ? delimiterFor(widths[index], alignments[index])
      : pad(row[index] ?? '', widths[index], null)));
    return `| ${cells.join(' | ')} |`;
  }).join('\n');
}
