import { createHash } from 'node:crypto';
import { projectMarkdownV1 } from '../v1/core';
import type { NotoBlockKindV1, NotoMarkdownDocumentV1, NotoSourceSliceV1 } from '../v1/contracts';
import {
  NOTO_MARKDOWN_EDITING_VERSION,
  type NotoBlockOriginV2,
  type NotoEditableBlockKindV2,
  type NotoEditingFailureCodeV2,
  type NotoEditingFailureV2,
  type NotoEditingIdentityV2,
  type NotoEditingProjectionV2,
  type NotoEditingResultV2,
  type NotoEditingTransactionV2,
  type NotoPreservedSliceV2,
} from './contracts';

type AcceptedProjection = {
  readonly document: NotoMarkdownDocumentV1;
  readonly documentId: NotoEditingProjectionV2['documentId'];
  readonly sourceBlockIds: ReadonlyMap<string, string>;
};
const accepted = new WeakMap<NotoEditingProjectionV2, AcceptedProjection>();
const editableKinds: ReadonlySet<NotoBlockKindV1> = new Set<NotoEditableBlockKindV2>(
  ['heading', 'paragraph', 'bullet-list', 'ordered-list', 'quote', 'fenced-code'],
);
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const sha256 = (value: Uint8Array | string): string => createHash('sha256').update(value).digest('hex');

function blockSlice(document: NotoMarkdownDocumentV1, blockId: string): NotoSourceSliceV1 {
  const slice = document.slices.find((candidate) => candidate.blockId === blockId);
  if (!slice) throw new Error(`Missing accepted source slice for ${blockId}`);
  return slice;
}

function acceptedBlockSlice(projection: AcceptedProjection, blockId: string): NotoSourceSliceV1 {
  return blockSlice(projection.document, projection.sourceBlockIds.get(blockId) ?? blockId);
}

function textOf(slice: NotoSourceSliceV1): string {
  return decoder.decode(slice.bytes);
}

function projectionFrom(document: NotoMarkdownDocumentV1, documentId = document.documentId,
  blockIds?: readonly (NotoBlockOriginV2['blockId'] | null)[],
  preservedOriginIds?: readonly (NotoBlockOriginV2['blockId'] | null)[],
  revisionId = document.revisionId): NotoEditingProjectionV2 {
  const sourceBlockIds = new Map<string, string>();
  const blocks = document.blocks.map((block, ordinal) => {
    const id = blockIds?.[ordinal] ?? block.id;
    const originId = preservedOriginIds?.[ordinal] ?? block.id;
    sourceBlockIds.set(id, block.id);
    sourceBlockIds.set(originId, block.id);
    return {
    id,
    kind: block.kind,
    editable: editableKinds.has(block.kind),
    semanticKey: block.semanticKey,
    markdown: textOf(blockSlice(document, block.id)),
    origin: { blockId: originId, ordinal, kind: block.kind, semanticKey: block.semanticKey },
  };
  });
  const projection: NotoEditingProjectionV2 = {
    version: 2,
    documentId,
    revisionId,
    envelope: { ...document.envelope },
    markdown: blocks.map((block) => block.markdown).join('\n\n'),
    sourceBytes: document.originalBytes.slice(),
    blocks,
  };
  accepted.set(projection, { document, documentId, sourceBlockIds });
  return projection;
}

export function projectMarkdownV2(input: Uint8Array): NotoEditingProjectionV2 | NotoEditingFailureV2 {
  const projected = projectMarkdownV1(input);
  if (projected.status !== 'projected') {
    return { status: 'failed', version: 2, code: 'INVALID_FULL_SOURCE', message: projected.message,
      originalBytes: Uint8Array.from(input) };
  }
  return projectionFrom(projected.document);
}

export function identityOfProjectionV2(projection: NotoEditingProjectionV2): NotoEditingIdentityV2 {
  return { version: 2, documentId: projection.documentId, revisionId: projection.revisionId,
    sourceSha256: projection.envelope.sourceSha256, blocks: projection.blocks.map((block) => ({ ...block.origin })) };
}

