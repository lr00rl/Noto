/**
 * The last few documents, along the bottom.
 *
 * This replaces the tab bar. Tabs were a row of chrome across the top of every
 * screen, they were the loudest thing in the window, and they were being asked
 * to do a job nobody wanted them to do: managing a set of open documents. What
 * is actually wanted is a way back to the note you were just in.
 *
 * So it keeps four, it sits in the status bar where a hint belongs, and it has
 * no close buttons, no drag, no overflow menu and no order to maintain. The
 * documents themselves are still open behind it, and closing one is still
 * `Cmd+W`; this is a signpost, not a manager.
 *
 * Four because it is the number you can take in without reading. Past that it
 * becomes a list, and a list of documents is the file tree, which is already
 * two feet to the left.
 */

import type { WorkspaceTabV1 } from '../shared/workspace/v1/contracts';

/** How many are worth showing before this stops being a glance. */
export const RECENT_SHOWN = 4;

export interface RecentStripProps {
  readonly tabs: readonly WorkspaceTabV1[];
  readonly dirty: ReadonlySet<string>;
  readonly onActivate: (path: string) => void;
}

/**
 * The most recent few, which is what this is for and was not what it did.
 *
 * `tabs` arrives in the order the documents were opened, because that is the
 * order a neighbour is chosen from when one is closed. Taking the first four of
 * that showed the four oldest: with more than four open, the note you were just
 * in was the one thing missing from the way back to it.
 *
 * The one in front stays in the list, marked. It is where the reader is, and a
 * signpost that leaves out the place you are standing is harder to read, not
 * easier.
 */
export function recentlyActive(tabs: readonly WorkspaceTabV1[]): WorkspaceTabV1[] {
  return [...tabs]
    .sort((left, right) => right.activatedAt - left.activatedAt)
    .slice(0, RECENT_SHOWN);
}

export function RecentStrip({ tabs, dirty, onActivate }: RecentStripProps) {
  // Nothing to jump back to with one document, and the title bar already names
  // it, so the strip stays out of the way entirely.
  if (tabs.length < 2) return null;

  const shown = recentlyActive(tabs);

  return (
    <div className="recent-strip" data-testid="recent-strip">
      {shown.map((tab) => (
        <button
          key={tab.path}
          type="button"
          className={tab.active ? 'recent-chip is-current' : 'recent-chip'}
          data-testid="recent-chip"
          data-path={tab.path}
          aria-current={tab.active ? 'true' : undefined}
          title={tab.path}
          onClick={() => onActivate(tab.path)}
        >
          {dirty.has(tab.documentId) && (
            <span className="recent-dot" aria-label="Unsaved changes" role="img" />
          )}
          <span className="recent-chip-name">{tab.name.replace(/\.md$/i, '')}</span>
        </button>
      ))}
    </div>
  );
}
