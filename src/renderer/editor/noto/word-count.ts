/**
 * How many words a note holds.
 *
 * Counted from the text the document draws, never from the file. A note whose
 * bytes are mostly image addresses is a short note, and Typora agrees: on one
 * of the author's own notes it reports 112 where the raw markdown counts 144,
 * the difference being URLs nobody reads.
 *
 * Two scripts, two rules, which is the convention every editor that handles
 * Chinese uses. A run of letters and digits is one word, so `don't` and
 * `mcp__claude_api` each count once. A Han character, a kana or a Hangul
 * syllable is one word on its own, because Chinese and Japanese do not put
 * spaces between words and counting runs would report one word per sentence.
 *
 * This does not match Typora exactly and is not meant to. On one of the
 * author's notes Typora reports 112 where this reports 84. The note holds 81
 * Han characters, three hyphenated Latin words and fifteen pieces of Chinese
 * punctuation; Typora appears to be counting the punctuation, and a full stop
 * is not a word. The convention here is the one a writer means.
 *
 * Pure, so the rule can be tested against real notes rather than argued about.
 */

/** Letters, digits and the marks that live inside a word. */
const WORD_RUN = /[\p{Letter}\p{Number}\p{Mark}](?:[\p{Letter}\p{Number}\p{Mark}'’_-]*[\p{Letter}\p{Number}\p{Mark}])?/gu;

/**
 * The scripts counted one character at a time.
 *
 * Han, the two kana, Hangul, and the CJK extensions that hold the rarer
 * characters the author's notes actually use.
 */
const PER_CHARACTER = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

export interface DocumentCount {
  readonly words: number;
  /** Every character the document draws, spaces included. */
  readonly characters: number;
  /** The same without spaces and line breaks, which is how a Chinese word count is usually asked for. */
  readonly charactersNoSpaces: number;
  /** Lines of text, as the document draws them; a blank line between blocks is not one. */
  readonly lines: number;
  /** Top-level blocks: paragraphs, headings, lists and the rest, each once. */
  readonly blocks: number;
}

export function countWords(text: string, blocks = 0): DocumentCount {
  let words = 0;
  WORD_RUN.lastIndex = 0;
  for (const match of text.matchAll(WORD_RUN)) {
    const run = match[0];
    // A run may mix scripts, so each character decides for itself and what is
    // left of the run counts once.
    let perCharacter = 0;
    let latin = false;
    for (const character of run) {
      if (PER_CHARACTER.test(character)) perCharacter += 1;
      else latin = true;
    }
    words += perCharacter + (latin ? 1 : 0);
  }
  const characters = [...text].length;
  let spaces = 0;
  let lines = 0;
  let onLine = false;
  for (const character of text) {
    if (character === '\n') { if (onLine) lines += 1; onLine = false; spaces += 1; continue; }
    if (/\s/u.test(character)) spaces += 1;
    else onLine = true;
  }
  if (onLine) lines += 1;
  return { words, characters, charactersNoSpaces: characters - spaces, lines, blocks };
}
