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

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
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

/** The height of one row, which the sticky offsets are multiples of. */
export const TREE_ROW_HEIGHT = 32;

export function FileTree({ root, rootName, activePath, list, onOpenFile, onChooseFolder }: FileTreeProps) {
  const [children, setChildren] = useState<ReadonlyMap<string, readonly WorkspaceEntryV1[]>>(new Map());
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [failed, setFailed] = useState<string | null>(null);
  const bodyRef = useRef<HTMLElement>(null);

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
    childrenRef.current = new Map();
    if (root) void load(root);
  }, [root, load]);

  /*
   * The tree opens to the current file. A note opened from the command line,
   * from quick open or through a link is otherwise somewhere under a closed
   * folder, and a branch cannot light up to a row that is not there. Each
   * folder between the root and the file is expanded and loaded. A folder the
   * reader closes afterwards stays closed: this runs when the file changes,
   * not when the tree does.
   */
  const childrenRef = useRef(children);
  childrenRef.current = children;
  useEffect(() => {
    if (!root || !activePath) return;
    const separator = root.includes('\\') ? '\\' : '/';
    const prefix = root.endsWith(separator) ? root : `${root}${separator}`;
    if (!activePath.startsWith(prefix)) return;
    const ancestors: string[] = [];
    for (let index = activePath.indexOf(separator, prefix.length); index !== -1; index = activePath.indexOf(separator, index + 1)) {
      ancestors.push(activePath.slice(0, index));
    }
    if (ancestors.length === 0) return;
    setExpanded((current) => {
      if (ancestors.every((directory) => current.has(directory))) return current;
      const next = new Set(current);
      for (const directory of ancestors) next.add(directory);
      return next;
    });
    for (const directory of ancestors) {
      if (!childrenRef.current.has(directory)) void load(directory);
    }
  }, [root, activePath, load]);

  /** The file last scrolled into view, so a tree change never scrolls the rail again. */
  const shownRef = useRef<string | null>(null);

  /*
   * Which rows are stuck to the top.
   *
   * The path to the current file is sticky: each of its open ancestors holds
   * a row below its parent while the contents scroll past, and the file's own
   * row holds beneath them, which is the rule in the author's Typora theme.
   * Other open folders scroll like anything else, so the top of the rail
   * always reads as "where the file you are in lives" and never as a stack of
   * every folder you happened to open. That much is the stylesheet's. What it
   * cannot do is tell a row that is stuck from one merely resting in place,
   * and only the stuck one should carry the rule that separates it from the
   * rows sliding under it.
   *
   * A stuck row is one the browser has displaced from the top of its own
   * node, so the test is the distance between the two, read on scroll and
   * once per frame at most. Not an intersection observer: a row resting on
   * its sticky line at scroll zero looks the same to an observer as one that
   * has scrolled up to it, and only the second is stuck.
   */
  useEffect(() => {
    const body = bodyRef.current;
    const scroller = body?.closest('.rail-view');
    if (!body || !scroller) return;
    let frame = 0;
    const mark = () => {
      frame = 0;
      // An ancestor's row is stuck when it sits below the top of its own node.
      for (const row of body.querySelectorAll<HTMLElement>('.tree-directory.tree-on-path[aria-expanded="true"]')) {
        const node = row.parentElement;
        if (!node) continue;
        row.toggleAttribute('data-stuck', row.getBoundingClientRect().top - node.getBoundingClientRect().top > 0.5);
      }
      // The current file's node is the sticky thing, since a leaf's row fills
      // its node and would have no room to hold. It is stuck when it sits
      // below where its previous sibling ends, or below the top of its level.
      for (const node of body.querySelectorAll<HTMLElement>('.tree-node-active')) {
        const previous = node.previousElementSibling;
        const resting = previous
          ? previous.getBoundingClientRect().bottom
          : node.parentElement?.getBoundingClientRect().top ?? 0;
        node.toggleAttribute('data-stuck', node.getBoundingClientRect().top - resting > 0.5);
      }
    };
    const onScroll = () => { if (frame === 0) frame = requestAnimationFrame(mark); };
    scroller.addEventListener('scroll', onScroll, { passive: true });
    mark();
    // Bring the current file into view the first time its row exists, and
    // only then: a folder opening elsewhere must not move the rail.
    if (activePath !== null && shownRef.current !== activePath) {
      const node = body.querySelector<HTMLElement>('.tree-node-active');
      if (node) {
        shownRef.current = activePath;
        const rect = node.getBoundingClientRect();
        const view = scroller.getBoundingClientRect();
        if (rect.bottom > view.bottom || rect.top < view.top) {
          scroller.scrollTop += rect.top - view.top - view.height / 2;
          mark();
        }
      }
    }
    // Light the branch. Each level along the path to the current file gets
    // the length of its stem down to the child on that path, and the
    // stylesheet draws that much of it in the accent. Read once per change
    // of the tree, not per scroll: the stems do not move when the rail does.
    for (const level of body.querySelectorAll<HTMLElement>('.tree-level')) {
      const child = level.querySelector<HTMLElement>(':scope > .tree-node-active, :scope > .tree-node:has(> .tree-on-path)');
      if (!child) {
        level.style.removeProperty('--path-stop');
        continue;
      }
      level.style.setProperty('--path-stop', `${child.offsetTop - level.offsetTop + TREE_ROW_HEIGHT / 2}px`);
    }
    return () => {
      scroller.removeEventListener('scroll', onScroll);
      if (frame !== 0) cancelAnimationFrame(frame);
    };
  }, [children, expanded, root, activePath]);

  if (!root) {
    return (
      <div className="tree-root is-empty" data-testid="file-tree">
        <p className="rail-empty">No folder open yet.</p>
        <button type="button" className="tree-choose" data-testid="choose-folder"
          onClick={onChooseFolder}>Open a folder…</button>
      </div>
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

  /**
   * One level of the tree.
   *
   * Every level is its own `.tree-level` element and every entry its own
   * `.tree-node`, rather than a flat list indented by inline padding. The
   * structure is what draws the connector lines: the level carries the vertical
   * stem, and `:last-child` is what tells a node to end that stem with a
   * rounded corner instead of a tee. A flat list cannot express "last sibling"
   * and so cannot be given a tree's shape in CSS.
   *
   * Depth starts at one under the folder's own row, so the first level hangs
   * from the folder the way every deeper level hangs from its parent.
   */
  const renderLevel = (directory: string, depth: number): ReactNode => {
    const entries = children.get(directory);
    if (!entries) return <p className="tree-loading">Reading…</p>;
    if (entries.length === 0) return <p className="tree-empty">Nothing here.</p>;

    return (
      <div className="tree-level" style={{ '--tree-depth': depth } as React.CSSProperties}>
        {entries.map((entry) => {
          if (entry.kind === 'directory') {
            const isOpen = expanded.has(entry.path);
            // On the path to the current file, which is what earns a row its
            // place at the top of the rail while its contents scroll.
            const onPath = activePath !== null
              && (activePath.startsWith(`${entry.path}/`) || activePath.startsWith(`${entry.path}\\`));
            return (
              <div className="tree-node" key={entry.path}>
                <button
                  type="button"
                  className={onPath ? 'tree-row tree-directory tree-on-path' : 'tree-row tree-directory'}
                  data-testid="tree-directory"
                  data-depth={depth}
                  title={entry.name}
                  aria-expanded={isOpen}
                  onClick={() => toggle(entry.path)}
                >
                  <span className={isOpen ? 'tree-twisty tree-twisty-open' : 'tree-twisty'} aria-hidden="true" />
                  <FolderGlyph open={isOpen} />
                  <span className="tree-name">{entry.name}</span>
                </button>
                {isOpen && renderLevel(entry.path, depth + 1)}
              </div>
            );
          }

          const isActive = entry.path === activePath;
          return (
            <div className={isActive ? 'tree-node tree-node-active' : 'tree-node'} key={entry.path}>
              <button
                type="button"
                className={isActive ? 'tree-row tree-file tree-file-active' : 'tree-row tree-file'}
                data-testid="tree-file"
                data-path={entry.path}
                title={entry.name}
                aria-current={isActive ? 'true' : undefined}
                onClick={() => onOpenFile(entry.path)}
              >
                <span className="tree-twisty tree-twisty-blank" aria-hidden="true" />
                <FileGlyph />
                <span className="tree-name">{entry.name}</span>
              </button>
            </div>
          );
        })}
      </div>
    );
  };

  const vaultName = rootName ?? root.split(/[\\/]/).filter(Boolean).at(-1) ?? root;

  return (
    <div className="tree-root" data-testid="file-tree">
      {failed && <p role="alert" className="tree-error">{failed}</p>}
      <nav className="tree-body" ref={bodyRef}>
        {/* The folder itself is the first row, and the first level hangs from
            it: a tree whose lines begin one level down reads as a list with a
            tree inside it. */}
        <div className="tree-node tree-vault">
          <div className="tree-row tree-directory tree-vault-row" data-testid="tree-vault" data-depth={0} title={root}>
            <span className="tree-twisty tree-twisty-blank" aria-hidden="true" />
            <FolderGlyph open />
            <span className="tree-name">{vaultName}</span>
          </div>
          {renderLevel(root, 1)}
        </div>
      </nav>
    </div>
  );
}

/*
 * The glyphs that make a row of names read as files rather than as an
 * outline. Drawn inline in the title bar's stroke style, so they inherit the
 * row's colour and need no asset; a folder shows a lifted flap when it is
 * open, which repeats what the twisty says in a second place so the eye can
 * take either.
 */
function FolderGlyph({ open }: { open: boolean }) {
  return (
    <svg className="tree-glyph" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M1.75 4.5a1 1 0 0 1 1-1h3.1l1.5 1.5h5.9a1 1 0 0 1 1 1v6.25a1 1 0 0 1-1 1h-10.5a1 1 0 0 1-1-1z" />
      {open && <path d="M1.75 7.25h12.5" />}
    </svg>
  );
}

function FileGlyph() {
  return (
    <svg className="tree-glyph" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4.25 1.75h5l3 3v9.5h-8z" />
      <path d="M9.25 1.75v3h3" />
    </svg>
  );
}
