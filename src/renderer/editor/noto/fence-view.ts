/**
 * A code fence on screen: line numbers, its language, and a copy button.
 *
 * The author's `fence-enhance` plugin does this for Typora by working around
 * CodeMirror; here the fence is ours, so it is a node view. The `pre` is the
 * node's element, as the schema draws it, with a gutter column beside the
 * code and a small tool bar in the corner. The code element is the content
 * the editor owns; the gutter and the tools are not content, and the editor
 * is told to ignore what happens in them.
 *
 * The gutter is a column of numbers set in the same face and leading as the
 * code, so the two line up as long as code never wraps, and it does not: a
 * long line scrolls inside the code column while the numbers stay put. Its
 * width follows the block's own line count, two digits at least.
 */

import type { Node as ProseNode } from 'prosemirror-model';
import { TextSelection } from 'prosemirror-state';
import type { EditorView, NodeView } from 'prosemirror-view';
import { digitsForLineCount, gutterText, lineCount } from './fence-gutter';
import { supportedLanguages } from './highlight';

/** How long "Copied" stays before the button says "Copy" again. */
const COPIED_MS = 1400;

/** The id of the one datalist every fence's language field shares. */
const LANGUAGE_LIST_ID = 'noto-fence-languages';

/**
 * The languages offered as you type, made once for the document.
 *
 * A native datalist rather than a menu of our own: it is a real completion
 * control the platform draws, it takes the keyboard, and it costs nothing
 * per fence. The names are what the highlighter answers to, so choosing one
 * is choosing colour, not just a label.
 */
function languageList(): HTMLDataListElement {
  const existing = document.getElementById(LANGUAGE_LIST_ID);
  if (existing instanceof HTMLDataListElement) return existing;
  const list = document.createElement('datalist');
  list.id = LANGUAGE_LIST_ID;
  for (const name of supportedLanguages()) {
    const option = document.createElement('option');
    option.value = name;
    list.append(option);
  }
  document.body.append(list);
  return list;
}

