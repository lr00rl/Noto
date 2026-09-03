import { describe, expect, it, vi } from 'vitest';
import { buildTreeRowMenu, revealLabel } from '../../src/main/workspace/tree-row-menu';

/**
 * A native menu holds the input loop until it is dismissed and no automated
 * pointer can reach one, so what a row offers is read from the template rather
 * than from the screen. The editor's own context menu is tested the same way.
 */
const actions = () => ({ open: vi.fn(), newNote: vi.fn(), reveal: vi.fn(), copyPath: vi.fn() });
const labels = (items: readonly { label?: string; type?: string }[]) =>
  items.map((item) => (item.type === 'separator' ? '---' : item.label));

describe('the menu on a row of the tree', () => {
  it('offers a file the three things a file can do', () => {
    const items = buildTreeRowMenu('/vault/note.md', 'file', actions(), 'darwin');
    expect(labels(items)).toEqual(['Open', '---', 'Reveal in Finder', 'Copy Path']);
  });

  it('offers a folder a new note in it, rather than offering to open it', () => {
    // A click already opens a folder, and a new note otherwise lands in the
    // folder's root, which is rarely the folder the reader is looking at.
    const items = buildTreeRowMenu('/vault/sub', 'directory', actions(), 'darwin');
    expect(labels(items)).toEqual(['New Note Here', '---', 'Reveal in Finder', 'Copy Path']);
  });

  it('makes the new note in the folder that was pressed', () => {
    const spies = actions();
    const items = buildTreeRowMenu('/vault/sub', 'directory', spies, 'darwin');
    const item = items.find((candidate) => candidate.id === 'tree-new-note');
    (item?.click as () => void)();
    expect(spies.newNote).toHaveBeenCalledWith('/vault/sub');
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
