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
import type {
  WorkspaceContentMatchV1, WorkspaceIndexEntryV1,
} from '../shared/workspace/v1/contracts';
import {
  contentDebounceMs, isPathQuery, matchPositions, rankCandidates, type ScoreKeys,
} from '../shared/search/v1/fuzzy';
import { searchBoost, type FrecencyStoreV1 } from '../shared/search/v1/frecency';
import { pathContext } from './quick-open-path';

/** How many results are drawn. Beyond this nobody is reading, they are retyping. */
const LIMIT = 12;

interface Candidate extends ScoreKeys {
  readonly entry: WorkspaceIndexEntryV1;
}

export type QuickOpenMode = 'name' | 'content';

export interface QuickOpenProps {
  readonly open: boolean;
  readonly mode: QuickOpenMode;
  readonly onMode: (mode: QuickOpenMode) => void;
  /** Runs a content search. Replies for superseded queries are dropped by the
   *  caller, so this only ever has to answer the last one asked. */
  readonly onSearchContent: (query: string) => Promise<{
    matches: readonly WorkspaceContentMatchV1[];
    truncated: boolean;
    timedOut: boolean;
  } | null>;
  /** Opens a note and puts the query's first match on screen. */
  readonly onOpenMatch: (path: string, query: string) => void;
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
  open, mode, onMode, onSearchContent, onOpenMatch,
  entries, frecency, truncated, canInsertLink, onOpenFile, onInsertLink, onClose,
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

  const [content, setContent] = useState<{
    matches: readonly WorkspaceContentMatchV1[]; truncated: boolean; timedOut: boolean;
  }>({ matches: [], truncated: false, timedOut: false });
  const [searching, setSearching] = useState(false);

  /*
   * The scan is debounced and superseded.
   *
   * A reply for a query the reader has already typed past is worse than no
   * reply: it replaces what they are looking at with an answer to a question
   * they have moved on from. The effect's own cleanup marks the request stale,
   * so only the last one asked is ever shown.
   */
  useEffect(() => {
    if (!open || mode !== 'content') return;
    const trimmed = query.trim();
    if (trimmed.length === 0) {
      setContent({ matches: [], truncated: false, timedOut: false });
      setSearching(false);
      return;
    }
    let current = true;
    setSearching(true);
    const timer = setTimeout(() => {
      void onSearchContent(trimmed).then((reply) => {
        if (!current) return;
        setSearching(false);
        if (reply) setContent(reply);
      });
    }, contentDebounceMs(trimmed));
    return () => { current = false; clearTimeout(timer); };
  }, [open, mode, query, onSearchContent]);

  useEffect(() => { setSelected(0); }, [mode]);

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

  const chooseMatch = useCallback((match: WorkspaceContentMatchV1 | undefined) => {
    if (!match) return;
    onOpenMatch(match.path, query.trim());
    onClose();
  }, [onClose, onOpenMatch, query]);

  const rowCount = mode === 'content' ? content.matches.length : results.length;

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') { event.preventDefault(); onClose(); return; }
    // Tab switches what is being searched without leaving the box, which is
    // where the thought "it is in a note, I just cannot remember which" turns
    // into "search inside them then".
    if (event.key === 'Tab') {
      event.preventDefault();
      onMode(mode === 'name' ? 'content' : 'name');
      return;
    }
    if (event.key === 'ArrowDown' || (event.ctrlKey && event.key === 'n')) {
      event.preventDefault();
      setSelected((current) => (rowCount === 0 ? 0 : (current + 1) % rowCount));
      return;
    }
    if (event.key === 'ArrowUp' || (event.ctrlKey && event.key === 'p')) {
      event.preventDefault();
      setSelected((current) => (rowCount === 0 ? 0 : (current - 1 + rowCount) % rowCount));
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (mode === 'content') chooseMatch(content.matches[selected]);
      else choose(results[selected], event.altKey);
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
        <div className="quick-input-row">
        <button
          type="button"
          className="quick-mode"
          data-testid="quick-mode"
          aria-label={mode === 'name' ? 'Searching names. Switch to searching inside notes' : 'Searching inside notes. Switch to searching names'}
          title="Tab"
          onClick={() => onMode(mode === 'name' ? 'content' : 'name')}
        >
          {mode === 'name' ? 'Names' : 'In notes'}
        </button>
        <input
          ref={inputRef}
          type="text"
          className="quick-input"
          data-testid="quick-input"
          spellCheck={false}
          placeholder={entries.length === 0
            ? 'Open a folder to search it'
            : mode === 'content'
              ? `Search inside ${entries.length} notes`
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
        </div>

        <div className="quick-results" id="quick-open-results" role="listbox" ref={listRef}>
          {mode === 'content' ? (
            content.matches.length === 0
              ? (
                <p className="quick-empty">
                  {query.trim().length === 0
                    ? 'Type to search inside every note in this folder.'
                    : searching
                      ? 'Searching…'
                      : content.timedOut
                        ? 'That search took too long. Try a longer query.'
                        : 'No note contains that.'}
                </p>
              )
              : content.matches.map((match, index) => (
                <button
                  key={match.path}
                  id={`quick-result-${index}`}
                  type="button"
                  role="option"
                  aria-selected={index === selected}
                  className={index === selected ? 'quick-result is-selected' : 'quick-result'}
                  data-testid="quick-match"
                  title={match.relativePath}
                  onMouseMove={() => setSelected(index)}
                  onClick={() => chooseMatch(match)}
                >
                  <span className="quick-name">
                    {match.name}
                    <span className="quick-count">{match.occurrences}</span>
                  </span>
                  {match.lines.map((line) => (
                    <span className="quick-line" key={line.lineNumber}>
                      <span className="quick-line-number">{line.lineNumber}</span>
                      <span className="quick-line-text">
                        {line.line.slice(0, line.column)}
                        <mark className="quick-hit">
                          {line.line.slice(line.column, line.column + query.trim().length)}
                        </mark>
                        {line.line.slice(line.column + query.trim().length)}
                      </span>
                    </span>
                  ))}
                  <span className="quick-path">{pathContext(match.relativePath)}</span>
                </button>
              ))
          ) : results.length === 0
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
                title={candidate.entry.relativePath}
                // Selecting on hover rather than on click, so the keyboard and
                // the pointer never disagree about which row is next.
                onMouseMove={() => setSelected(index)}
                onClick={(event) => choose(candidate, event.altKey)}
              >
                <span className="quick-name">
                  <Highlighted text={candidate.entry.name} query={query.trim()} />
                </span>
                <span className="quick-path">
                  <Highlighted text={pathContext(candidate.entry.relativePath)} query={query.trim()} />
                </span>
              </button>
            ))}
        </div>

        <footer className="quick-hints">
          <span><kbd>↩</kbd> open</span>
          {mode === 'name' && canInsertLink && <span><kbd>⌥↩</kbd> insert link</span>}
          <span><kbd>tab</kbd> {mode === 'name' ? 'search in notes' : 'search names'}</span>
          <span><kbd>esc</kbd> close</span>
          {mode === 'content' && content.truncated && (
            <span className="quick-truncated">Showing the first {content.matches.length}.</span>
          )}
          {mode === 'name' && truncated && (
            <span className="quick-truncated">
              Index is partial: this folder is larger than the ceiling.
            </span>
          )}
        </footer>
      </section>
    </div>
  );
}
