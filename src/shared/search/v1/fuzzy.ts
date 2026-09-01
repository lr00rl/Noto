/**
 * Fuzzy matching and ranking for quick open.
 *
 * An fzf-shaped subsequence scorer: it rewards consecutive runs, word
 * boundaries, camelCase humps and an exact prefix, and lightly penalises a wide
 * match span and a long tail. Ported from the author's `fuzzy-search` Typora
 * plugin, whose weightings are the ones his muscle memory is tuned to.
 *
 * Pure, and deliberately in shared code rather than in main: ranking happens in
 * the renderer on every keystroke, and a round trip per character is the one
 * thing that would make a search box feel slow. Main sends the index once and
 * the renderer does the arithmetic.
 *
 * Matching is a code-unit subsequence over lowercased text, which is CJK safe
 * as it stands: Han characters are in the BMP and are unaffected by case
 * folding, so a query in Chinese matches the same way one in English does.
 */

/** Everything a candidate offers the scorer, all pre-lowercased. */
export interface ScoreKeys {
  /** The file's own name. */
  readonly nameKey: string;
  /** Its path relative to the workspace root. */
  readonly pathKey: string;
}

export interface ScoreOptions {
  /** The query looks like a path, so path matches should outrank name ones. */
  readonly pathQuery: boolean;
  /** Bounded lift from how often and how recently this file is opened. */
  readonly frecencyBoost: number;
}

/** Scored so that a miss is unmistakable rather than merely low. */
export const NO_MATCH = Number.NEGATIVE_INFINITY;

export function fuzzyScore(text: string, query: string): number {
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  if (lowerQuery.length === 0) return 0;

  const positions: number[] = [];
  let queryIndex = 0;
  for (let index = 0; index < lowerText.length && queryIndex < lowerQuery.length; index += 1) {
    if (lowerText[index] === lowerQuery[queryIndex]) {
      positions.push(index);
      queryIndex += 1;
    }
  }
  if (queryIndex < lowerQuery.length) return NO_MATCH;

  let score = 100;
  let previous = -2;
  let run = 0;

  for (const position of positions) {
    if (position === previous + 1) {
      run += 1;
      score += run * 6;
    } else {
      run = 0;
    }
    const before = position > 0 ? lowerText[position - 1] : '';
    if (position === 0 || /[\\/\-_.\s]/.test(before)) score += 10;
    // A camelCase hump: a capital following a lower case letter reads as the
    // start of a word even without a separator.
    if (position > 0
      && text[position] !== text[position].toLowerCase()
      && text[position - 1] === text[position - 1].toLowerCase()) {
      score += 8;
    }
    if (position === 0) score += 12;
    previous = position;
  }

  if (lowerText.startsWith(lowerQuery)) score += 20;

  const span = positions[positions.length - 1] - positions[0] + 1;
  score -= span * 0.4;
  score -= (lowerText.length - lowerQuery.length) * 0.1;
  return score;
}

/** Which characters of `text` the match consumed, for highlighting. */
export function matchPositions(text: string, query: string): number[] | null {
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase().trim();
  if (lowerQuery.length === 0) return [];

  const positions: number[] = [];
  let queryIndex = 0;
  for (let index = 0; index < lowerText.length && queryIndex < lowerQuery.length; index += 1) {
    if (lowerText[index] === lowerQuery[queryIndex]) {
      positions.push(index);
      queryIndex += 1;
    }
  }
  return queryIndex === lowerQuery.length ? positions : null;
}

/**
 * The best a candidate scores across the keys it offers.
 *
 * The name is worth more than the path, because people search for what a note
 * is called far more often than for where it lives. A query containing a slash
 * says otherwise about itself, and flips the weighting.
 */
export function scoreCandidate(keys: ScoreKeys, query: string, options: ScoreOptions): number {
  const name = fuzzyScore(keys.nameKey, query) + (options.pathQuery ? 6 : 25);
  const path = fuzzyScore(keys.pathKey, query) + (options.pathQuery ? 22 : 8);
  const best = Math.max(name, path);
  return best === NO_MATCH ? NO_MATCH : best + options.frecencyBoost;
}

/** A query is about location when it names one. */
export const isPathQuery = (query: string): boolean => query.includes('/');

/**
 * The top `limit` candidates, without sorting the rest.
 *
 * A bounded max-heap keyed on the *worst* kept entry, so a vault of several
 * thousand notes costs one scoring pass and a heap of ten, rather than a full
 * sort per keystroke. The comparison falls through to the path and then to
 * input order so the ranking is total: equal scores must not reorder between
 * keystrokes, or the list flickers under the fingers while you are aiming at it.
 */
export function rankCandidates<T extends ScoreKeys>(
  candidates: readonly T[],
  query: string,
  optionsFor: (candidate: T) => ScoreOptions,
  limit: number,
): T[] {
  const bounded = Math.max(0, Math.floor(limit));
  if (bounded === 0) return [];

  interface Ranked { candidate: T; score: number; index: number }
  const heap: Ranked[] = [];
  const worseFirst = (a: Ranked, b: Ranked): number => (
    b.score - a.score
    || a.candidate.pathKey.localeCompare(b.candidate.pathKey)
    || a.index - b.index
  );
  const swap = (left: number, right: number) => {
    const held = heap[left];
    heap[left] = heap[right];
    heap[right] = held;
  };

  const raise = (start: number) => {
    let index = start;
    while (index > 0) {
      const parent = (index - 1) >>> 1;
      if (worseFirst(heap[index], heap[parent]) <= 0) break;
      swap(index, parent);
      index = parent;
    }
  };
  const sink = () => {
    let index = 0;
    for (;;) {
      const left = index * 2 + 1;
      if (left >= heap.length) return;
      const right = left + 1;
      const worst = right < heap.length && worseFirst(heap[right], heap[left]) > 0 ? right : left;
      if (worseFirst(heap[worst], heap[index]) <= 0) return;
      swap(worst, index);
      index = worst;
    }
  };

  candidates.forEach((candidate, index) => {
    const score = scoreCandidate(candidate, query, optionsFor(candidate));
    if (score === NO_MATCH) return;
    const entry: Ranked = { candidate, score, index };
    if (heap.length < bounded) {
      heap.push(entry);
      raise(heap.length - 1);
      return;
    }
    if (worseFirst(entry, heap[0]) >= 0) return;
    heap[0] = entry;
    sink();
  });

  return heap.sort(worseFirst).map((entry) => entry.candidate);
}
