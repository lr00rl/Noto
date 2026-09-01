/**
 * The workspace folder sidebar.
 *
 * Children are fetched when a folder is expanded rather than up front, because
 * a notes folder can hold thousands of files and reading all of them to draw a
 * tree nobody has opened would stall the first paint.
 *
 * Expansion state lives here rather than in main. Which folders a user has
 * twirled open is a view detail, and keeping it local means expanding does not
 * cost a round trip once the children have been read.
 */

import { useCallback, useEffect, useState } from 'react';
import type { WorkspaceEntryV1 } from '../shared/workspace/v1/contracts';

export interface FileTreeProps {
  readonly root: string | null;
  readonly rootName: string | null;
  /** Path of the document in front, so the tree can show where you are. */
  readonly activePath: string | null;
  readonly list: (directory: string) => Promise<readonly WorkspaceEntryV1[]>;
  readonly onOpenFile: (filePath: string) => void;
  readonly onChooseFolder: () => void;
}

export function FileTree({ root, rootName, activePath, list, onOpenFile, onChooseFolder }: FileTreeProps) {
  const [children, setChildren] = useState<ReadonlyMap<string, readonly WorkspaceEntryV1[]>>(new Map());
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [failed, setFailed] = useState<string | null>(null);

  const load = useCallback(async (directory: string) => {
    try {
      const entries = await list(directory);
      setChildren((current) => new Map(current).set(directory, entries));
      setFailed(null);
    } catch {
      setFailed('That folder could not be read.');
    }
  }, [list]);

  // A new root replaces everything, so stale children from the previous folder
  // can never be shown under it.
  useEffect(() => {
    setChildren(new Map());
    setExpanded(new Set());
    setFailed(null);
    if (root) void load(root);
  }, [root, load]);

  if (!root) {
    return (
      <aside className="workspace-sidebar" data-testid="file-tree" aria-label="Workspace">
        <span className="aside-heading">Workspace</span>
        <p className="tree-empty">No folder open.</p>
        <button type="button" className="tree-choose" data-testid="choose-folder"
          onClick={onChooseFolder}>Open a folder…</button>
      </aside>
    );
  }

  const toggle = (directory: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(directory)) {
        next.delete(directory);
      } else {
        next.add(directory);
        if (!children.has(directory)) void load(directory);
      }
      return next;
    });
  };

  const renderLevel = (directory: string, depth: number) => {
    const entries = children.get(directory);
    if (!entries) return <p className="tree-loading" style={{ paddingLeft: depth * 12 }}>Reading…</p>;
    if (entries.length === 0) {
      return <p className="tree-empty" style={{ paddingLeft: depth * 12 }}>Nothing here.</p>;
    }

    return entries.map((entry) => {
      if (entry.kind === 'directory') {
        const isOpen = expanded.has(entry.path);
        return (
          <div key={entry.path}>
            <button
              type="button"
              className="tree-row tree-directory"
              data-testid="tree-directory"
              style={{ paddingLeft: 6 + depth * 12 }}
              aria-expanded={isOpen}
              onClick={() => toggle(entry.path)}
            >
              <span className={isOpen ? 'tree-twisty tree-twisty-open' : 'tree-twisty'} aria-hidden="true" />
              {entry.name}
            </button>
            {isOpen && renderLevel(entry.path, depth + 1)}
          </div>
        );
      }

      const isActive = entry.path === activePath;
      return (
        <button
          key={entry.path}
          type="button"
          className={isActive ? 'tree-row tree-file tree-file-active' : 'tree-row tree-file'}
          data-testid="tree-file"
          data-path={entry.path}
          style={{ paddingLeft: 6 + depth * 12 }}
          aria-current={isActive ? 'true' : undefined}
          onClick={() => onOpenFile(entry.path)}
        >
          {entry.name}
        </button>
      );
    });
  };

  return (
    <aside className="workspace-sidebar" data-testid="file-tree" aria-label="Workspace">
      <div className="tree-header">
        <span className="aside-heading" title={root}>{rootName ?? 'Workspace'}</span>
        <button type="button" className="tree-change" data-testid="choose-folder"
          title="Open a different folder" onClick={onChooseFolder}>Change</button>
      </div>
      {failed && <p role="alert" className="tree-error">{failed}</p>}
      <nav className="tree-body">{renderLevel(root, 0)}</nav>
    </aside>
  );
}
