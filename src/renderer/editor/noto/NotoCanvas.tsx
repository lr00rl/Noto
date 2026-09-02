/**
 * The writing surface.
 *
 * A thin React wrapper: ProseMirror owns the DOM inside the host element, so
 * React must never re-render into it. The editor is rebuilt only when the
 * document revision changes, which is why `revisionId` is the sole dependency.
 */

import { useEffect, useLayoutEffect, useRef } from 'react';
import { documentDirOf } from './image-source';
import type { NotoDocumentWire, NotoTransaction } from '../../../shared/markdown/v3/contracts';
import { NotoEditor } from './NotoEditor';

export interface NotoCanvasProps {
  readonly document: NotoDocumentWire;
  readonly mac: boolean;
  readonly smartTypography?: boolean;
  readonly spellCheck?: boolean;
  /** Where the document lives, so its relative images know where to start. */
  readonly documentPath: string | null;
  readonly remoteImages?: boolean;
  /** Keep the line being written at the middle of the window. */
  readonly typewriterMode?: boolean;
  readonly onDirtyChange: (dirty: boolean) => void;
  readonly onDocumentChanged?: () => void;
  readonly onFollowWikiLink?: (target: string) => void;
  readonly onReady: (editor: NotoEditor) => void;
  readonly onTeardown: (editor: NotoEditor) => void;
  readonly onError: (message: string) => void;
}

export function NotoCanvas({
  document,
  mac,
  smartTypography,
  spellCheck,
  documentPath,
  remoteImages,
  typewriterMode,
  onDirtyChange,
  onDocumentChanged,
  onFollowWikiLink,
  onReady,
  onTeardown,
  onError,
}: NotoCanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<NotoEditor | null>(null);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let editor: NotoEditor;
    try {
      editor = new NotoEditor(host, document, {
        mac,
        smartTypography,
        spellCheck,
        images: { documentDir: documentDirOf(documentPath), remote: remoteImages ?? true },
        onDirtyChange,
        onDocumentChanged,
        onFollowWikiLink,
        onError,
      });
    } catch (error) {
      onError(error instanceof Error ? error.message : 'The editor failed to start.');
      return;
    }

    editorRef.current = editor;
    onReady(editor);
    return () => {
      editorRef.current = null;
      onTeardown(editor);
      editor.destroy();
    };
    // Only a different document rebuilds the editor.
    //
    // Not the revision. Every save produces a new revision, so keying on it
    // tore down the editor each time the user pressed save, taking their undo
    // history, selection and scroll position with it. A new revision of the
    // same document is applied in place by `commit`, which is what that method
    // is for.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [document.documentId]);

  // Settings reach the running editor rather than rebuilding it, so changing a
  // preference never costs the user their undo history or cursor.
  useEffect(() => {
    editorRef.current?.applySettings({ smartTypography, spellCheck, remoteImages, typewriterMode });
  }, [smartTypography, spellCheck, remoteImages, typewriterMode]);

  return <div ref={hostRef} className="noto-editor-host" data-testid="noto-editor" />;
}

export type { NotoTransaction };
