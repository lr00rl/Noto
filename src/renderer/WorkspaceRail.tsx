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

import type { CSSProperties, ReactNode } from 'react';
import { FileTree, type FileTreeProps } from './FileTree';
import { nestOutline, type OutlineEntry, type OutlineNode } from './outline';

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

/**
 * One level of the outline.
 *
 * Same structure as the file tree, for the same reason: the connector lines are
 * drawn from the nesting, and `:last-child` is what turns a tee into a rounded
 * corner. Sharing the `tree-level` and `tree-node` classes is deliberate, so the
 * two trees in the rail cannot drift into looking like different products.
 */
function OutlineLevel({ nodes, root, onGoToBlock }: {
  nodes: readonly OutlineNode[];
  root?: boolean;
  onGoToBlock: (blockIndex: number) => void;
}) {
  return (
    <div className={root ? 'tree-level is-root' : 'tree-level'}>
      {nodes.map((node) => (
        <div className="tree-node" key={node.blockIndex}>
          <button
            type="button"
            className={`tree-row outline-entry depth-${node.depth}`}
            onClick={() => onGoToBlock(node.blockIndex)}
          >
            <span className="tree-name">{node.text}</span>
          </button>
          {node.children.length > 0 && (
            <OutlineLevel nodes={node.children} onGoToBlock={onGoToBlock} />
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * Where the sliding rule sits, as a custom property rather than a measurement.
 *
 * The two labels are a known width apart, so their positions are arithmetic on
 * the text length rather than something to read back from the DOM after paint.
 * Measuring would mean a layout read on every switch and a frame at the wrong
 * position on the first one.
 */
const INDICATOR: Record<RailView, { left: string; width: string }> = {
  files: { left: '0px', width: '30px' },
  outline: { left: '44px', width: '46px' },
};

export function WorkspaceRail({ view, onView, outline, onGoToBlock, tree }: WorkspaceRailProps) {
  return (
    <aside className="workspace-rail" aria-label="Navigation">
      <div
        className="rail-tabs"
        role="tablist"
        aria-label="Rail view"
        style={{
          '--rail-indicator-left': INDICATOR[view].left,
          '--rail-indicator-width': INDICATOR[view].width,
        } as CSSProperties}
      >
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
                  <OutlineLevel nodes={nestOutline(outline)} root onGoToBlock={onGoToBlock} />
                </nav>
              )}
          </div>
        )}
    </aside>
  );
}
