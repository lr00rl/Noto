import { describe, expect, it } from 'vitest';
import type { MenuItemConstructorOptions } from 'electron';
import { buildMenuTemplate } from '../../src/main/workspace/menu-template';
import { notoBindings } from '../../src/renderer/editor/noto/keymap';

/**
 * A native accelerator is handled before the document ever sees the key, so a
 * chord claimed by both the menu and the editor belongs to the menu and the
 * editor's binding is dead. That happened once: the menu gave Command and a
 * bracket to the page width while the editor gave the same pair to list
 * indentation, and indenting a list item from the keyboard did nothing.
 */
function accelerators(items: readonly MenuItemConstructorOptions[]): string[] {
  const found: string[] = [];
  for (const item of items) {
    if (typeof item.accelerator === 'string') found.push(item.accelerator);
    const submenu = item.submenu;
    if (Array.isArray(submenu)) found.push(...accelerators(submenu));
  }
  return found;
}

/** `CmdOrCtrl+Shift+H` in the menu is `Meta-Shift-h` in the editor. */
function asChord(accelerator: string, mac: boolean): string {
  return accelerator
    .split('+')
    .map((part) => {
      if (part === 'CmdOrCtrl' || part === 'Command') return mac ? 'Meta' : 'Ctrl';
      if (part === 'Control') return 'Ctrl';
      if (part === 'Alt' || part === 'Option') return 'Alt';
      if (part === 'Shift') return 'Shift';
      return part.length === 1 ? part.toLowerCase() : part;
    })
    .join('-');
}

describe('no key is claimed twice', () => {
  const built = (mac: boolean) => buildMenuTemplate({
    platform: mac ? 'darwin' : 'win32',
    appName: 'Noto',
    recent: [],
    actions: {
      openFolder: () => {}, closeTab: () => {}, openDialog: () => {},
      openPath: () => {},
    importDocument: () => {}, clearRecent: () => {},
    },
    sendCommand: () => {},
    openExternal: () => {},
  });

  for (const mac of [true, false]) {
    it(`by two menu items, on ${mac ? 'macOS' : 'the other platforms'}`, () => {
      // Only one of them can ever fire, and which one is not worth finding out.
      // Command and K was given to both the palette and the hyperlink.
      const seen = new Map<string, number>();
      for (const accelerator of accelerators(built(mac))) {
        seen.set(accelerator, (seen.get(accelerator) ?? 0) + 1);
      }
      expect([...seen].filter(([, count]) => count > 1)).toEqual([]);
    });

    it(`by the menu and the editor, where they would do different things, on ${mac ? 'macOS' : 'the other platforms'}`, () => {
      /*
       * Sharing a chord is normal and fine where both sides run the same
       * command: the accelerator fires, the menu sends the command, and the
       * editor's own binding is simply never reached.
       *
       * It is a fault only where the two mean different things, because then
       * the editor's binding is dead and nothing says so. The page width had
       * Command and a bracket while the editor gave the same pair to list
       * indentation, so a list could not be indented from the keyboard at all.
       */
      const chords = new Set(Object.keys(notoBindings({ mac })));
      const contested = ['Meta-]', 'Meta-[', 'Ctrl-]', 'Ctrl-['].filter((chord) => chords.has(chord));
      const claimed = accelerators(built(mac)).map((accelerator) => asChord(accelerator, mac));
      expect(claimed.filter((chord) => contested.includes(chord))).toEqual([]);
    });
  }
});
