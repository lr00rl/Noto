/**
 * The part of a path worth showing beside a name the row already states.
 *
 * A vault's paths share long prefixes. Truncating at the end, which is what a
 * plain ellipsis does, leaves every result in a folder reading identically:
 * ten rows of the same forty characters followed by a full stop. What tells
 * two results apart is the folder the note is in, so the filename goes (the
 * row's first line is the filename) and the deepest folders are what survive.
 */
export function pathContext(relativePath: string, segments = 2): string {
  const parts = relativePath.split(/[\\/]/).filter((part) => part.length > 0);
  // The last part is the file itself, which the row already names.
  parts.pop();
  if (parts.length === 0) return '';
  if (parts.length <= segments) return parts.join('/');
  return `…/${parts.slice(-segments).join('/')}`;
}
