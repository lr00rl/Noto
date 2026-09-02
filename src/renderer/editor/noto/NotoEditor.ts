/**
 * The editor.
 *
 * Owns a ProseMirror `EditorView` built on Noto's own schema, so every markdown
 * construct the parser produces is editable rather than frozen as source.
 *
 * Two properties are load bearing:
 *
 * - Capture is cheap. A block whose ProseMirror node is structurally identical
 *   to the one it was built from is reported using its original source text,
 *   with no serialization at all. Only blocks the user actually touched are
 *   rendered back to markdown, which is what keeps saving a large document
 *   proportional to the size of the edit rather than the size of the file.
 * - Capture is refused mid composition. An IME candidate window holds text that
 *   is not committed yet, and saving it would write a half finished word.
 */

import { EditorState, Selection, type Plugin, type Transaction } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { history, redo, undo } from 'prosemirror-history';
import { dropCursor } from 'prosemirror-dropcursor';
import { gapCursor } from 'prosemirror-gapcursor';
import { columnResizing, tableEditing } from 'prosemirror-tables';
import type { Node as ProseNode } from 'prosemirror-model';
import { notoSchema } from '../../../shared/markdown/v3/pm/schema';
import { blockFromSpan, docFromSpans } from '../../../shared/markdown/v3/pm/from-mdast';
import { blockToMarkdown } from '../../../shared/markdown/v3/pm/to-mdast';
import { parseSingleBlock, splitBlocks } from '../../../shared/markdown/v3/blocks';
import { toLf } from '../../../shared/markdown/v3/line-endings';
import type { NotoDocumentWire, NotoTransaction } from '../../../shared/markdown/v3/contracts';
import { captureMarkdown, captureTransaction, type CaptureStats, type PristineBlock } from './capture';
import type { NotoEditorPort } from './NotoEditorPort';
import { createOriginPlugin, getBlockOrigins, rebaseOrigins } from './origin-plugin';
import { notoInputRules, type InputRuleOptions } from './input-rules';
import { EDITOR_COMMANDS, notoKeymap } from './keymap';
import { activeNodePlugin } from './active-node-plugin';
import { alertPlugin } from './alert-plugin';
import { typoraMarksPlugin } from './typora-marks-plugin';
import { typewriterPlugin } from './typewriter-plugin';
import { autoPairPlugin } from './auto-pair';
import { mathEditingPlugin, mathNodeViews } from './math-view';
import { fenceNodeViews } from './fence-view';
import type { ImageContext } from './image-source';
import { htmlNodeViews } from './html-view';
import { imageNodeViews, type Refreshable } from './image-view';
import type { SearchOptions } from './search';
import {
  getSearchState,
  goToMatch,
  replaceActive,
  replaceAll,
  searchPlugin,
  selectActiveMatch,
  setSearch,
} from './search-plugin';
import { syntaxHighlightPlugin } from './highlight';
import { wikiLinkPlugin } from './wiki-link-plugin';

export interface NotoEditorOptions extends InputRuleOptions {
  readonly mac: boolean;
  /** Native spell checking, which the user can turn off in settings. */
  readonly spellCheck?: boolean;
  readonly onDirtyChange?: (dirty: boolean) => void;
  /** Fired for every transaction that changed the document. */
  readonly onDocumentChanged?: () => void;
  readonly onError?: (message: string) => void;
  /** Cmd or Ctrl clicking a `[[wiki link]]`. Absent means links stay inert. */
  readonly onFollowWikiLink?: (target: string) => void;
  /** Where relative images resolve from, and whether web images load. */
  readonly images?: ImageContext;
}

export class NotoEditor implements NotoEditorPort {
  private view: EditorView | null = null;
  private document: NotoDocumentWire;
  private smartTypography = false;
  private typewriter = false;
  private autoPair = true;
  private imageContext: ImageContext;
  /** The pictures on screen, so a changed context can redraw them and nothing else. */
  private readonly imageViews = new Set<Refreshable>();
  private baselineDoc: ProseNode;
  private dirty = false;
  private readonly host: HTMLElement;
  private readonly options: NotoEditorOptions;
  /** What each accepted block looked like, keyed by block id. */
  private pristine = new Map<string, PristineBlock>();

