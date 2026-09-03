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
import { imageFromTransfer } from './image-drop';
import { alertPlugin } from './alert-plugin';
import { typoraMarksPlugin } from './typora-marks-plugin';
import { typewriterPlugin } from './typewriter-plugin';
import { autoPairPlugin } from './auto-pair';
import { mathEditingPlugin, mathNodeViews } from './math-view';
import { tableNodeViews } from './table-view';
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
import { followLinkPlugin, linkEditorPlugin } from './link-plugin';
import { countWords, type DocumentCount } from './word-count';
import { sliceToMarkdown } from './clipboard';

/** How long after the last keystroke the document is counted. */
const COUNT_DELAY_MS = 400;

/* The three substitutions are booleans here and functions on the rules, which
   read them each time so a change of setting reaches an editor already open. */
export interface NotoEditorOptions extends Omit<InputRuleOptions, 'smartQuotes' | 'smartDashes' | 'smartEllipsis'> {
  readonly mac: boolean;
  /** Native spell checking, which the user can turn off in settings. */
  readonly spellCheck?: boolean;
  readonly onDirtyChange?: (dirty: boolean) => void;
  /** Fired for every transaction that changed the document. */
  readonly onDocumentChanged?: () => void;
  readonly onError?: (message: string) => void;
  /**
   * The index of the top level block the caret is in, when it changes.
   *
   * The outline uses it to say which heading you are under, which is the one
   * question a list of headings is asked while you are writing rather than
   * navigating.
   */
  readonly onActiveBlockChanged?: (index: number) => void;
  /** Cmd or Ctrl clicking an ordinary `[text](address)` link. */
  readonly onFollowLink?: (href: string) => void;
  /** The document's size, after typing has stopped rather than during it. */
  readonly onCountChanged?: (count: DocumentCount) => void;
  /** Cmd or Ctrl clicking a `[[wiki link]]`. Absent means links stay inert. */
  readonly onFollowWikiLink?: (target: string) => void;
  /** Where relative images resolve from, and whether web images load. */
  readonly images?: ImageContext;
  readonly smartQuotes?: boolean;
  readonly smartDashes?: boolean;
  readonly smartEllipsis?: boolean;
  /**
   * Hands pasted or dropped picture bytes to main, which decides where they go.
   *
   * Absent means a picture cannot be pasted, which is what a test harness with
   * no main process wants: the paste falls through to ProseMirror's own
   * handling rather than failing.
   */
  readonly onWriteImage?: (bytes: Uint8Array) => Promise<InsertedImage | null>;
}

/** What main says it wrote: the text for the brackets, and the alt for it. */
export interface InsertedImage {
  readonly reference: string;
  readonly alt: string;
}

export class NotoEditor implements NotoEditorPort {
  private view: EditorView | null = null;
  private document: NotoDocumentWire;
  private substitutions = { quotes: false, dashes: false, ellipsis: false };
  private typewriter = false;
  private autoPair = true;
  private activeBlock = -1;
  /* Bumped by every change, so a picture that arrives after the document moved
     under it is put where the caret is now rather than at a stale offset. */
  private docVersion = 0;
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
    this.substitutions = {
      quotes: options.smartQuotes === true,
      dashes: options.smartDashes === true,
      ellipsis: options.smartEllipsis === true,
    };
    this.imageContext = options.images ?? { documentDir: null, remote: true };

    const doc = this.buildDoc(document);
    this.baselineDoc = doc;

