/**
 * Source Code Mode: the whole note as the text it is saved as.
 *
 * Typora's Command-slash. The rendered page goes and a plain column of
 * markdown takes its place, coloured the way a fence is coloured, and the
 * reader edits the text directly. What is typed here goes into the document
 * a moment after each pause, through the same block-wise replacement a
 * transform plugin uses, so the outline, the word count, the dirty mark and
 * autosave all keep working, and every block that was not touched still
 * saves byte for byte.
 *
 * A textarea does the editing, over a coloured copy of the same text drawn
 * underneath it. The textarea's own text is invisible and only its caret
 * shows, which is the oldest way to colour an input and the one that keeps
 * the input native: undo, the Chinese input method, drag selection and the
 * system's spelling all belong to the browser and none of them had to be
 * written.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Prism from 'prismjs';
import 'prismjs/components/prism-markup';
import 'prismjs/components/prism-markdown';
import { blockAtOffset, offsetOfBlock } from './source-lines';

/** Typing pauses this long before the document takes the text. */
const SETTLE_MS = 350;

export interface SourceModeProps {
  /** The text as the document holds it now. */
  readonly initialText: string;
  /** The block the caret was in, which is where the text opens. */
  readonly startBlock: number;
  /** Put the text into the document; true when anything changed. */
  readonly apply: (markdown: string) => boolean;
  /** Called when the mode is left, with the block the caret was in. */
  readonly onLeave: (block: number) => void;
  /** Lets the owner push pending text into the document before a save. */
  readonly registerFlush: (flush: (() => void) | null) => void;
}

export function SourceMode({ initialText, startBlock, apply, onLeave, registerFlush }: SourceModeProps) {
  const [text, setText] = useState(initialText);
  const textRef = useRef(text);
  textRef.current = text;
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const timer = useRef<number | null>(null);
  const pending = useRef<string | null>(null);

  const flush = useCallback(() => {
    if (timer.current !== null) { window.clearTimeout(timer.current); timer.current = null; }
    if (pending.current !== null) {
      const draft = pending.current;
      pending.current = null;
      apply(draft);
    }
  }, [apply]);

  useEffect(() => {
    registerFlush(flush);
    return () => registerFlush(null);
  }, [flush, registerFlush]);

  // The caret opens where the reader was, and the leave hands back where
  // they went. Ref-held so the unmount sees the last caret, not the first.
  const leaveRef = useRef(onLeave);
  leaveRef.current = onLeave;
  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    const at = offsetOfBlock(initialText, startBlock);
    input.focus();
    input.setSelectionRange(at, at);
    caret.current = at;
    // Scroll the caret's line into the middle rather than leaving it under
    // the fold: a textarea does not scroll to a programmatic selection.
    const lines = initialText.slice(0, at).split('\n').length - 1;
    const lineHeight = parseFloat(getComputedStyle(input).lineHeight) || 22;
    const scroller = input.closest('.canvas-scroll');
    if (scroller instanceof HTMLElement) {
      scroller.scrollTop = Math.max(0, lines * lineHeight - scroller.clientHeight / 3);
    }
    // Only on mount: the text changes on every key, and the caret is the reader's after that.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Where the caret is, kept as it moves: by the time the unmount runs the
  // textarea has been let go and cannot be asked.
  const caret = useRef(0);
  const noteCaret = useCallback(() => {
    const input = inputRef.current;
    if (input) caret.current = input.selectionStart;
  }, []);

  useEffect(() => () => {
    // Leaving: whatever is still pending goes in, then the caret's block is
    // handed back so the rendered document opens at the same place.
    const at = caret.current;
    const draft = pending.current ?? textRef.current;
    if (timer.current !== null) window.clearTimeout(timer.current);
    if (pending.current !== null) { pending.current = null; apply(draft); }
    leaveRef.current(blockAtOffset(draft, at));
    // Mount and unmount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onChange = useCallback((next: string) => {
    setText(next);
    pending.current = next;
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      if (pending.current !== null) {
        const draft = pending.current;
        pending.current = null;
        apply(draft);
      }
    }, SETTLE_MS);
  }, [apply]);

  // Coloured the way a fence is: the same grammar library, the markdown
  // grammar, and a trailing newline so the last empty line still has height.
  const html = useMemo(() => Prism.highlight(`${text}\n`, Prism.languages.markdown, 'markdown'), [text]);

  return (
    <div className="noto-source" data-testid="source-mode">
      <pre className="noto-source-highlight" aria-hidden="true" dangerouslySetInnerHTML={{ __html: html }} />
      <textarea
        ref={inputRef}
        className="noto-source-input"
        data-testid="source-input"
        aria-label="Markdown source"
        value={text}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        wrap="soft"
        onChange={(event) => { onChange(event.target.value); noteCaret(); }}
        onSelect={noteCaret}
        onKeyUp={noteCaret}
        onMouseUp={noteCaret}
        onKeyDown={(event) => {
          // Tab is an indent here, not the next control: the text is the
          // point of the mode. Through the command so it stays undoable.
          if (event.key === 'Tab' && !event.metaKey && !event.ctrlKey && !event.altKey) {
            event.preventDefault();
            document.execCommand('insertText', false, '  ');
          }
        }}
      />
    </div>
  );
}
