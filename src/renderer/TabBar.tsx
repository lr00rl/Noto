/**
 * The open document tabs.
 *
 * Shown only when more than one document is open. A single tab would be a row
 * of chrome that says nothing the window title does not already say, and it
 * would cost the document a line of height on every screen.
 */

import type { WorkspaceTabV1 } from '../shared/workspace/v1/contracts';

export interface TabBarProps {
  readonly tabs: readonly WorkspaceTabV1[];
  /** Document ids with unsaved changes, so a tab can warn before it is closed. */
  readonly dirty: ReadonlySet<string>;
  readonly onActivate: (path: string) => void;
  readonly onClose: (path: string) => void;
}

export function TabBar({ tabs, dirty, onActivate, onClose }: TabBarProps) {
  if (tabs.length < 2) return null;

  return (
    <div className="tab-bar" role="tablist" aria-label="Open documents" data-testid="tab-bar">
      {tabs.map((tab) => {
        const isDirty = dirty.has(tab.documentId);
        return (
          <div
            key={tab.path}
            className={tab.active ? 'tab tab-active' : 'tab'}
            data-testid="tab"
            data-path={tab.path}
          >
            <button
              type="button"
              className="tab-label"
              role="tab"
              aria-selected={tab.active}
              title={tab.path}
              onClick={() => onActivate(tab.path)}
              // Middle click closes, which is the convention everywhere else.
              onAuxClick={(event) => { if (event.button === 1) onClose(tab.path); }}
            >
              {tab.name}
            </button>
            <button
              type="button"
              className="tab-close"
              data-testid="tab-close"
              aria-label={isDirty ? `Close ${tab.name}, unsaved changes` : `Close ${tab.name}`}
              title={isDirty ? 'Unsaved changes' : 'Close'}
              onClick={() => onClose(tab.path)}
            >
              {/* The dot doubles as the close target, as in most editors: it
                  marks unsaved work and turns into a cross on hover. */}
              <span className={isDirty ? 'tab-dot tab-dot-dirty' : 'tab-dot'} aria-hidden="true" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