export function rebindMarkdownIdentityV2(
  projection: NotoEditingProjectionV2,
  identity: NotoEditingIdentityV2,
  displayBlockIds: readonly NotoBlockOriginV2['blockId'][],
): NotoEditingProjectionV2 | null {
  const acceptedProjection = accepted.get(projection);
  if (!acceptedProjection) return null;
  const { document } = acceptedProjection;
  if (projection.version !== NOTO_MARKDOWN_EDITING_VERSION
    || identity.version !== NOTO_MARKDOWN_EDITING_VERSION
    || !identity.documentId.startsWith('noto-doc-v1:')
    || !identity.revisionId.startsWith('noto-rev-v1:')
    || identity.revisionId !== document.revisionId
    || identity.sourceSha256 !== document.envelope.sourceSha256
    || projection.documentId !== document.documentId
    || projection.revisionId !== document.revisionId
    || projection.envelope.sourceSha256 !== document.envelope.sourceSha256
    || projection.blocks.length !== document.blocks.length
    || identity.blocks.length !== document.blocks.length
    || displayBlockIds.length !== document.blocks.length) return null;

  const displayIds = new Set<string>();
  const originIds = new Set<string>();
  for (let index = 0; index < document.blocks.length; index += 1) {
    const source = document.blocks[index];
    const projected = projection.blocks[index];
    const origin = identity.blocks[index];
    const displayId = displayBlockIds[index];
    if (!projected || !origin || !displayId
      || projected.id !== source.id
      || projected.origin.blockId !== source.id
      || projected.origin.ordinal !== index
      || projected.kind !== source.kind
      || projected.semanticKey !== source.semanticKey
      || !displayId.startsWith('noto-block-v1:')
      || displayIds.has(displayId)
      || !origin.blockId.startsWith('noto-block-v1:')
      || originIds.has(origin.blockId)
      || origin.ordinal !== index
      || origin.kind !== source.kind
      || origin.semanticKey !== source.semanticKey) return null;
    displayIds.add(displayId);
    originIds.add(origin.blockId);
  }

  return projectionFrom(document, identity.documentId, displayBlockIds,
    identity.blocks.map((origin) => origin.blockId), identity.revisionId);
}

function fail(document: NotoMarkdownDocumentV1, code: NotoEditingFailureCodeV2, message: string): NotoEditingFailureV2 {
  return { status: 'failed', version: 2, code, message, originalBytes: document.originalBytes.slice() };
}

function sameOrigin(left: NotoBlockOriginV2, right: NotoBlockOriginV2): boolean {
  return left.blockId === right.blockId && left.ordinal === right.ordinal && left.kind === right.kind
    && left.semanticKey === right.semanticKey;
}

function normalizeBlock(markdown: string, lineEnding: '\n' | '\r\n'): Uint8Array {
  return encoder.encode(markdown.replaceAll('\r\n', '\n').replaceAll('\r', '\n').replaceAll('\n', lineEnding));
}

function canonicalGap(lineEnding: '\n' | '\r\n'): Uint8Array {
  return encoder.encode(lineEnding + lineEnding);
}

function exactUnit(bytes: Uint8Array): { kind: NotoBlockKindV1; semanticKey: string } | null {
  const parsed = projectMarkdownV1(bytes);
  if (parsed.status !== 'projected' || parsed.document.blocks.length !== 1
    || parsed.document.slices.some((slice) => slice.role === 'gap')) return null;
  return { kind: parsed.document.blocks[0].kind, semanticKey: parsed.document.blocks[0].semanticKey };
}

function preserved(slice: NotoSourceSliceV1): NotoPreservedSliceV2 {
  return { sliceId: slice.id, sha256: slice.sha256, role: slice.role, byteIdentical: true };
}

