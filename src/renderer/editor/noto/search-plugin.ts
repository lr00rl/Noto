/**
 * Highlighting search matches, and moving between them.
 *
 * The matches live in plugin state rather than component state so they survive
 * transactions and stay in step with the document. Replacing goes through an
 * ordinary transaction, which means it is undoable and leaves the same
 * provenance trail as typing: a replaced block is dirty, every other block is
 * still pristine and still saves byte for byte identical.
 */

import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { findMatches, nextMatch, type SearchMatch, type SearchOptions } from './search';

export interface SearchState {
  readonly options: SearchOptions;
  readonly matches: readonly SearchMatch[];
  /** Index into `matches`, or -1 when there is nothing to go to. */
  readonly active: number;
}

export const searchKey = new PluginKey<SearchState>('noto-search');

const EMPTY: SearchState = {
  options: { query: '', caseSensitive: false, wholeWord: false, regex: false },
  matches: [],
  active: -1,
};

interface SetSearch {
  readonly options: SearchOptions;
  /** Keep the current match where possible, for typing in the query field. */
  readonly caret?: number;
}

const SET_SEARCH = 'noto-search-set';
const GO_TO = 'noto-search-goto';

export function setSearch(transaction: Transaction, payload: SetSearch): Transaction {
  return transaction.setMeta(SET_SEARCH, payload);
}

export function goToMatch(transaction: Transaction, direction: 'forward' | 'backward'): Transaction {
  return transaction.setMeta(GO_TO, direction);
}

export function getSearchState(state: EditorState): SearchState {
  return searchKey.getState(state) ?? EMPTY;
}

function recompute(state: EditorState, options: SearchOptions, caret: number): SearchState {
  const matches = findMatches(state.doc, options);
  return { options, matches, active: nextMatch(matches, caret, 'forward') };
}

export function searchPlugin(): Plugin<SearchState> {
  return new Plugin<SearchState>({
    key: searchKey,
    state: {
      init: () => EMPTY,
      apply: (transaction, previous, _oldState, newState) => {
        const set = transaction.getMeta(SET_SEARCH) as SetSearch | undefined;
        if (set) {
          return recompute(newState, set.options, set.caret ?? newState.selection.from);
        }

        const go = transaction.getMeta(GO_TO) as 'forward' | 'backward' | undefined;
        if (go && previous.matches.length > 0) {
          const current = previous.matches[previous.active];
          // Step from the current match rather than the caret, so repeated
          // presses walk the document instead of oscillating around it.
          const caret = go === 'forward'
            ? (current?.to ?? newState.selection.from)
            : (current?.from ?? newState.selection.from);
          return { ...previous, active: nextMatch(previous.matches, caret, go) };
        }

        if (!transaction.docChanged) return previous;
        if (previous.options.query.length === 0) return previous;
        // The document moved under the matches, so they have to be found again.
        return recompute(newState, previous.options, newState.selection.from);
      },
    },
    props: {
      decorations: (state) => {
        const search = getSearchState(state);
        if (search.matches.length === 0) return DecorationSet.empty;
        return DecorationSet.create(state.doc, search.matches.map((match, index) => Decoration.inline(
          match.from,
          match.to,
          { class: index === search.active ? 'noto-match noto-match-active' : 'noto-match' },
        )));
      },
    },
  });
}

/** Select the active match, so the next edit or replace lands on it. */
export function selectActiveMatch(state: EditorState, transaction: Transaction): Transaction {
  const search = getSearchState(state);
  const match = search.matches[search.active];
  if (!match) return transaction;
  return transaction
    .setSelection(TextSelection.create(transaction.doc, match.from, match.to))
    .scrollIntoView();
}

/**
 * Replace the active match.
 *
 * Returns null when there is nothing to replace, so the caller can tell the
 * difference between "done" and "no match" rather than reporting success either
 * way.
 */
export function replaceActive(state: EditorState, replacement: string): Transaction | null {
  const search = getSearchState(state);
  const match = search.matches[search.active];
  if (!match) return null;

  const transaction = replacement.length > 0
    ? state.tr.insertText(replacement, match.from, match.to)
    : state.tr.delete(match.from, match.to);
  return setSearch(transaction, { options: search.options, caret: match.from + replacement.length });
}

/**
 * Replace every match in one undoable step.
 *
 * Applied from the end backwards so that each replacement cannot disturb the
 * positions of the ones still to come.
 */
export function replaceAll(state: EditorState, replacement: string): Transaction | null {
  const search = getSearchState(state);
  if (search.matches.length === 0) return null;

  const transaction = state.tr;
  for (let index = search.matches.length - 1; index >= 0; index -= 1) {
    const match = search.matches[index];
    if (replacement.length > 0) transaction.insertText(replacement, match.from, match.to);
    else transaction.delete(match.from, match.to);
  }
  return setSearch(transaction, { options: search.options, caret: 0 });
}
