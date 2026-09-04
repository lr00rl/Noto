/**
 * Raw HTML on screen, and the one case where it shows a picture.
 *
 * HTML in a note is kept as source and never rendered live. The block and
 * the inline node are drawn as their text in a quiet monospace face, which is
 * honest and is also what a reader expects of a thing they have to edit by
 * hand. The exception is a lone `<img>` tag, which the vault holds nine
 * hundred of: when the caret is elsewhere the tag is shown as the picture it
 * names, drawn through the same frame markdown images use, and when the
 * caret enters the block the source comes back, which is what Typora does.
 *
 * The source is never removed from the block, only hidden, so the editor's
 * view of the text, and the caret's path into it, are unchanged by the
 * picture in front of it.
 */

import { zoomedTag } from './image-tag';
import type { Node as ProseNode } from 'prosemirror-model';
import { TextSelection } from 'prosemirror-state';
import type { EditorView, NodeView } from 'prosemirror-view';
import { parseImageTag, type HtmlImage } from './html-image';
import type { ImageContext } from './image-source';
import { ImageFrame, type Picture, type Refreshable } from './image-view';

/**
 * Whether a block is nothing but an HTML comment.
 *
 * A comment is the one kind of raw HTML that says nothing to the reader: it is
 * a note to a person editing the source, or a marker some tool writes. The
 * author's vault is full of the second kind, `<!-- note-assistant:index:start
 * -->` around generated sections, and drawing each one as a bordered block of
 * source puts a grey slab in the middle of the prose for a line nobody reads.
 * Typora draws them quietly and so does this.
 *
 * Only a block that is entirely one comment counts. A comment with markup
 * after it is still markup, and hiding its frame would hide that too.
 */
export function isHtmlComment(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed.startsWith('<!--') || !trimmed.endsWith('-->')) return false;
  // No second comment inside it, or the block holds more than one thing and the
  // text between them is not a comment at all.
  return !trimmed.slice(4, -3).includes('-->');
}

const pictureOf = (tag: HtmlImage): Picture => ({
  src: tag.src,
  alt: tag.alt,
  title: tag.title,
  width: tag.width,
  height: tag.height,
  zoom: tag.zoom,
  styleWidth: tag.styleWidth,
});

export class HtmlBlockView implements NodeView {
  readonly dom: HTMLElement;
  readonly contentDOM: HTMLElement;
  private readonly preview: HTMLElement;
  private readonly frame: ImageFrame;

  constructor(
    private node: ProseNode,
    private readonly view: EditorView,
    private readonly getPos: () => number | undefined,
    context: () => ImageContext,
    registry: Set<Refreshable>,
  ) {
    this.dom = document.createElement('div');
    this.dom.className = 'noto-html-block';
    this.contentDOM = document.createElement('div');
    this.contentDOM.className = 'noto-html-source';
    this.frame = new ImageFrame(context, registry);
    this.preview = document.createElement('div');
    this.preview.className = 'noto-html-preview';
    this.preview.contentEditable = 'false';
    this.preview.append(this.frame.dom);
    // A press on the picture puts the caret in the source behind it, which
    // is how the tag is edited: the block becomes the active one and shows
    // its text.
    this.preview.addEventListener('mousedown', (event) => {
      event.preventDefault();
      const base = this.getPos();
      if (base === undefined) return;
      const { state } = this.view;
      this.view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, base + 1)));
      this.view.focus();
    });
    this.dom.append(this.contentDOM);
    this.render();
  }

  update(node: ProseNode): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.render();
    return true;
  }

  /** Only the source is the editor's. */
  ignoreMutation(mutation: MutationRecord | { type: 'selection'; target: Node }): boolean {
    return !this.contentDOM.contains(mutation.target);
  }

  stopEvent(event: Event): boolean {
    return event.target instanceof Node && this.preview.contains(event.target);
  }

  destroy(): void {
    this.frame.destroy();
  }

  private render(): void {
    // Said quietly rather than drawn as a slab of source. The text is still
    // there and still editable; only its frame is dropped.
    this.dom.dataset.comment = String(isHtmlComment(this.node.textContent));
    const tag = parseImageTag(this.node.textContent);
    if (tag) {
      this.frame.render(pictureOf(tag));
      if (!this.preview.isConnected) this.dom.append(this.preview);
      this.dom.dataset.preview = 'image';
    } else {
      this.preview.remove();
      this.dom.dataset.preview = 'none';
    }
  }
}

export class InlineHtmlView implements NodeView {
  readonly dom: HTMLElement;
  private readonly source: HTMLElement;
  private readonly preview: HTMLElement;
  private readonly frame: ImageFrame;

  constructor(
    private node: ProseNode,
    private readonly view: EditorView,
    private readonly getPos: () => number | undefined,
    context: () => ImageContext,
    registry: Set<Refreshable>,
  ) {
    this.dom = document.createElement('span');
    this.dom.className = 'noto-inline-html';
    this.source = document.createElement('span');
    this.source.className = 'noto-inline-html-source';
    this.frame = new ImageFrame(context, registry);
    this.frame.resizer = {
      editable: () => this.view.editable,
      commit: (zoom) => {
        const pos = this.getPos();
        if (pos === undefined) return;
        const value = zoomedTag(this.node.attrs.value as string, zoom);
        if (value === null) return;
        this.view.dispatch(this.view.state.tr.setNodeMarkup(pos, undefined, { ...this.node.attrs, value }));
      },
    };
    this.preview = document.createElement('span');
    this.preview.className = 'noto-html-preview';
    this.preview.append(this.frame.dom);
    this.dom.append(this.source);
    this.render();
  }

  update(node: ProseNode): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.render();
    return true;
  }

  ignoreMutation(): boolean {
    return true;
  }

  destroy(): void {
    this.frame.destroy();
  }

  private render(): void {
    const value = this.node.attrs.value as string;
    this.source.textContent = value;
    const tag = parseImageTag(value);
    if (tag) {
      this.frame.render(pictureOf(tag));
      if (!this.preview.isConnected) this.dom.append(this.preview);
      this.dom.dataset.preview = 'image';
    } else {
      this.preview.remove();
      this.dom.dataset.preview = 'none';
    }
  }
}

export function htmlNodeViews(registry: Set<Refreshable>, context: () => ImageContext) {
  return {
    html_block: (node: ProseNode, view: EditorView, getPos: () => number | undefined) =>
      new HtmlBlockView(node, view, getPos, context, registry),
    inline_html: (node: ProseNode, view: EditorView, getPos: () => number | undefined) =>
      new InlineHtmlView(node, view, getPos, context, registry),
  };
}