export function serializeMarkdownV2(projection: NotoEditingProjectionV2,
  transaction: NotoEditingTransactionV2): NotoEditingResultV2 {
  const acceptedProjection = accepted.get(projection);
  if (!acceptedProjection) return { status: 'failed', version: 2, code: 'DOCUMENT_INTEGRITY_FAILED',
    message: 'The projection was not issued by the accepted v2 projector.', originalBytes: new Uint8Array() };
  const { document, documentId } = acceptedProjection;
  if (projection.version !== 2 || transaction.version !== 2) return fail(document, 'UNSUPPORTED_VERSION', 'All editing discriminants must be v2.');
  if (transaction.documentId !== documentId) return fail(document, 'WRONG_DOCUMENT', 'The transaction belongs to another document.');
  if (transaction.revisionId !== document.revisionId) return fail(document, 'STALE_REVISION', 'The transaction revision is stale.');

  if (transaction.mode === 'source') {
    if (transaction.expectedSourceSha256 !== document.envelope.sourceSha256) return fail(document, 'STALE_REVISION', 'The full-source base hash is stale.');
    const reparsedResult = projectMarkdownV1(transaction.sourceBytes);
    if (reparsedResult.status !== 'projected') return fail(document, 'INVALID_FULL_SOURCE', reparsedResult.message);
    const reparsed = projectionFrom(reparsedResult.document, documentId);
    const output = transaction.sourceBytes.slice();
    return { status: 'serialized', version: 2, outputBytes: output, outputSha256: sha256(output), deterministic: true,
      semanticReparseEquivalent: true, projection: reparsed, identity: identityOfProjectionV2(reparsed), preservedSlices: [] };
  }

  const originalOrigins = projection.blocks.map((block) => block.origin);
  const seen = new Set<string>();
  let lastOrdinal = -1;
  for (const unit of transaction.blocks) {
    if (!unit.markdown.length) return fail(document, 'EMPTY_BLOCK', 'An ordered editing unit cannot be empty. Delete it from the ordered list instead.');
    if (!unit.origin) continue;
    const expected = originalOrigins[unit.origin.ordinal];
    if (!expected || !sameOrigin(expected, unit.origin)) return fail(document, 'FORGED_ORIGIN', 'A transaction origin does not match the accepted projection.');
    if (seen.has(unit.origin.blockId)) return fail(document, 'DUPLICATE_ORIGIN', 'An accepted origin may occur only once.');
    if (unit.origin.ordinal <= lastOrdinal) return fail(document, 'REORDERED_ORIGIN', 'Accepted origins must remain monotonic.');
    seen.add(unit.origin.blockId);
    lastOrdinal = unit.origin.ordinal;
  }

  const lineEnding = document.envelope.lineEnding === 'crlf' ? '\r\n' : '\n';
  const outputParts: Uint8Array[] = [];
  const proofs: NotoPreservedSliceV2[] = [];
  const bom = document.slices.find((slice) => slice.role === 'bom');
  if (bom) { outputParts.push(bom.bytes); proofs.push(preserved(bom)); }
  let previousOrigin: NotoBlockOriginV2 | null = null;
  for (let index = 0; index < transaction.blocks.length; index += 1) {
    const unit = transaction.blocks[index];
    if (index > 0) {
      const gap = unit.origin && previousOrigin && unit.origin.ordinal === previousOrigin.ordinal + 1
        ? document.slices.find((slice) => slice.role === 'gap'
          && slice.startByte === acceptedBlockSlice(acceptedProjection, previousOrigin!.blockId).endByte
          && slice.endByte === acceptedBlockSlice(acceptedProjection, unit.origin!.blockId).startByte)
        : undefined;
      if (gap) { outputParts.push(gap.bytes); proofs.push(preserved(gap)); }
      else outputParts.push(canonicalGap(lineEnding));
    } else if (unit.origin?.ordinal === 0) {
      const leading = document.slices.find((slice) => slice.role === 'gap'
        && slice.endByte === acceptedBlockSlice(acceptedProjection, unit.origin!.blockId).startByte);
      if (leading) { outputParts.push(leading.bytes); proofs.push(preserved(leading)); }
    }
    let bytes = normalizeBlock(unit.markdown, lineEnding);
    if (unit.origin) {
      const source = acceptedBlockSlice(acceptedProjection, unit.origin.blockId);
      const sourceText = textOf(source);
      const originalBlock = projection.blocks[unit.origin.ordinal];
      if (!originalBlock.editable && unit.markdown !== sourceText) return fail(document, 'OPAQUE_SOURCE_CHANGED', 'Source-only blocks require a validated full-source transaction.');
      if (unit.markdown === sourceText) { bytes = source.bytes; proofs.push(preserved(source)); }
    }
    const parsedUnit = exactUnit(bytes);
    if (!parsedUnit) return fail(document, 'MULTI_BLOCK_UNIT', 'Each ordered editing unit must reparse as exactly one block.');
    if (!unit.origin && !editableKinds.has(parsedUnit.kind)) {
      return fail(document, 'OPAQUE_SOURCE_INSERTED',
        'New source-only blocks require a validated full-source transaction.');
    }
    outputParts.push(bytes);
    previousOrigin = unit.origin;
  }

  const last = transaction.blocks.at(-1)?.origin;
  const lastOriginal = originalOrigins.at(-1);
  if (last && lastOriginal && last.ordinal === lastOriginal.ordinal) {
    const trailing = document.slices.find((slice) => slice.role === 'gap'
      && slice.startByte === acceptedBlockSlice(acceptedProjection, last.blockId).endByte);
    if (trailing) { outputParts.push(trailing.bytes); proofs.push(preserved(trailing)); }
  } else if (document.envelope.hasFinalNewline && transaction.blocks.length > 0) {
    outputParts.push(encoder.encode(lineEnding));
  }
  const output = Buffer.concat(outputParts.map((part) => Buffer.from(part)));
  const reparsedResult = projectMarkdownV1(output);
  if (reparsedResult.status !== 'projected') return fail(document, 'REPARSE_MISMATCH', reparsedResult.message);
  const blockIds = transaction.blocks.map((unit) => unit.origin
    ? projection.blocks[unit.origin.ordinal]?.id ?? null
    : null);
  const preservedOriginIds = transaction.blocks.map((unit) => {
    if (!unit.origin) return null;
    const original = projection.blocks[unit.origin.ordinal];
    return original?.markdown === unit.markdown ? unit.origin.blockId : null;
  });
  // Keep display block IDs for surviving units, while rebasing origins only
  // for byte-unchanged units. The accepted projection maps each ID to its
  // newly accepted physical slice for the next transaction.
  const reparsed = projectionFrom(reparsedResult.document, documentId, blockIds, preservedOriginIds);
  if (reparsed.blocks.length !== transaction.blocks.length) return fail(document, 'REPARSE_MISMATCH', 'The serialized block count differs from the ordered transaction.');
  for (let index = 0; index < reparsed.blocks.length; index += 1) {
    const expected = exactUnit(normalizeBlock(transaction.blocks[index].markdown, lineEnding));
    if (!expected || reparsed.blocks[index].kind !== expected.kind || reparsed.blocks[index].semanticKey !== expected.semanticKey) {
      return fail(document, 'REPARSE_MISMATCH', `The serialized semantic unit at index ${index} differs from the transaction.`);
    }
  }
  return { status: 'serialized', version: 2, outputBytes: output, outputSha256: sha256(output), deterministic: true,
    semanticReparseEquivalent: true, projection: reparsed, identity: identityOfProjectionV2(reparsed), preservedSlices: proofs };
}