  constructor(host: HTMLElement, document: NotoDocumentWire, options: NotoEditorOptions) {
    this.document = document;
    this.options = options;
    this.host = host;
    this.smartTypography = options.smartTypography === true;
    this.imageContext = options.images ?? { documentDir: null, remote: true };

    const doc = this.buildDoc(document);
    this.baselineDoc = doc;

    this.view = new EditorView(host, {
      state: EditorState.create({ doc, plugins: this.plugins(document) }),
      dispatchTransaction: (transaction) => this.apply(transaction),
      attributes: { spellcheck: String(this.options.spellCheck ?? true) },
      nodeViews: this.nodeViews(),
    });
  }

  private nodeViews() {
    return {
      ...mathNodeViews(),
      ...fenceNodeViews(),
      ...imageNodeViews(this.imageViews, () => this.imageContext),
      ...htmlNodeViews(this.imageViews, () => this.imageContext),
    };
  }

  private plugins(document: NotoDocumentWire): Plugin[] {
    return [
      createOriginPlugin(document.origins),
      // A getter, not a value: the setting can change while the editor is open
      // and the rules must follow without the editor being rebuilt.
      notoInputRules({ smartTypography: () => this.smartTypography }),
      ...notoKeymap({ mac: this.options.mac }),
      history(),
      dropCursor({ color: 'var(--accent)' }),
      gapCursor(),
      alertPlugin(),
      typoraMarksPlugin(),
      typewriterPlugin(() => this.typewriter),
      autoPairPlugin(() => this.autoPair),
      columnResizing(),
      tableEditing(),
      activeNodePlugin(),
      wikiLinkPlugin({ onFollow: (target) => this.options.onFollowWikiLink?.(target) }),
      mathEditingPlugin(),
      searchPlugin(),
      syntaxHighlightPlugin(),
    ];
  }

  /**
   * Build the ProseMirror document and record what each block started as.
   *
   * The block markdown is recovered by re-splitting the text rather than being
   * sent over IPC, which keeps one copy of the file on the wire instead of two.
   */
  private buildDoc(document: NotoDocumentWire): ProseNode {
    const spans = splitBlocks(document.text).spans;
    const doc = docFromSpans(spans);

    this.pristine = new Map();
    doc.forEach((node, _offset, index) => {
      const origin = document.origins[index];
      const span = spans[index];
      if (origin && span) this.pristine.set(origin.blockId, { node, markdown: toLf(span.markdown) });
    });

    return doc;
  }

  private apply(transaction: Transaction): void {
    const view = this.view;
    if (!view) return;
    view.updateState(view.state.apply(transaction));
    if (!transaction.docChanged) return;
    this.refreshDirty();
    // Every change, not only the transition into dirty. Automatic saving has to
    // debounce against typing, and a flag that flips once at the first
    // keystroke cannot tell it when typing stopped.
    this.options.onDocumentChanged?.();
  }

  private refreshDirty(): void {
    const view = this.view;
    if (!view) return;
    // While clean, any document change makes it dirty without a comparison.
    // While dirty, compare so that undoing back to the saved state clears it.
    // `doc.eq` looks expensive here but is not: ProseMirror reuses the nodes an
    // edit did not touch, so comparing a document against its saved state is a
    // walk of pointer comparisons. Measured, adding a size precheck in front of
    // it changed nothing.
    const next = this.dirty ? !view.state.doc.eq(this.baselineDoc) : true;
    if (next === this.dirty) return;
    this.dirty = next;
    this.options.onDirtyChange?.(next);
  }

  get isDirty(): boolean {
    return this.dirty;
  }

  get isComposing(): boolean {
    return this.view?.composing ?? false;
  }

  get acceptedDocument(): NotoDocumentWire {
    return this.document;
  }

