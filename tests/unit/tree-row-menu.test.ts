import { describe, expect, it, vi } from 'vitest';
import { buildTreeRowMenu, revealLabel } from '../../src/main/workspace/tree-row-menu';

/**
 * A native menu holds the input loop until it is dismissed and no automated
 * pointer can reach one, so what a row offers is read from the template rather
 * than from the screen. The editor's own context menu is tested the same way.
 */
const actions = () => ({ open: vi.fn(), reveal: vi.fn(), copyPath: vi.fn() });
const labels = (items: readonly { label?: string; type?: string }[]) =>
  items.map((item) => (item.type === 'separator' ? '---' : item.label));

describe('the menu on a row of the tree', () => {
  it('offers a file the three things a file can do', () => {
    const items = buildTreeRowMenu('/vault/note.md', 'file', actions(), 'darwin');
    expect(labels(items)).toEqual(['Open', '---', 'Reveal in Finder', 'Copy Path']);
  });

  it('does not offer to open a folder, which a click already does', () => {
    const items = buildTreeRowMenu('/vault/sub', 'directory', actions(), 'darwin');
    expect(labels(items)).toEqual(['Reveal in Finder', 'Copy Path']);
  });

  it('calls the file manager what each system calls it', () => {
    expect(revealLabel('darwin')).toBe('Reveal in Finder');
    expect(revealLabel('win32')).toBe('Reveal in File Explorer');
    expect(revealLabel('linux')).toBe('Reveal in File Manager');
  });

  it('acts on the path it was built with, and no other', () => {
    const spies = actions();
    const items = buildTreeRowMenu('/vault/note.md', 'file', spies, 'darwin');
    const click = (id: string) => {
      const item = items.find((candidate) => candidate.id === id);
      if (!item?.click) throw new Error(`no item ${id}`);
      (item.click as () => void)();
    };
    click('tree-open');
    click('tree-reveal');
    click('tree-copy-path');
    expect(spies.open).toHaveBeenCalledWith('/vault/note.md');
    expect(spies.reveal).toHaveBeenCalledWith('/vault/note.md');
    expect(spies.copyPath).toHaveBeenCalledWith('/vault/note.md');
  });
});
