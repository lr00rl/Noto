import type {
  NotoBlockIdV1,
  NotoBlockKindV1,
  NotoDocumentIdV1,
  NotoMarkdownEnvelopeV1,
  NotoRevisionIdV1,
} from '../v1/contracts';

export const NOTO_MARKDOWN_EDITING_VERSION = 2 as const;

export type NotoEditableBlockKindV2 = Extract<NotoBlockKindV1,
  'heading' | 'paragraph' | 'bullet-list' | 'ordered-list' | 'quote' | 'fenced-code'>;

export interface NotoBlockOriginV2 {
  readonly blockId: NotoBlockIdV1;
  readonly ordinal: number;
  readonly kind: NotoBlockKindV1;
  readonly semanticKey: string;
}

export interface NotoEditingBlockV2 {
  readonly id: NotoBlockIdV1;
  readonly kind: NotoBlockKindV1;
  readonly editable: boolean;
  readonly semanticKey: string;
  readonly markdown: string;
  readonly origin: NotoBlockOriginV2;
}

export interface NotoEditingProjectionV2 {
  readonly version: typeof NOTO_MARKDOWN_EDITING_VERSION;
  readonly documentId: NotoDocumentIdV1;
  readonly revisionId: NotoRevisionIdV1;
  readonly envelope: NotoMarkdownEnvelopeV1;
  readonly markdown: string;
  /** Exact accepted bytes used only by the explicit full-source boundary. */
  readonly sourceBytes: Uint8Array;
  readonly blocks: readonly NotoEditingBlockV2[];
}

export interface NotoEditingIdentityV2 {
  readonly version: typeof NOTO_MARKDOWN_EDITING_VERSION;
  readonly documentId: NotoDocumentIdV1;
  readonly revisionId: NotoRevisionIdV1;
  readonly sourceSha256: string;
  readonly blocks: readonly NotoBlockOriginV2[];
}

export interface NotoTransactionBlockV2 {
  readonly origin: NotoBlockOriginV2 | null;
  readonly markdown: string;
}

export interface NotoBlockTransactionV2 {
  readonly version: typeof NOTO_MARKDOWN_EDITING_VERSION;
  readonly mode: 'blocks';
  readonly documentId: NotoDocumentIdV1;
  readonly revisionId: NotoRevisionIdV1;
  readonly blocks: readonly NotoTransactionBlockV2[];
}

export interface NotoFullSourceTransactionV2 {
  readonly version: typeof NOTO_MARKDOWN_EDITING_VERSION;
  readonly mode: 'source';
  readonly documentId: NotoDocumentIdV1;
  readonly revisionId: NotoRevisionIdV1;
  readonly expectedSourceSha256: string;
  readonly sourceBytes: Uint8Array;
}

export type NotoEditingTransactionV2 = NotoBlockTransactionV2 | NotoFullSourceTransactionV2;

export type NotoEditingFailureCodeV2 =
  | 'UNSUPPORTED_VERSION'
  | 'WRONG_DOCUMENT'
  | 'STALE_REVISION'
  | 'DOCUMENT_INTEGRITY_FAILED'
  | 'DUPLICATE_ORIGIN'
  | 'REORDERED_ORIGIN'
  | 'FORGED_ORIGIN'
  | 'EMPTY_BLOCK'
  | 'MULTI_BLOCK_UNIT'
  | 'OPAQUE_SOURCE_INSERTED'
  | 'OPAQUE_SOURCE_CHANGED'
  | 'INVALID_FULL_SOURCE'
  | 'REPARSE_MISMATCH';

export interface NotoEditingFailureV2 {
  readonly status: 'failed';
  readonly version: typeof NOTO_MARKDOWN_EDITING_VERSION;
  readonly code: NotoEditingFailureCodeV2;
  readonly message: string;
  readonly originalBytes: Uint8Array;
}

export interface NotoPreservedSliceV2 {
  readonly sliceId: string;
  readonly sha256: string;
  readonly role: 'bom' | 'block' | 'gap';
  readonly byteIdentical: true;
}

export interface NotoEditingSuccessV2 {
  readonly status: 'serialized';
  readonly version: typeof NOTO_MARKDOWN_EDITING_VERSION;
  readonly outputBytes: Uint8Array;
  readonly outputSha256: string;
  readonly deterministic: true;
  readonly semanticReparseEquivalent: true;
  readonly projection: NotoEditingProjectionV2;
  readonly identity: NotoEditingIdentityV2;
  readonly preservedSlices: readonly NotoPreservedSliceV2[];
}

export type NotoEditingResultV2 = NotoEditingSuccessV2 | NotoEditingFailureV2;
