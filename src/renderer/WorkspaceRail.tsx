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

import { useCallback, useRef, type CSSProperties, type ReactNode } from 'react';
import { FileTree, type FileTreeProps } from './FileTree';
import { nestOutline, type OutlineEntry, type OutlineNode } from './outline';
import { SETTING_RANGES } from '../shared/settings/v1/contracts';

export type RailView = 'files' | 'outline';

const RAIL_MIN = SETTING_RANGES.railWidth.min;
const RAIL_MAX = SETTING_RANGES.railWidth.max;

export interface WorkspaceRailProps {
  readonly view: RailView;
  readonly onView: (view: RailView) => void;
  readonly width: number;
  /** Called once when the drag ends, not per pointer move: the width follows
   *  the pointer through a CSS variable, and only the result is persisted. */
  readonly onResize: (width: number) => void;
  readonly outline: readonly OutlineEntry[];
  readonly onGoToBlock: (blockIndex: number) => void;
  readonly tree: FileTreeProps;
  /** Opens quick open. Search is a first-class way into a vault, not a fallback. */
  readonly onSearch: () => void;
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
            title={node.text}
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

export function WorkspaceRail({
  view, onView, width, onResize, outline, onGoToBlock, tree, onSearch,
}: WorkspaceRailProps) {
  const railRef = useRef<HTMLElement>(null);

  /**
   * Drag the rail wider.
   *
   * The width is written straight to the element as a custom property while the
   * pointer moves, and the setting is written once on release. Routing every
   * move through React state and IPC would put a settings round trip between
   * the pointer and the edge it is dragging, which is exactly the lag that
   * makes a resize feel broken.
   */
  const startResize = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const rail = railRef.current;
    if (!rail) return;
    const handle = event.currentTarget;
    const startX = event.clientX;
    const startWidth = rail.getBoundingClientRect().width;
    let latest = startWidth;
    handle.setPointerCapture(event.pointerId);

    const move = (moveEvent: PointerEvent) => {
      latest = Math.min(RAIL_MAX, Math.max(RAIL_MIN, startWidth + moveEvent.clientX - startX));
      rail.style.setProperty('--rail-width', `${Math.round(latest)}px`);
    };
    const finish = () => {
      handle.releasePointerCapture(event.pointerId);
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', finish);
      handle.removeEventListener('pointercancel', finish);
      onResize(Math.round(latest));
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', finish);
    handle.addEventListener('pointercancel', finish);
  }, [onResize]);

  /** The keyboard path, because a drag handle that only takes a pointer is
   *  a control some people simply do not have. */
  const nudge = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 32 : 8;
    if (event.key === 'ArrowLeft') { event.preventDefault(); onResize(Math.max(RAIL_MIN, width - step)); }
    if (event.key === 'ArrowRight') { event.preventDefault(); onResize(Math.min(RAIL_MAX, width + step)); }
  }, [onResize, width]);

  return (
    <aside ref={railRef} className="workspace-rail" aria-label="Navigation"
      style={{ '--rail-width': `${width}px` } as CSSProperties}>
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
        <button type="button" className="icon-button rail-search" data-testid="rail-search"
          aria-label="Quick open" title="Quick open (⌘P)" onClick={onSearch}>
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="7" cy="7" r="4.25" />
            <path d="m10.25 10.25 3.5 3.5" />
          </svg>
        </button>
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


      <div
        className="rail-resize"
        role="separator"
        aria-orientation="vertical"
        aria-label="Rail width"
        aria-valuenow={width}
        aria-valuemin={RAIL_MIN}
        aria-valuemax={RAIL_MAX}
        tabIndex={0}
        data-testid="rail-resize"
        onPointerDown={startResize}
        onKeyDown={nudge}
      />
    </aside>
  );
}
