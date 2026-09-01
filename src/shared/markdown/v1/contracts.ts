export const NOTO_MARKDOWN_CONTRACT_VERSION = 1 as const;

export type NotoDocumentIdV1 = string & { readonly __notoDocumentIdV1: unique symbol };
export type NotoRevisionIdV1 = string & { readonly __notoRevisionIdV1: unique symbol };
export type NotoBlockIdV1 = string & { readonly __notoBlockIdV1: unique symbol };
export type NotoSliceIdV1 = string & { readonly __notoSliceIdV1: unique symbol };

export type NotoLineEndingV1 = 'none' | 'lf' | 'crlf' | 'mixed';
export type NotoBlockKindV1 =
  | 'heading'
  | 'paragraph'
  | 'bullet-list'
  | 'ordered-list'
  | 'task-list'
  | 'quote'
  | 'callout'
  | 'fenced-code'
  | 'table'
  | 'display-math'
  | 'frontmatter'
  | 'html'
  | 'extension'
  | 'unsupported';

export interface NotoMarkdownEnvelopeV1 {
  readonly version: typeof NOTO_MARKDOWN_CONTRACT_VERSION;
  readonly byteLength: number;
  readonly bom: 'utf8' | 'none';
  readonly lineEnding: NotoLineEndingV1;
  readonly hasFinalNewline: boolean;
  readonly sourceSha256: string;
}

export interface NotoSourceSliceV1 {
  readonly version: typeof NOTO_MARKDOWN_CONTRACT_VERSION;
  readonly id: NotoSliceIdV1;
  readonly role: 'bom' | 'block' | 'gap';
  readonly startByte: number;
  readonly endByte: number;
  readonly sha256: string;
  readonly bytes: Uint8Array;
  readonly blockId?: NotoBlockIdV1;
}

export type NotoInlineV1 =
  | { readonly type: 'text'; readonly value: string }
  | { readonly type: 'emphasis' | 'strong' | 'code' | 'math'; readonly value: string }
  | { readonly type: 'link' | 'image'; readonly label: string; readonly destination: string };

export type NotoBlockSemanticV1 =
  | { readonly type: 'heading'; readonly depth: number; readonly inline: readonly NotoInlineV1[] }
  | { readonly type: 'paragraph'; readonly inline: readonly NotoInlineV1[] }
  | { readonly type: 'list'; readonly ordered: boolean; readonly task: boolean; readonly itemCount: number; readonly maxDepth: number; readonly source: string }
  | { readonly type: 'quote'; readonly callout: boolean; readonly source: string }
  | { readonly type: 'code'; readonly fence: '`' | '~'; readonly fenceLength: number; readonly info: string; readonly value: string }
  | { readonly type: 'table'; readonly columns: number; readonly rows: number; readonly source: string }
  | { readonly type: 'math'; readonly display: true; readonly value: string };

export interface NotoOpaqueNodeV1 {
  readonly type: 'opaque';
  readonly syntax: 'frontmatter' | 'html' | 'extension' | 'unsupported';
  readonly reason: 'source-only-v1';
  readonly sourceSha256: string;
  readonly executable: false;
}

export interface NotoSemanticBlockV1 {
  readonly version: typeof NOTO_MARKDOWN_CONTRACT_VERSION;
  readonly id: NotoBlockIdV1;
  readonly kind: NotoBlockKindV1;
  readonly sourceSliceId: NotoSliceIdV1;
  readonly editable: boolean;
  readonly semantic: NotoBlockSemanticV1 | NotoOpaqueNodeV1;
  readonly semanticKey: string;
  readonly projectionMarkdown: string;
}

export interface NotoMarkdownDocumentV1 {
  readonly version: typeof NOTO_MARKDOWN_CONTRACT_VERSION;
  readonly documentId: NotoDocumentIdV1;
  readonly revisionId: NotoRevisionIdV1;
  readonly envelope: NotoMarkdownEnvelopeV1;
  readonly originalBytes: Uint8Array;
  readonly slices: readonly NotoSourceSliceV1[];
  readonly blocks: readonly NotoSemanticBlockV1[];
}