    this.view = new EditorView(host, {
      state: EditorState.create({ doc, plugins: this.plugins(document) }),
      dispatchTransaction: (transaction) => this.apply(transaction),
      attributes: { spellcheck: String(this.options.spellCheck ?? true) },
      // What leaves on the clipboard is the markdown, not the words without it.
      clipboardTextSerializer: (slice) => sliceToMarkdown(slice),
      handlePaste: (view, event) => this.handleTransfer(view, event.clipboardData, null),
      handleDrop: (view, event) => {
        const at = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos ?? null;
        return this.handleTransfer(view, (event as DragEvent).dataTransfer, at);
      },
      nodeViews: this.nodeViews(),
    });
    // The first count is for the document as opened, not for a change to it.
    this.scheduleCount();
  }

  private nodeViews() {
    return {
      ...mathNodeViews(),
      ...fenceNodeViews(),
      ...imageNodeViews(this.imageViews, () => this.imageContext),
      ...htmlNodeViews(this.imageViews, () => this.imageContext),
      ...tableNodeViews(),
    };
  }

  private plugins(document: NotoDocumentWire): Plugin[] {
    return [
      createOriginPlugin(document.origins),
      // A getter, not a value: the setting can change while the editor is open
      // and the rules must follow without the editor being rebuilt.
      notoInputRules({
        smartQuotes: () => this.substitutions.quotes,
        smartDashes: () => this.substitutions.dashes,
        smartEllipsis: () => this.substitutions.ellipsis,
      }),
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
      linkEditorPlugin(),
      followLinkPlugin({ onFollow: (href) => this.options.onFollowLink?.(href) }),
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

  private countTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * A paste or a drop that carries a picture.
   *
   * Returns true only when this took the event over. Everything else falls
   * through to ProseMirror, which handles ordinary text and HTML correctly and
   * should go on doing so.
   *
   * The write is asynchronous and the insertion happens after it, so the
   * position is captured now and used later only if the document has not moved
   * in between. That is the whole reason `docVersion` exists.
   */
  private handleTransfer(view: EditorView, data: DataTransfer | null, dropAt: number | null): boolean {
    const found = imageFromTransfer(data);
    if (!found) return false;

    const at = dropAt ?? view.state.selection.from;
    if (!this.canInsertImageAt(view, at)) {
      // Inside a fence or display maths the text is literal source and takes no
      // inline node at all, so say why rather than dropping the paste silently.
      this.options.onError?.('A picture cannot go here.');
      return true;
    }

    if (found.kind === 'remote') {
      this.insertImage({ reference: found.href, alt: '' }, at, this.docVersion);
      return true;
    }
    if (!this.options.onWriteImage) return false;

    const version = this.docVersion;
    void (async () => {
      try {
        const bytes = new Uint8Array(await found.file.arrayBuffer());
        const written = await this.options.onWriteImage?.(bytes);
        if (written) this.insertImage(written, at, version);
      } catch {
        this.options.onError?.('That picture could not be read.');
      }
    })();
    return true;
  }

  /** Whether an inline picture is allowed at `at`, which a fence does not allow. */
  private canInsertImageAt(view: EditorView, at: number): boolean {
    const $at = view.state.doc.resolve(at);
    return $at.parent.type.spec.code !== true
      && $at.parent.canReplaceWith($at.index(), $at.index(), notoSchema.nodes.image);
  }

  /**
   * Put the picture in.
   *
   * When the document changed while the bytes were being written, the captured
   * offset now points at different text, so the caret is used instead. Both are
   * better than writing into the middle of a word the reader has since typed.
   */
  private insertImage(image: InsertedImage, at: number, version: number): void {
    const view = this.view;
    if (!view) return;
    const target = version === this.docVersion ? at : view.state.selection.from;
    if (!this.canInsertImageAt(view, target)) {
      this.options.onError?.('A picture cannot go here.');
      return;
    }
    const node = notoSchema.nodes.image.create({
      src: image.reference,
      alt: image.alt,
      title: null,
      referenceType: null,
      identifier: '',
      label: '',
    });
    // Replacing the selection when the caret is where the picture goes, so
    // pasting over selected text behaves the way pasting anything else does.
    const transaction = target === view.state.selection.from
      ? view.state.tr.replaceSelectionWith(node, false)
      : view.state.tr.insert(target, node);
    view.dispatch(transaction.scrollIntoView());
    view.focus();
  }

  /** Insert a picture main already wrote, for the Insert Image menu command. */
  insertWrittenImage(image: InsertedImage): void {
    const view = this.view;
    if (!view) return;
    this.insertImage(image, view.state.selection.from, this.docVersion);
  }

  private apply(transaction: Transaction): void {
    const view = this.view;
    if (!view) return;
    view.updateState(view.state.apply(transaction));
    this.reportActiveBlock();
    if (!transaction.docChanged) return;
    this.docVersion += 1;
    this.refreshDirty();
    // Every change, not only the transition into dirty. Automatic saving has to
    // debounce against typing, and a flag that flips once at the first
    // keystroke cannot tell it when typing stopped.
    this.options.onDocumentChanged?.();
    this.scheduleCount();
  }

  /**
   * Count the document once typing has stopped.
   *
   * Never on the keystroke. A megabyte of prose takes about 37 milliseconds to
   * count, which is nothing to wait for after a pause and far too much to pay
   * for a letter. The timer restarts on every change, so a burst of typing
   * costs one count.
   */
  private scheduleCount(): void {
    if (!this.options.onCountChanged) return;
    if (this.countTimer !== null) clearTimeout(this.countTimer);
    this.countTimer = setTimeout(() => {
      this.countTimer = null;
      this.reportCount();
    }, COUNT_DELAY_MS);
  }

  private reportCount(): void {
    const view = this.view;
    if (!view || !this.options.onCountChanged) return;
    this.options.onCountChanged(countWords(view.state.doc.textBetween(0, view.state.doc.content.size, '\n', '\n')));
  }

  /** Told only when it changes: this runs on every transaction, typing included. */
  private reportActiveBlock(): void {
    const view = this.view;
    if (!view || !this.options.onActiveBlockChanged) return;
    const { $from } = view.state.selection;
    const index = $from.index(0);
    if (index === this.activeBlock) return;
    this.activeBlock = index;
    this.options.onActiveBlockChanged(index);
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
    smartQuotes?: boolean;
    smartDashes?: boolean;
    smartEllipsis?: boolean;
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
    if (settings.smartQuotes !== undefined) this.substitutions.quotes = settings.smartQuotes;
    if (settings.smartDashes !== undefined) this.substitutions.dashes = settings.smartDashes;
    if (settings.smartEllipsis !== undefined) this.substitutions.ellipsis = settings.smartEllipsis;
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
    if (this.countTimer !== null) clearTimeout(this.countTimer);
    this.countTimer = null;
    this.view?.destroy();
    this.view = null;
    this.pristine = new Map();
  }
}

export { notoSchema };
