/**
 * The editor surface plugins are allowed to touch.
 *
 * Deliberately small. This is the whole plugin editor ABI, and everything added
 * here becomes a compatibility promise, so capabilities arrive one at a time
 * with an explicit contract rather than by handing plugins the editor.
 *
 * Plugins never receive the editor view, the document state, or the DOM. They
 * exchange markdown, which is the format they already reason about and the one
 * Noto can validate.
 *
 * Each method is gated by a manifest capability:
 *   getMarkdown        editor.read
 *   replaceMarkdown    editor.transform
 *   setSemanticFocus   editor.decorate
 */
export interface NotoEditorPort {
  /**
   * Dim everything except the block holding the caret.
   *
   * Presentation only: it adds no decoration to the document and changes no
   * bytes, so a plugin cannot alter the file through it.
   */
  setSemanticFocus(enabled: boolean): void;

  /** The whole document as markdown. */
  getMarkdown(): string;

  /**
   * Replace the document with new markdown as a single undoable step.
   *
   * The editor works out which blocks actually changed and leaves the rest
   * alone, so a transform that rewrites one line does not cost the file its
   * byte-for-byte fidelity everywhere else.
   *
   * Returns false when the markdown matches what the document already holds,
   * which lets a plugin report "no changes needed" honestly.
   */
  replaceMarkdown(markdown: string): boolean;
}