  /**
   * Insert text at the caret, as one undoable step.
   *
   * Used by quick open to write a wiki link. It goes through a transaction like
   * any edit, so it is undoable, it marks the document dirty, and the saved
   * bytes come from the same serializer as anything typed by hand.
   *
   * Deliberately not on `NotoEditorPort`. The port is the plugin API, and
   * inserting arbitrary text at the caret is a capability no plugin has asked
   * for; the shell holds the editor itself and does not need the port to reach
   * it.
   */
  insertText(text: string): boolean {
    const view = this.view;
    if (!view || text.length === 0) return false;
    const { from, to } = view.state.selection;
    view.dispatch(view.state.tr.insertText(text, from, to).scrollIntoView());
    view.focus();
    return true;
  }

  focus(): void {
    this.view?.focus();
  }

  /**
   * Put the caret at the start of a top level block and scroll it into view.
   *
   * Used by the outline. Moving the selection rather than only scrolling means
   * the user can keep typing where they landed.
   */
  focusBlock(index: number): void {
    const view = this.view;
    if (!view || index < 0 || index >= view.state.doc.childCount) return;
    let position = 0;
    for (let current = 0; current < index; current += 1) position += view.state.doc.child(current).nodeSize;
    const selection = Selection.near(view.state.doc.resolve(Math.min(position + 1, view.state.doc.content.size)));
    view.dispatch(view.state.tr.setSelection(selection).scrollIntoView());
    view.focus();
  }

  /**
   * Show the block holding the caret as raw markdown, or render it again.
   *
   * Per block rather than per document, because the point is to reach into one
   * awkward construct (a fence with odd indentation, a table you would rather
   * type than tab through) without losing the rendered view of everything else.
   *
   * Returns false when the toggle cannot be applied, which happens if the
   * hand-edited text no longer parses as exactly one block. Refusing is the
   * honest outcome: silently splitting the user's block would change the
   * document's structure behind their back.
   */
  /**
   * Run one of the block-shaping commands by name.
   *
   * The menu and the keyboard reach the same code this way: a menu item that
   * reimplemented what a binding does would be a second implementation to
   * keep in step. False when the command has nothing to do where the caret
   * is, which is what lets the caller say so rather than pretending.
   */
  runCommand(name: string): boolean {
    const view = this.view;
    const command = EDITOR_COMMANDS[name];
    if (!view || !command) return false;
    const ran = command(view.state, view.dispatch, view);
    if (ran) view.focus();
    return ran;
  }

  toggleSourceAtSelection(): boolean {
    const view = this.view;
    if (!view) return false;
    const { $from } = view.state.selection;
    // Depth 1 is the top level block; source mode is a block level idea.
    if ($from.depth < 1) return false;
    const index = $from.index(0);
    const node = view.state.doc.child(index);

    let position = 0;
    for (let current = 0; current < index; current += 1) position += view.state.doc.child(current).nodeSize;

    const schema = view.state.schema;
    let replacement: ProseNode;
    if (node.type.name === 'source_block') {
      const markdown = node.textContent;
      const span = parseSingleBlock(markdown);
      if (!span) return false;
      replacement = blockFromSpan(span);
    } else {
      const markdown = blockToMarkdown(node);
      replacement = schema.nodes.source_block.create(
        { originalKind: node.type.name },
        markdown.length > 0 ? schema.text(markdown) : undefined,
      );
    }

    const transaction = view.state.tr.replaceWith(position, position + node.nodeSize, replacement);
    transaction.setSelection(Selection.near(transaction.doc.resolve(position + 1)));
    view.dispatch(transaction.scrollIntoView());
    view.focus();
    return true;
  }

  /** Whether the caret currently sits in a block shown as raw markdown. */
  get isSourceAtSelection(): boolean {
    const view = this.view;
    if (!view) return false;
    const { $from } = view.state.selection;
    if ($from.depth < 1) return false;
    return view.state.doc.child($from.index(0)).type.name === 'source_block';
  }

  /**
   * Point the find bar at a query.
   *
   * Returns how many matches there are and which one is current, so the shell
   * can show "3 of 17" without keeping its own copy of the document.
   */
  search(options: SearchOptions): { matches: number; active: number } {
    const view = this.view;
    if (!view) return { matches: 0, active: -1 };
    view.dispatch(setSearch(view.state.tr, { options }));
    const state = getSearchState(view.state);
    return { matches: state.matches.length, active: state.active };
  }

