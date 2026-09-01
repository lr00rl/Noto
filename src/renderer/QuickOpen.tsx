/**
 * Quick open.
 *
 * One surface doing the job of two plugins from the author's Typora set:
 * `fuzzy-search` finds a note and opens it, `note-assistant` finds a note and
 * links to it. They are the same search with different endings, so they are one
 * palette here and the ending is a modifier: Enter opens, Alt+Enter inserts a
 * `[[wiki link]]` at the caret. Two palettes with two shortcuts and two result
 * lists would be two things to learn for one question, which is "which note".
 *
 * Ranking happens here rather than in main. Main sends the index once per
 * folder; every keystroke after that is arithmetic over an array already in
 * this process, so typing never waits on a round trip.
 *
 * An empty query is not an empty list. It shows what frecency says you are
 * most likely to want, which is what lets this stand in for navigating the tree
 * rather than being a thing you resort to when the tree fails.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { WorkspaceIndexEntryV1 } from '../shared/workspace/v1/contracts';
import {
  isPathQuery, matchPositions, rankCandidates, type ScoreKeys,
} from '../shared/search/v1/fuzzy';
import { searchBoost, type FrecencyStoreV1 } from '../shared/search/v1/frecency';

/** How many results are drawn. Beyond this nobody is reading, they are retyping. */
const LIMIT = 12;

interface Candidate extends ScoreKeys {
  readonly entry: WorkspaceIndexEntryV1;
}

export interface QuickOpenProps {
  readonly open: boolean;
  readonly entries: readonly WorkspaceIndexEntryV1[];
  readonly frecency: FrecencyStoreV1;
  readonly truncated: boolean;
  /** Null when no document is open, which is when linking makes no sense. */
  readonly canInsertLink: boolean;
  readonly onOpenFile: (path: string) => void;
  readonly onInsertLink: (entry: WorkspaceIndexEntryV1) => void;
  readonly onClose: () => void;
}

/** The name with the matched characters marked, so a fuzzy hit shows its work. */
function Highlighted({ text, query }: { text: string; query: string }) {
  const positions = useMemo(() => new Set(matchPositions(text, query) ?? []), [text, query]);
  if (positions.size === 0) return <>{text}</>;
  return (
    <>
      {[...text].map((character, index) => (
        positions.has(index)
          // eslint-disable-next-line react/no-array-index-key -- position is the identity here
          ? <mark key={index} className="quick-hit">{character}</mark>
          // eslint-disable-next-line react/no-array-index-key
          : <span key={index}>{character}</span>
      ))}
    </>
  );
}

export function QuickOpen({
  open, entries, frecency, truncated, canInsertLink, onOpenFile, onInsertLink, onClose,
}: QuickOpenProps) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setSelected(0);
    queueMicrotask(() => inputRef.current?.focus({ preventScroll: true }));
  }, [open]);

  const candidates = useMemo<Candidate[]>(() => entries.map((entry) => ({
    entry,
    nameKey: entry.name.toLowerCase(),
    pathKey: entry.relativePath.toLowerCase(),
  })), [entries]);

  const results = useMemo(() => {
    const now = Date.now();
    const trimmed = query.trim();
    if (trimmed.length === 0) {
      // No query, so nothing is being matched: order by history alone and take
      // the same number the ranked list would have shown.
      return [...candidates]
        .map((candidate) => ({
          candidate,
          score: searchBoost(frecency, candidate.entry.path, now),
        }))
        .filter((scored) => scored.score > 0)
        .sort((a, b) => b.score - a.score
          || a.candidate.pathKey.localeCompare(b.candidate.pathKey))
        .slice(0, LIMIT)
        .map((scored) => scored.candidate);
    }
    const pathQuery = isPathQuery(trimmed);
    return rankCandidates(
      candidates,
      trimmed,
      (candidate) => ({
        pathQuery,
        frecencyBoost: searchBoost(frecency, candidate.entry.path, now),
      }),
      LIMIT,
    );
  }, [candidates, frecency, query]);

  useEffect(() => { setSelected(0); }, [query]);

  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [selected, results]);

  const choose = useCallback((candidate: Candidate | undefined, asLink: boolean) => {
    if (!candidate) return;
    if (asLink && canInsertLink) onInsertLink(candidate.entry);
    else onOpenFile(candidate.entry.path);
    onClose();
  }, [canInsertLink, onClose, onInsertLink, onOpenFile]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') { event.preventDefault(); onClose(); return; }
    if (event.key === 'ArrowDown' || (event.ctrlKey && event.key === 'n')) {
      event.preventDefault();
      setSelected((current) => (results.length === 0 ? 0 : (current + 1) % results.length));
      return;
    }
    if (event.key === 'ArrowUp' || (event.ctrlKey && event.key === 'p')) {
      event.preventDefault();
      setSelected((current) => (results.length === 0
        ? 0
        : (current - 1 + results.length) % results.length));
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      choose(results[selected], event.altKey);
    }
  };

  if (!open) return null;

  return (
    <div className="quick-scrim" data-testid="quick-open-scrim" onClick={onClose}>
      <section
        className="quick-open"
        role="dialog"
        aria-modal="true"
        aria-label="Quick open"
        data-testid="quick-open"
        onClick={(event) => event.stopPropagation()}
      >
        <input
          ref={inputRef}
          type="text"
          className="quick-input"
          data-testid="quick-input"
          spellCheck={false}
          placeholder={entries.length === 0
            ? 'Open a folder to search it'
            : `Search ${entries.length} notes`}
          aria-label="Search notes"
          role="combobox"
          aria-expanded
          aria-controls="quick-open-results"
          aria-activedescendant={results[selected] ? `quick-result-${selected}` : undefined}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onKeyDown}
        />

        <div className="quick-results" id="quick-open-results" role="listbox" ref={listRef}>
          {results.length === 0
            ? (
              <p className="quick-empty">
                {entries.length === 0
                  ? 'No folder is open, so there is nothing to search yet.'
                  : query.trim().length === 0
                    ? 'Nothing opened yet. Type to search.'
                    : 'No note matches that.'}
              </p>
            )
            : results.map((candidate, index) => (
              <button
                key={candidate.entry.path}
                id={`quick-result-${index}`}
                type="button"
                role="option"
                aria-selected={index === selected}
                className={index === selected ? 'quick-result is-selected' : 'quick-result'}
                data-testid="quick-result"
                // Selecting on hover rather than on click, so the keyboard and
                // the pointer never disagree about which row is next.
                onMouseMove={() => setSelected(index)}
                onClick={(event) => choose(candidate, event.altKey)}
              >
                <span className="quick-name">
                  <Highlighted text={candidate.entry.name} query={query.trim()} />
                </span>
                <span className="quick-path">
                  <Highlighted text={candidate.entry.relativePath} query={query.trim()} />
                </span>
              </button>
            ))}
        </div>

        <footer className="quick-hints">
          <span><kbd>↩</kbd> open</span>
          {canInsertLink && <span><kbd>⌥↩</kbd> insert link</span>}
          <span><kbd>esc</kbd> close</span>
          {truncated && (
            <span className="quick-truncated">
              Index is partial: this folder is larger than the ceiling.
            </span>
          )}
        </footer>
      </section>
    </div>
  );
}