export class FenceView implements NodeView {
  readonly dom: HTMLElement;
  readonly contentDOM: HTMLElement;
  private readonly gutter: HTMLElement;
  private readonly tools: HTMLElement;
  private readonly language: HTMLInputElement;
  private readonly copy: HTMLButtonElement;
  private lines = 0;
  private copiedTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private node: ProseNode,
    private readonly view: EditorView,
    private readonly getPos: () => number | undefined,
  ) {
    this.dom = document.createElement('pre');
    this.dom.className = 'noto-fence';

    this.gutter = document.createElement('div');
    this.gutter.className = 'noto-fence-gutter';
    this.gutter.contentEditable = 'false';
    this.gutter.setAttribute('aria-hidden', 'true');
    // A press on a number puts the caret at the start of that line, which is
    // what a gutter is for in every code editor and beats the editor guessing
    // a position from a click on something that is not content.
    this.gutter.addEventListener('mousedown', (event) => {
      event.preventDefault();
      this.caretToLine(this.lineAt(event.offsetY));
    });

    this.contentDOM = document.createElement('code');
    this.contentDOM.className = 'noto-fence-code';

    this.tools = document.createElement('div');
    this.tools.className = 'noto-fence-tools';
    this.tools.contentEditable = 'false';
    // The language is a field, not a label: the reader types it here, with
    // the highlighter's names offered as they type, and the block takes the
    // colour of what they chose. Typora puts the same field in the same
    // corner, which is where a hand that just typed a fence expects it.
    this.language = document.createElement('input');
    this.language.className = 'noto-fence-lang';
    this.language.type = 'text';
    this.language.placeholder = 'language';
    this.language.spellcheck = false;
    this.language.autocomplete = 'off';
    this.language.setAttribute('aria-label', 'Code block language');
    this.language.setAttribute('list', languageList().id);
    this.language.addEventListener('change', () => this.commitLanguage());
    this.language.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        this.commitLanguage();
        this.view.focus();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        this.language.value = (this.node.attrs.lang as string) || '';
        this.view.focus();
      }
    });
    this.copy = document.createElement('button');
    this.copy.type = 'button';
    this.copy.className = 'noto-fence-copy';
    this.copy.textContent = 'Copy';
    this.copy.title = 'Copy the code';
    // Mousedown would move the editor's selection to the button; the click
    // is what the button is for.
    this.copy.addEventListener('mousedown', (event) => event.preventDefault());
    this.copy.addEventListener('click', () => this.copyCode());
    this.tools.append(this.language, this.copy);

    this.dom.append(this.gutter, this.contentDOM, this.tools);
    this.render();
  }

  update(node: ProseNode): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.render();
    return true;
  }

  /** The gutter and the tools are ours. Only the code is the editor's. */
  ignoreMutation(mutation: MutationRecord | { type: 'selection'; target: Node }): boolean {
    return !this.contentDOM.contains(mutation.target);
  }

  /** A click on the tools or the gutter is not a click in the document. */
  stopEvent(event: Event): boolean {
    return event.target instanceof Node
      && (this.tools.contains(event.target) || this.gutter.contains(event.target));
  }

  /** Which line a vertical offset inside the gutter falls on, counted from zero. */
  private lineAt(offsetY: number): number {
    const style = getComputedStyle(this.gutter);
    const lineHeight = Number.parseFloat(style.lineHeight);
    const paddingTop = Number.parseFloat(style.paddingTop) || 0;
    const height = Number.isFinite(lineHeight) && lineHeight > 0 ? lineHeight : 20;
    return Math.floor((offsetY - paddingTop) / height);
  }

  /** Put the caret at the start of line `index`, counted from zero and clamped. */
  private caretToLine(index: number): void {
    const base = this.getPos();
    if (base === undefined) return;
    const text = this.node.textContent;
    const lines = lineCount(text);
    const target = Math.min(Math.max(0, index), lines - 1);
    let offset = 0;
    for (let line = 0; line < target; line += 1) offset = text.indexOf('\n', offset) + 1;
    const position = base + 1 + offset;
    const { state } = this.view;
    this.view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, position)).scrollIntoView());
    this.view.focus();
  }

  destroy(): void {
    if (this.copiedTimer !== null) clearTimeout(this.copiedTimer);
  }

  /** Write the field's value into the node, as one undoable change. */
  private commitLanguage(): void {
    const lang = this.language.value.trim().toLowerCase();
    if (lang === ((this.node.attrs.lang as string) || '')) return;
    const position = this.getPos();
    if (position === undefined) return;
    const { state } = this.view;
    this.view.dispatch(state.tr.setNodeMarkup(position, undefined, { ...this.node.attrs, lang }));
  }

  private render(): void {
    const lang = (this.node.attrs.lang as string) || '';
    if (lang) this.dom.setAttribute('data-lang', lang);
    else this.dom.removeAttribute('data-lang');
    // Not while the reader is typing in it: a redraw mid-word would take
    // the word away.
    if (document.activeElement !== this.language) this.language.value = lang;
    this.language.size = Math.max(6, lang.length + 1);

    // Recounted on every update and rewritten only when the count moves, so
    // typing inside a line costs a scan of the text and nothing in the DOM.
    const lines = lineCount(this.node.textContent);
    if (lines === this.lines) return;
    this.lines = lines;
    this.gutter.textContent = gutterText(lines);
    this.dom.style.setProperty('--fence-digits', String(digitsForLineCount(lines)));
  }

  private copyCode(): void {
    if (!copyThroughSelection(this.node.textContent)) return;
    this.copy.textContent = 'Copied';
    this.copy.dataset.copied = '';
    if (this.copiedTimer !== null) clearTimeout(this.copiedTimer);
    this.copiedTimer = setTimeout(() => {
      this.copy.textContent = 'Copy';
      delete this.copy.dataset.copied;
      this.copiedTimer = null;
    }, COPIED_MS);
  }
}

/**
 * Copy through a selection and the copy command.
 *
 * Not the asynchronous clipboard API: the app's session refuses every
 * permission a page can ask for, that API asks for one, and a copy button
 * that fails quietly is worse than none. The copy command needs no permission
 * and is what the editor's own Cmd+C already goes through. A textarea outside
 * the editor holds the text for the length of one command, so the editor's
 * own selection is never touched.
 *
 * yagni: if the command is ever withdrawn, the upgrade is a small channel to
 * main's clipboard, which is where the file menu's copy would live anyway.
 */
function copyThroughSelection(text: string): boolean {
  const holder = document.createElement('textarea');
  holder.value = text;
  holder.setAttribute('aria-hidden', 'true');
  holder.style.position = 'fixed';
  holder.style.opacity = '0';
  document.body.append(holder);
  holder.select();
  let copied = false;
  try {
    copied = document.execCommand('copy');
  } finally {
    holder.remove();
  }
  return copied;
}

export function fenceNodeViews() {
  return {
    code_block: (node: ProseNode, view: EditorView, getPos: () => number | undefined) =>
      new FenceView(node, view, getPos),
  };
}