export interface NotoEditorProjectionV1 {
  readonly version: typeof NOTO_MARKDOWN_CONTRACT_VERSION;
  readonly documentId: NotoDocumentIdV1;
  readonly revisionId: NotoRevisionIdV1;
  readonly markdown: string;
  readonly blocks: readonly Pick<NotoSemanticBlockV1, 'id' | 'kind' | 'editable' | 'semanticKey'>[];
}

export interface NotoDocumentIdentityMapV1 {
  readonly version: typeof NOTO_MARKDOWN_CONTRACT_VERSION;
  readonly documentId: NotoDocumentIdV1;
  readonly revisionId: NotoRevisionIdV1;
  readonly blocks: readonly Pick<NotoSemanticBlockV1, 'id' | 'kind' | 'editable' | 'semanticKey'>[];
}

export interface NotoBlockEditV1 {
  readonly version: typeof NOTO_MARKDOWN_CONTRACT_VERSION;
  readonly documentId: NotoDocumentIdV1;
  readonly revisionId: NotoRevisionIdV1;
  readonly blockId: NotoBlockIdV1;
  readonly expectedKind: NotoBlockKindV1;
  readonly markdown: string;
  readonly expectedSemanticKey: string;
}

export interface NotoUntouchedSliceProofV1 {
  readonly sliceId: NotoSliceIdV1;
  readonly beforeSha256: string;
  readonly afterSha256: string;
  readonly byteIdentical: true;
}

export interface NotoSerializationSuccessV1 {
  readonly status: 'serialized';
  readonly version: typeof NOTO_MARKDOWN_CONTRACT_VERSION;
  readonly documentId: NotoDocumentIdV1;
  readonly fromRevisionId: NotoRevisionIdV1;
  readonly outputBytes: Uint8Array;
  readonly outputSha256: string;
  readonly deterministic: true;
  readonly semanticReparseEquivalent: true;
  readonly editedBlockId: NotoBlockIdV1 | null;
  readonly editedBlockIdentityPolicy: 'preserved-within-document-v1';
  readonly untouchedSlices: readonly NotoUntouchedSliceProofV1[];
  readonly document: NotoMarkdownDocumentV1;
  readonly projection: NotoEditorProjectionV1;
}

export type NotoProjectionFailureCodeV1 =
  | 'INVALID_UTF8'
  | 'MIXED_LINE_ENDINGS'
  | 'MALFORMED_BOUNDARY'
  | 'EMPTY_DOCUMENT'
  | 'WRONG_DOCUMENT'
  | 'STALE_REVISION'
  | 'UNKNOWN_BLOCK'
  | 'DUPLICATE_BLOCK_EDIT'
  | 'UNSUPPORTED_OPAQUE_EDIT'
  | 'BLOCK_KIND_CHANGED'
  | 'SEMANTIC_MISMATCH'
  | 'STRUCTURE_CHANGED'
  | 'DOCUMENT_INTEGRITY_FAILED'
  | 'UNSUPPORTED_VERSION';

export interface NotoProjectionFallbackV1 {
  readonly status: 'fallback';
  readonly version: typeof NOTO_MARKDOWN_CONTRACT_VERSION;
  readonly code: Extract<NotoProjectionFailureCodeV1, 'INVALID_UTF8' | 'MIXED_LINE_ENDINGS' | 'MALFORMED_BOUNDARY' | 'EMPTY_DOCUMENT'>;
  readonly message: string;
  readonly originalBytes: Uint8Array;
  readonly sourceOnly: true;
}

export interface NotoSerializationFailureV1 {
  readonly status: 'failed';
  readonly version: typeof NOTO_MARKDOWN_CONTRACT_VERSION;
  readonly code: Exclude<NotoProjectionFailureCodeV1, NotoProjectionFallbackV1['code']>;
  readonly message: string;
  readonly originalBytes: Uint8Array;
}

export type NotoProjectionResultV1 =
  | { readonly status: 'projected'; readonly document: NotoMarkdownDocumentV1; readonly projection: NotoEditorProjectionV1 }
  | NotoProjectionFallbackV1;

export type NotoSerializationResultV1 = NotoSerializationSuccessV1 | NotoSerializationFailureV1;
