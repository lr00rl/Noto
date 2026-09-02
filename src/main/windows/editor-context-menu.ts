/**
 * The menu a right click raises in the editor.
 *
 * Built in main because that is where the clipboard roles and the spell
 * checker's suggestions live: a renderer can draw a menu but cannot ask what
 * the dictionary thinks of a word, and reimplementing cut and paste as
 * renderer commands loses the platform's own behaviour.
 *
 * Only what the click is actually about. A menu that always shows the same
 * eleven items teaches nobody anything, so the spelling section is drawn only
 * over a misspelled word, and the link and image sections only over a link or
 * an image.
 */

import { Menu, clipboard, type BrowserWindow, type ContextMenuParams, type MenuItemConstructorOptions } from 'electron';

/** Suggestions past this many are guesses rather than corrections. */
const MAX_SUGGESTIONS = 5;

export function buildEditorContextMenu(
  window: BrowserWindow,
  params: ContextMenuParams,
): MenuItemConstructorOptions[] {
  const items: MenuItemConstructorOptions[] = [];
  const { editFlags } = params;

  if (params.misspelledWord) {
    const suggestions = params.dictionarySuggestions.slice(0, MAX_SUGGESTIONS);
    for (const word of suggestions) {
      items.push({ label: word, click: () => window.webContents.replaceMisspelling(word) });
    }
    if (suggestions.length === 0) {
      items.push({ label: 'No spelling suggestions', enabled: false });
    }
    items.push({ type: 'separator' });
    items.push({
      label: 'Add to Dictionary',
      click: () => window.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord),
    });
    items.push({ type: 'separator' });
  }

  if (params.linkURL) {
    items.push({ label: 'Copy Link Address', click: () => clipboard.writeText(params.linkURL) });
    items.push({ type: 'separator' });
  }

  if (params.mediaType === 'image' && params.srcURL) {
    items.push({ label: 'Copy Image Address', click: () => clipboard.writeText(params.srcURL) });
    items.push({ type: 'separator' });
  }

  items.push({ role: 'cut', enabled: editFlags.canCut });
  items.push({ role: 'copy', enabled: editFlags.canCopy });
  items.push({ role: 'paste', enabled: editFlags.canPaste });
  // The markdown a note is made of is text, so pasting a styled fragment as
  // text is what you want far more often than the fragment's own markup.
  items.push({ role: 'pasteAndMatchStyle', label: 'Paste as Plain Text', enabled: editFlags.canPaste });
  items.push({ type: 'separator' });
  items.push({ role: 'selectAll', enabled: editFlags.canSelectAll });

  return items;
}

export function installEditorContextMenu(window: BrowserWindow): void {
  window.webContents.on('context-menu', (_event, params) => {
    // Not over the chrome: the rail and the title bar have their own answers,
    // and a clipboard menu over a tree row would be a menu about nothing.
    if (!params.isEditable && !params.selectionText && !params.linkURL && params.mediaType !== 'image') return;
    Menu.buildFromTemplate(buildEditorContextMenu(window, params)).popup({ window });
  });
}
