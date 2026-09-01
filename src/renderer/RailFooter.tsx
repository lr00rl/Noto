/**
 * The bar across the bottom of the rail.
 *
 * Typora puts the folder's name here with the actions that operate on the
 * folder rather than on a file, and the list of folders opened before. Noto had
 * neither: the only way to change folder was a menu item, and the folders you
 * had already opened were not remembered at all, so moving between two vaults
 * meant walking the file dialog to the same place every time.
 *
 * It sits at the bottom because it is about the container, not the contents.
 * The tree above answers "which note"; this answers "which folder", which is a
 * question asked far less often and should therefore be further from the hand.
 */

import { useEffect, useRef } from 'react';
import type { RecentFileV1 } from '../shared/workspace/v1/contracts';

export interface RailFooterProps {
  readonly folderName: string | null;
  readonly folderPath: string | null;
  readonly recentFolders: readonly RecentFileV1[];
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly onClose: () => void;
  readonly onChooseFolder: () => void;
  readonly onOpenRecentFolder: (path: string) => void;
  readonly onRefresh: () => void;
}

export function RailFooter({
  folderName, folderPath, recentFolders, open,
  onToggle, onClose, onChooseFolder, onOpenRecentFolder, onRefresh,
}: RailFooterProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); }
    };
    // Captured, so a click that lands on a control inside the tree still closes
    // the menu rather than being swallowed by whatever it hit.
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  // The current folder is not offered as somewhere to go.
  const elsewhere = recentFolders.filter((entry) => entry.path !== folderPath).slice(0, 8);

  return (
    <div className="rail-footer" ref={menuRef}>
      {open && (
        <div className="rail-menu" role="menu" aria-label="Folder actions" data-testid="rail-menu">
          <button type="button" role="menuitem" className="rail-menu-item"
            data-testid="rail-choose-folder"
            onClick={() => { onClose(); onChooseFolder(); }}>Open folder…</button>
          <button type="button" role="menuitem" className="rail-menu-item"
            disabled={folderPath === null}
            onClick={() => { onClose(); onRefresh(); }}>Refresh folder</button>

          {elsewhere.length > 0 && (
            <>
              <span className="rail-menu-heading">Recent folders</span>
              {elsewhere.map((entry) => (
                <button
                  key={entry.path}
                  type="button"
                  role="menuitem"
                  className="rail-menu-item is-folder"
                  data-testid="rail-recent-folder"
                  title={entry.path}
                  onClick={() => { onClose(); onOpenRecentFolder(entry.path); }}
                >
                  {entry.name}
                </button>
              ))}
            </>
          )}
        </div>
      )}

      <button
        type="button"
        className="rail-footer-button"
        data-testid="rail-folder-menu"
        aria-haspopup="menu"
        aria-expanded={open}
        title={folderPath ?? 'No folder open'}
        onClick={onToggle}
      >
        <span className="rail-footer-name">{folderName ?? 'No folder'}</span>
        <span className="rail-footer-dots" aria-hidden="true">⋯</span>
      </button>
    </div>
  );
}
