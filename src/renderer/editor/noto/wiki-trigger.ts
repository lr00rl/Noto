/**
 * Typing `[[` asks which note you mean.
 *
 * This vault is held together by wiki links: its indexes are pages of
 * `[[path|title]]`, and writing one by hand means remembering the path of a
 * note among seven thousand. Quick open could already insert one, but only if
 * you knew the chord; the brackets are what a person actually types, so the
 * brackets are what should ask.
 *
 * The shape of the edit is fiddly enough to be worth doing here, away from
 * the editor: auto-pairing has usually left `[[]]` around the caret by the
 * time the second bracket lands, and the link has to replace all four
 * characters rather than being dropped between them.
 */

/** What to take out around the caret, so a chosen note can be put in its place. */
export interface TriggerRange {
  readonly from: number;
  readonly to: number;
}

/**
 * The range the link replaces, or null when the caret is not sitting after a
 * freshly typed `[[`.
 *
 * `before` is the text of the block up to the caret and `after` the text from
 * the caret on, both as the block holds them. Positions come back as offsets
 * from the caret, negative behind it and positive in front, so the caller can
 * map them without knowing anything about this.
 */
export function triggerRange(before: string, after: string): TriggerRange | null {
  if (!before.endsWith('[[')) return null;
  // The closing pair auto-pairing put there, if it is still there.
  const closing = after.startsWith(']]') ? 2 : 0;
  return { from: -2, to: closing };
}

/** The text a chosen note becomes: `[[target]]`, or `[[target|title]]`. */
export function wikiLinkText(target: string, title?: string): string {
  const shown = title?.trim() ?? '';
  return shown.length === 0 || shown === target ? `[[${target}]]` : `[[${target}|${shown}]]`;
}
