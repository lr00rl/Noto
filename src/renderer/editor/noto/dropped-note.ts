/**
 * A note dropped onto the editor is a note to open, as it is in Typora.
 *
 * A picture dropped in is put into the note; a markdown file dropped in is
 * not content, it is a document, and what the reader means by dragging it
 * from the Finder onto the editor is "open this". The first such file in
 * the drop is the one opened.
 */

const NOTE_EXTENSIONS = /\.(?:md|markdown|mdown|mkd|txt)$/i;

export function droppedNote(files: ArrayLike<File> | null | undefined): File | null {
  if (!files) return null;
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    if (NOTE_EXTENSIONS.test(file.name)) return file;
  }
  return null;
}