  /** Move to the next or previous match and select it. */
  goToMatch(direction: 'forward' | 'backward'): { matches: number; active: number } {
    const view = this.view;
    if (!view) return { matches: 0, active: -1 };
    view.dispatch(goToMatch(view.state.tr, direction));
    view.dispatch(selectActiveMatch(view.state, view.state.tr));
    const state = getSearchState(view.state);
    return { matches: state.matches.length, active: state.active };
  }

  /** Replace the current match, or every match. Returns how many changed. */
  replace(replacement: string, scope: 'one' | 'all'): number {
    const view = this.view;
    if (!view) return 0;
    const before = getSearchState(view.state).matches.length;
    const transaction = scope === 'all'
      ? replaceAll(view.state, replacement)
      : replaceActive(view.state, replacement);
    if (!transaction) return 0;
    view.dispatch(transaction);
    return scope === 'all' ? before : 1;
  }

  /**
   * Undo or redo through ProseMirror's history.
   *
   * The application menu routes here rather than using Electron's undo role,
   * which would run the browser's undo against the contenteditable and leave
   * the editor's own history untouched.
   */
  history(direction: 'undo' | 'redo'): boolean {
    const view = this.view;
    if (!view) return false;
    const command = direction === 'undo' ? undo : redo;
    return command(view.state, view.dispatch);
  }

  /**
   * Apply settings to a live editor.
   *
   * Rebuilding the editor would apply them too, and would also throw away the
   * user's undo history and cursor, so a preference change must never cost
   * them that. Spell checking is a view property, and smart typography is read
   * by the input rules on each keystroke, so both take effect at once.
   */
  applySettings(settings: {
    spellCheck?: boolean;
    smartTypography?: boolean;
    remoteImages?: boolean;
    typewriterMode?: boolean;
    autoPair?: boolean;
  }): void {
    if (settings.autoPair !== undefined) {
      this.autoPair = settings.autoPair;
    }
    if (settings.typewriterMode !== undefined) {
      this.typewriter = settings.typewriterMode;
    }
    if (settings.smartTypography !== undefined) {
      this.smartTypography = settings.smartTypography;
    }
    const view = this.view;
    if (!view) return;
    if (settings.remoteImages !== undefined && settings.remoteImages !== this.imageContext.remote) {
      this.imageContext = { ...this.imageContext, remote: settings.remoteImages };
      this.refreshImages();
    }
    if (settings.spellCheck === undefined) return;
    view.setProps({ attributes: { spellcheck: String(settings.spellCheck) } });
  }

  /**
   * Draw the images again.
   *
   * For when what main will serve has changed under a note that is already
   * open: a folder opened after the note means a picture in a sibling folder
   * that was refused a moment ago is allowed now, and a placeholder that
   * stayed "not found" until the note was reopened would be wrong. Only the
   * images are touched; the rest of the document is not redrawn.
   */
  refreshImages(): void {
    for (const image of this.imageViews) image.refresh();
  }

  /** Drop the highlight, for when the find bar closes. */
  clearSearch(): void {
    const view = this.view;
    if (!view) return;
    view.dispatch(setSearch(view.state.tr, {
      options: { query: '', caseSensitive: false, wholeWord: false, regex: false },
    }));
  }

  /** The whole document as markdown, which is what a transform plugin reads. */
  getMarkdown(): string {
    const view = this.view;
    if (!view) return '';
    return captureMarkdown({
      doc: view.state.doc,
      origins: getBlockOrigins(view.state),
      document: this.document,
      pristine: this.pristine,
    }).join('\n\n');
  }

