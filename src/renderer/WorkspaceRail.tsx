/**
 * The navigation rail.
 *
 * One region holding two views rather than two panels. Files and Outline used to
 * open as separate columns, so asking for both spent 470 pixels of a 1280 pixel
 * window on navigation and pushed the document twice. They answer the same
 * question, "where do I go next", so they share one region and take turns.
 *
 * The rail owns the region and its header; the tree and the outline own only
 * their bodies.
 */

import type { ReactNode } from 'react';
import { FileTree, type FileTreeProps } from './FileTree';
import type { OutlineEntry } from './outline';

export type RailView = 'files' | 'outline';

export interface WorkspaceRailProps {
  readonly view: RailView;
  readonly onView: (view: RailView) => void;
  readonly outline: readonly OutlineEntry[];
  readonly onGoToBlock: (blockIndex: number) => void;
  readonly tree: FileTreeProps;
}

function Tab({ id, current, onSelect, children, testId }: {
  id: RailView;
  current: RailView;
  onSelect: (view: RailView) => void;
  children: ReactNode;
  testId: string;
}) {
  const selected = current === id;
  return (
    <button
      type="button"
      role="tab"
      id={`rail-tab-${id}`}
      aria-selected={selected}
      aria-controls={`rail-view-${id}`}
      data-testid={testId}
      className={selected ? 'rail-tab is-current' : 'rail-tab'}
      onClick={() => onSelect(id)}
    >
      {children}
    </button>
  );
}

export function WorkspaceRail({ view, onView, outline, onGoToBlock, tree }: WorkspaceRailProps) {
  return (
    <aside className="workspace-rail" aria-label="Navigation">
      <div className="rail-tabs" role="tablist" aria-label="Rail view">
        <Tab id="files" current={view} onSelect={onView} testId="rail-files">Files</Tab>
        <Tab id="outline" current={view} onSelect={onView} testId="outline-toggle">Outline</Tab>
      </div>

      {view === 'files'
        ? (
          <div className="rail-view" id="rail-view-files" role="tabpanel" aria-labelledby="rail-tab-files">
            <FileTree {...tree} />
          </div>
        )
        : (
          <div className="rail-view" id="rail-view-outline" role="tabpanel" aria-labelledby="rail-tab-outline"
            data-testid="outline-panel">
            {outline.length === 0
              ? <p className="rail-empty">This document has no headings.</p>
              : (
                <nav className="outline-body">
                  {outline.map((entry) => (
                    <button
                      key={entry.blockIndex}
                      type="button"
                      className={`outline-entry depth-${entry.depth}`}
                      onClick={() => onGoToBlock(entry.blockIndex)}
                    >
                      {entry.text}
                    </button>
                  ))}
                </nav>
              )}
          </div>
        )}
    </aside>
  );
}