  /**
   * Replace the document with new markdown, as one undoable step.
   *
   * Deliberately not a whole-document swap. Replacing everything would discard
   * every block's provenance, so a plugin that reformatted one line would cause
   * the entire file to be re-serialized and byte fidelity would be lost for
   * blocks nobody touched.
   *
   * Instead the unchanged blocks at the start and end are left alone and only
   * the differing middle is replaced. A transform that rewrites one heading
   * therefore touches one block, and the rest of the file still saves byte for
   * byte identical.
   *
   * Returns false when the markdown is already what the document holds.
   */
  replaceMarkdown(markdown: string): boolean {
    const view = this.view;
    if (!view) return false;

    const current = captureMarkdown({
      doc: view.state.doc,
      origins: getBlockOrigins(view.state),
      document: this.document,
      pristine: this.pristine,
    });

    const spans = splitBlocks(toLf(markdown)).spans;
    const next = spans.map((span) => toLf(span.markdown));
    if (current.length === next.length && current.every((value, index) => value === next[index])) return false;

    let prefix = 0;
    const shortest = Math.min(current.length, next.length);
    while (prefix < shortest && current[prefix] === next[prefix]) prefix += 1;

    let suffix = 0;
    while (suffix < shortest - prefix
      && current[current.length - 1 - suffix] === next[next.length - 1 - suffix]) suffix += 1;

    // Character positions of the replaced range in the ProseMirror document.
    let from = 0;
    for (let index = 0; index < prefix; index += 1) from += view.state.doc.child(index).nodeSize;
    let to = view.state.doc.content.size;
    for (let index = 0; index < suffix; index += 1) {
      to -= view.state.doc.child(view.state.doc.childCount - 1 - index).nodeSize;
    }

    const replacement = spans.slice(prefix, next.length - suffix).map(blockFromSpan);
    const transaction = view.state.tr.replaceWith(from, to, replacement);
    view.dispatch(transaction.scrollIntoView());
    return true;
  }

  /**
   * Plugin editor ABI. Styling only, so it cannot reach the document.
   */
  setSemanticFocus(enabled: boolean): void {
    if (enabled) this.host.dataset.semanticFocus = 'true';
    else delete this.host.dataset.semanticFocus;
  }

  undo(): void {
    const view = this.view;
    if (view) undo(view.state, view.dispatch);
  }

  redo(): void {
    const view = this.view;
    if (view) redo(view.state, view.dispatch);
  }

  /**
   * Build the transaction describing the current editor contents.
   *
   * Throws rather than returning a partial result, because a save built from a
   * document that is not ready would silently write the wrong bytes.
   */
  capture(): NotoTransaction {
    return this.captureWithStats().transaction;
  }

  captureWithStats(): { transaction: NotoTransaction; stats: CaptureStats } {
    const view = this.view;
    if (!view) throw new Error('EDITOR_NOT_READY: the editor is not mounted');
    if (view.composing) {
      throw new Error('IME_COMPOSITION_ACTIVE: finish the current word before saving');
    }

    return captureTransaction({
      doc: view.state.doc,
      origins: getBlockOrigins(view.state),
      document: this.document,
      pristine: this.pristine,
    });
  }

  /**
   * Adopt a newly saved document as the clean baseline.
   *
   * The editor keeps the user's current content and undo history; only the
   * provenance is re-pointed, so a save never interrupts typing.
   */
  commit(document: NotoDocumentWire): void {
    const view = this.view;
    if (!view) return;

    this.document = document;
    // Slice the block text out of the accepted document rather than parsing it
    // again. Main already worked out where every block sits and sent the
    // offsets, so a save no longer costs a full parse in the renderer too.
    this.pristine = new Map();
    view.state.doc.forEach((node, _offset, index) => {
      const origin = document.origins[index];
      const span = document.spans[index];
      if (!origin || !span) return;
      this.pristine.set(origin.blockId, {
        node,
        markdown: toLf(document.text.slice(span.start, span.end)),
      });
    });

    this.baselineDoc = view.state.doc;
    view.dispatch(rebaseOrigins(view.state.tr, document.origins));

    if (this.dirty) {
      this.dirty = false;
      this.options.onDirtyChange?.(false);
    }
  }

  /** Replace the whole document, for example after an external file change. */
  reload(document: NotoDocumentWire): void {
    const view = this.view;
    if (!view) return;
    this.document = document;
    const doc = this.buildDoc(document);
    this.baselineDoc = doc;
    view.updateState(EditorState.create({ doc, plugins: this.plugins(document) }));
    if (this.dirty) {
      this.dirty = false;
      this.options.onDirtyChange?.(false);
    }
  }

  destroy(): void {
    this.view?.destroy();
    this.view = null;
    this.pristine = new Map();
  }
}

export { notoSchema };
