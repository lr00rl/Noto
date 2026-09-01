import { createHash } from 'node:crypto';
import {
  NOTO_MARKDOWN_CONTRACT_VERSION,
  type NotoBlockEditV1,
  type NotoBlockIdV1,
  type NotoBlockKindV1,
  type NotoBlockSemanticV1,
  type NotoDocumentIdV1,
  type NotoDocumentIdentityMapV1,
  type NotoEditorProjectionV1,
  type NotoInlineV1,
  type NotoMarkdownDocumentV1,
  type NotoOpaqueNodeV1,
  type NotoProjectionFallbackV1,
  type NotoProjectionResultV1,
  type NotoRevisionIdV1,
  type NotoSemanticBlockV1,
  type NotoSerializationFailureV1,
  type NotoSerializationResultV1,
  type NotoSliceIdV1,
  type NotoSourceSliceV1,
} from './contracts';

const BOM = Uint8Array.from([0xef, 0xbb, 0xbf]);
const acceptedDocuments = new WeakMap<NotoMarkdownDocumentV1, NotoMarkdownDocumentV1>();

type SourceRange = { readonly role: 'block' | 'gap'; readonly source: string; readonly start: number; readonly end: number };
type ParsedBlock = { readonly kind: NotoBlockKindV1; readonly editable: boolean; readonly semantic: NotoBlockSemanticV1 | NotoOpaqueNodeV1 };
type Line = { readonly text: string; readonly start: number; readonly contentEnd: number; readonly end: number };

function digest(value: Uint8Array | string): string {
  return createHash('sha256').update(value).digest('hex');
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && left.every((value, index) => value === right[index]);
}

function decode(bytes: Uint8Array): string | null {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return null; }
}

function canonical(value: unknown): string {
  return JSON.stringify(value);
}

function hasVersionV1Discriminants(document: NotoMarkdownDocumentV1): boolean {
  return document.version === NOTO_MARKDOWN_CONTRACT_VERSION
    && document.envelope.version === NOTO_MARKDOWN_CONTRACT_VERSION
    && document.slices.every((slice) => slice.version === NOTO_MARKDOWN_CONTRACT_VERSION)
    && document.blocks.every((block) => block.version === NOTO_MARKDOWN_CONTRACT_VERSION);
}

function inline(source: string): readonly NotoInlineV1[] {
  const tokens: NotoInlineV1[] = [];
  const pattern = /(!?)\[([^\]]*)\]\(([^)]+)\)|(\*\*|__)(.+?)\4|(?<!\*)\*([^*]+)\*|(?<!_)_([^_]+)_|`([^`]+)`|\$([^$\n]+)\$/g;
  let offset = 0;
  for (const match of source.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > offset) tokens.push({ type: 'text', value: source.slice(offset, index) });
    if (match[1] !== undefined) tokens.push({ type: match[1] ? 'image' : 'link', label: match[2], destination: match[3] });
    else if (match[4]) tokens.push({ type: 'strong', value: match[5] });
    else if (match[6] ?? match[7]) tokens.push({ type: 'emphasis', value: match[6] ?? match[7] });
    else if (match[8]) tokens.push({ type: 'code', value: match[8] });
    else if (match[9]) tokens.push({ type: 'math', value: match[9] });
    offset = index + match[0].length;
  }
  if (offset < source.length) tokens.push({ type: 'text', value: source.slice(offset) });
  return tokens;
}

function opaque(kind: Extract<NotoBlockKindV1, 'frontmatter' | 'html' | 'extension' | 'unsupported'>, source: string): ParsedBlock {
  return { kind, editable: false, semantic: { type: 'opaque', syntax: kind, reason: 'source-only-v1', sourceSha256: digest(source), executable: false } };
}

function classifyIsolatedBlock(source: string): ParsedBlock | null {
  if (/^---(?:\r?\n)[\s\S]*(?:\r?\n)---$/.test(source)) return opaque('frontmatter', source);
  if (/^ {0,3}</.test(source)) return opaque('html', source);
  if (/^:::/.test(source)) {
    const lines = source.split(/\r?\n/);
    return lines.length >= 2 && lines.at(-1) === ':::' ? opaque('extension', source) : null;
  }
  if (/^(?: {4}|\t)|^\[\^[^\]]+\]:|^={3,}$|^-{3,}$|^\*{3,}$/.test(source)
    || /(?:\r?\n)(?:={3,}|-{3,})$/.test(source)) return opaque('unsupported', source);
  const fence = source.match(/^(`{3,}|~{3,})([^\r\n]*)(?:\r?\n)([\s\S]*)(?:\r?\n)\1$/);
  if (fence) return { kind: 'fenced-code', editable: true, semantic: { type: 'code', fence: fence[1][0] as '`' | '~', fenceLength: fence[1].length, info: fence[2].trim(), value: fence[3] } };
  if (/^(`{3,}|~{3,})/.test(source)) return null;
  const heading = source.match(/^(#{1,6})[ \t]+([^\r\n]+)$/);
  if (heading) return { kind: 'heading', editable: true, semantic: { type: 'heading', depth: heading[1].length, inline: inline(heading[2]) } };
  if (/^> \[![A-Za-z0-9_-]+\]/.test(source)) return { kind: 'callout', editable: true, semantic: { type: 'quote', callout: true, source } };
  if (/^>/.test(source)) return { kind: 'quote', editable: true, semantic: { type: 'quote', callout: false, source } };
  if (/^(?:[ \t]*[-+*][ \t]+)/m.test(source)) {
    const items = source.split(/\r?\n/).filter((line) => /^[ \t]*[-+*][ \t]+/.test(line));
    const task = items.some((line) => /^[ \t]*[-+*][ \t]+\[[ xX]\][ \t]+/.test(line));
    return { kind: task ? 'task-list' : 'bullet-list', editable: true, semantic: { type: 'list', ordered: false, task, itemCount: items.length, maxDepth: listDepth(items), source } };
  }
  if (/^[ \t]*\d+[.)][ \t]+/m.test(source)) {
    const items = source.split(/\r?\n/).filter((line) => /^[ \t]*\d+[.)][ \t]+/.test(line));
    return { kind: 'ordered-list', editable: true, semantic: { type: 'list', ordered: true, task: false, itemCount: items.length, maxDepth: listDepth(items), source } };
  }
  const lines = source.split(/\r?\n/);
  if (lines.length >= 2 && lines[0].includes('|') && /^\s*\|?\s*:?-{3,}/.test(lines[1])) {
    const columns = lines[0].split('|').filter((cell) => cell.trim()).length;
    return { kind: 'table', editable: true, semantic: { type: 'table', columns, rows: Math.max(0, lines.length - 2), source } };
  }
  if (/^\$\$(?:\r?\n)[\s\S]*(?:\r?\n)\$\$$/.test(source)) return { kind: 'display-math', editable: true, semantic: { type: 'math', display: true, value: source.replace(/^\$\$(?:\r?\n)|(?:\r?\n)\$\$$/g, '') } };
  if (/^(?:#{1,6}(?![ \t])|\[[^\]]+\]:|!\[[^\]]*\]:|\|?\s*:?-{3,})/.test(source)) return opaque('unsupported', source);
  if (source.split(/\r?\n/).some((line) => /^(?:\?{3,}|:{2,}|\{\{|\}\}|\[\^[^\]]*|\[[^\]]+\]:|!\[[^\]]+\]:)/.test(line))
    || (source.match(/`/g)?.length ?? 0) % 2 !== 0
    || (source.match(/\$/g)?.length ?? 0) % 2 !== 0) return opaque('unsupported', source);
  if (source.split(/\r?\n/).some((line) => !/^ {0,3}(?:[\p{L}\p{N}"'“‘(（]|[*_`$]|\[|!\[)/u.test(line))) return opaque('unsupported', source);
  return { kind: 'paragraph', editable: true, semantic: { type: 'paragraph', inline: inline(source) } };
}

function fallback(code: NotoProjectionFallbackV1['code'], message: string, originalBytes: Uint8Array): NotoProjectionFallbackV1 {
  return { status: 'fallback', version: 1, code, message, originalBytes: originalBytes.slice(), sourceOnly: true };
}

function linesOf(text: string, token: '\n' | '\r\n' | ''): Line[] {
  if (token === '') return [{ text, start: 0, contentEnd: text.length, end: text.length }];
  const lines: Line[] = [];
  let start = 0;
  while (start < text.length) {
    const separator = text.indexOf(token, start);
    if (separator < 0) {
      lines.push({ text: text.slice(start), start, contentEnd: text.length, end: text.length });
      break;
    }
    lines.push({ text: text.slice(start, separator), start, contentEnd: separator, end: separator + token.length });
    start = separator + token.length;
  }
  return lines;
}

function isListLine(line: string): boolean {
  return /^(?:[ \t]*(?:[-+*]|\d+[.)])[ \t]+)/.test(line);
}

function listDepth(lines: readonly string[]): number {
  return Math.max(1, ...lines.map((line) => {
    const indentation = line.match(/^[ \t]*/)?.[0] ?? '';
    const columns = [...indentation].reduce((total, value) => total + (value === '\t' ? 4 : 1), 0);
    return 1 + Math.floor(columns / 2);
  }));
}

function isBoundaryLine(line: string): boolean {
  return /^(?:#{1,6}[ \t]+|>|`{3,}|~{3,}|:::| {0,3}<|\$\$\s*$| {4}|\t|\[\^[^\]]+\]:|[-*_]{3,}\s*$)/.test(line) || isListLine(line);
}

function scanBlockOffsets(text: string, token: '\n' | '\r\n' | ''): { blocks: Array<{ start: number; end: number }>; malformed?: string } {
  const lines = linesOf(text, token);
  const blocks: Array<{ start: number; end: number }> = [];
  let index = 0;
  while (index < lines.length) {
    if (lines[index].text.length === 0) { index += 1; continue; }
    const start = index;
    const first = lines[index].text;
    let end = index + 1;
    if (index === 0 && first === '---') {
      while (end < lines.length && lines[end].text !== '---') end += 1;
      if (end >= lines.length) return { blocks, malformed: 'Unterminated frontmatter boundary.' };
      end += 1;
    } else if (/^(`{3,}|~{3,})/.test(first)) {
      const marker = first.match(/^(`{3,}|~{3,})/)![1];
      while (end < lines.length && lines[end].text !== marker) end += 1;
      if (end >= lines.length) return { blocks, malformed: 'Unterminated fenced-code boundary.' };
      end += 1;
    } else if (first.startsWith(':::')) {
      while (end < lines.length && lines[end].text !== ':::') end += 1;
      if (end >= lines.length) return { blocks, malformed: 'Unterminated extension boundary.' };
      end += 1;
    } else if (first === '$$') {
      while (end < lines.length && lines[end].text !== '$$') end += 1;
      if (end >= lines.length) return { blocks, malformed: 'Unterminated display-math boundary.' };
      end += 1;
    } else if (/^>/.test(first)) {
      while (end < lines.length && /^>/.test(lines[end].text)) end += 1;
    } else if (isListLine(first)) {
      while (end < lines.length && (isListLine(lines[end].text) || /^(?: {2,}|\t)\S/.test(lines[end].text))) end += 1;
    } else if (/^#{1,6}[ \t]+/.test(first) || /^(?: {4}|\t|\[\^[^\]]+\]:|[-*_]{3,}\s*$)/.test(first)) {
      end = index + 1;
    } else if (/^ {0,3}<!--/.test(first)) {
      if (!first.includes('-->')) {
        while (end < lines.length && !lines[end].text.includes('-->')) end += 1;
        if (end >= lines.length) return { blocks, malformed: 'Unterminated HTML comment boundary.' };
        end += 1;
      }
    } else if (/^ {0,3}<(script|pre|style|textarea)(?:[ \t>])/i.test(first)) {
      const tag = first.match(/^ {0,3}<(script|pre|style|textarea)(?:[ \t>])/i)![1];
      const close = new RegExp(`</${tag}[ \\t]*>`, 'i');
      if (!close.test(first)) {
        while (end < lines.length && !close.test(lines[end].text)) end += 1;
        if (end >= lines.length) return { blocks, malformed: `Unterminated raw HTML ${tag} boundary.` };
        end += 1;
      }
    } else if (/^ {0,3}</.test(first)) {
      while (end < lines.length && lines[end].text.length > 0) end += 1;
    } else if (end < lines.length && first.includes('|') && /^\s*\|?\s*:?-{3,}/.test(lines[end].text)) {
      end += 1;
      while (end < lines.length && lines[end].text.includes('|') && lines[end].text.length > 0) end += 1;
    } else if (end < lines.length && /^(?:={3,}|-{3,})$/.test(lines[end].text)) {
      end += 1;
    } else {
      while (end < lines.length && lines[end].text.length > 0 && !isBoundaryLine(lines[end].text)) end += 1;
    }
    blocks.push({ start: lines[start].start, end: lines[end - 1].contentEnd });
    index = end;
  }
  return { blocks };
}

function scanRanges(text: string, byteOffset: number, token: '\n' | '\r\n' | ''): { ranges: SourceRange[]; malformed?: string } {
  const scanned = scanBlockOffsets(text, token);
  if (scanned.malformed) return { ranges: [], malformed: scanned.malformed };
  const ranges: SourceRange[] = [];
  let charOffset = 0;
  let bytes = byteOffset;
  const append = (role: SourceRange['role'], source: string) => {
    if (source.length === 0) return;
    const length = Buffer.byteLength(source);
    ranges.push({ role, source, start: bytes, end: bytes + length });
    bytes += length;
  };
  for (const block of scanned.blocks) {
    append('gap', text.slice(charOffset, block.start));
    append('block', text.slice(block.start, block.end));
    charOffset = block.end;
  }
  append('gap', text.slice(charOffset));
  return { ranges };
}

function cloneSemantic<T extends NotoBlockSemanticV1 | NotoOpaqueNodeV1>(semantic: T): T {
  return JSON.parse(JSON.stringify(semantic)) as T;
}

function cloneDocument(document: NotoMarkdownDocumentV1): NotoMarkdownDocumentV1 {
  return {
    ...document,
    envelope: { ...document.envelope },
    originalBytes: document.originalBytes.slice(),
    slices: document.slices.map((slice) => ({ ...slice, bytes: slice.bytes.slice() })),
    blocks: document.blocks.map((block) => ({ ...block, semantic: cloneSemantic(block.semantic) })),
  };
}

function acceptDocument(document: NotoMarkdownDocumentV1): NotoMarkdownDocumentV1 {
  const publicDocument = cloneDocument(document);
  acceptedDocuments.set(publicDocument, cloneDocument(publicDocument));
  return publicDocument;
}

export function projectMarkdownV1(input: Uint8Array): NotoProjectionResultV1 {
  const original = Uint8Array.from(input);
  const hasBom = input.byteLength >= 3 && bytesEqual(input.slice(0, 3), BOM);
  const body = input.slice(hasBom ? 3 : 0);
  const text = decode(body);
  if (text === null) return fallback('INVALID_UTF8', 'Input is not strict UTF-8.', original);
  if (/^\s*$/u.test(text)) return fallback('EMPTY_DOCUMENT', 'Empty or whitespace-only documents use explicit source-only fallback in v1.', original);
  const hasCrLf = /\r\n/.test(text);
  const withoutCrLf = text.replaceAll('\r\n', '');
  if ((hasCrLf && /[\r\n]/.test(withoutCrLf)) || /\r(?!\n)/.test(text)) return fallback('MIXED_LINE_ENDINGS', 'Mixed or bare-CR line endings are source-only in v1.', original);
  const lineEnding: 'crlf' | 'lf' | 'none' = hasCrLf ? 'crlf' : text.includes('\n') ? 'lf' : 'none';
  const token: '\r\n' | '\n' | '' = lineEnding === 'crlf' ? '\r\n' : lineEnding === 'lf' ? '\n' : '';
  const sourceSha256 = digest(original);
  const documentId = `noto-doc-v1:${sourceSha256.slice(0, 24)}` as NotoDocumentIdV1;
  const revisionId = `noto-rev-v1:${sourceSha256}` as NotoRevisionIdV1;
  const scanned = scanRanges(text, hasBom ? 3 : 0, token);
  if (scanned.malformed) return fallback('MALFORMED_BOUNDARY', scanned.malformed, original);
  const slices: NotoSourceSliceV1[] = [];
  const blocks: NotoSemanticBlockV1[] = [];
  if (hasBom) slices.push({ version: 1, id: 'noto-slice-v1:bom' as NotoSliceIdV1, role: 'bom', startByte: 0, endByte: 3, sha256: digest(BOM), bytes: BOM.slice() });
  let blockIndex = 0;
  let gapIndex = 0;
  for (const range of scanned.ranges) {
    const bytes = original.slice(range.start, range.end);
    if (range.role === 'gap') {
      const id = `noto-slice-v1:g${++gapIndex}:${digest(bytes).slice(0, 12)}` as NotoSliceIdV1;
      slices.push({ version: 1, id, role: 'gap', startByte: range.start, endByte: range.end, sha256: digest(bytes), bytes });
      continue;
    }
    const parsed = classifyIsolatedBlock(range.source);
    if (!parsed) return fallback('MALFORMED_BOUNDARY', 'An unterminated block boundary cannot be projected safely.', original);
    const blockId = `noto-block-v1:${++blockIndex}:${digest(`${parsed.kind}\0${range.source}`).slice(0, 16)}` as NotoBlockIdV1;
    const sliceId = `noto-slice-v1:b${blockIndex}:${digest(bytes).slice(0, 12)}` as NotoSliceIdV1;
    const semanticKey = canonical(parsed.semantic);
    slices.push({ version: 1, id: sliceId, role: 'block', blockId, startByte: range.start, endByte: range.end, sha256: digest(bytes), bytes });
    blocks.push({ version: 1, id: blockId, kind: parsed.kind, sourceSliceId: sliceId, editable: parsed.editable, semantic: parsed.semantic, semanticKey, projectionMarkdown: parsed.editable ? range.source : `:::noto-opaque{sourceId="${blockId}"}\n:::` });
  }
  const trailingPattern = token === '\r\n' ? /(?:\r\n)+$/ : token === '\n' ? /\n+$/ : null;
  const envelope = { version: NOTO_MARKDOWN_CONTRACT_VERSION, byteLength: original.byteLength, bom: hasBom ? 'utf8' as const : 'none' as const, lineEnding, hasFinalNewline: trailingPattern?.test(text) ?? false, sourceSha256 };
  const document = acceptDocument({ version: 1, documentId, revisionId, envelope, originalBytes: original, slices, blocks });
  return { status: 'projected', document, projection: toEditorProjectionV1(document) };
}

export function toEditorProjectionV1(document: NotoMarkdownDocumentV1): NotoEditorProjectionV1 {
  if (!hasVersionV1Discriminants(document)) {
    throw new Error('UNSUPPORTED_VERSION: Noto Markdown document discriminants must all be v1');
  }
  return { version: 1, documentId: document.documentId, revisionId: document.revisionId, markdown: document.blocks.map((block) => block.projectionMarkdown).join('\n\n'), blocks: document.blocks.map(({ id, kind, editable, semanticKey }) => ({ id, kind, editable, semanticKey })) };
}

function failureBytes(document: NotoMarkdownDocumentV1): Uint8Array {
  return (acceptedDocuments.get(document)?.originalBytes ?? document.originalBytes).slice();
}

function failed(document: NotoMarkdownDocumentV1, code: NotoSerializationFailureV1['code'], message: string): NotoSerializationFailureV1 {
  return { status: 'failed', version: 1, code, message, originalBytes: failureBytes(document) };
}

function validateAcceptedDocument(document: NotoMarkdownDocumentV1): NotoMarkdownDocumentV1 | null {
  const accepted = acceptedDocuments.get(document);
  if (!accepted) return null;
  if (!bytesEqual(document.originalBytes, accepted.originalBytes)
    || document.documentId !== accepted.documentId
    || document.revisionId !== accepted.revisionId
    || canonical(document.envelope) !== canonical(accepted.envelope)
    || document.envelope.byteLength !== document.originalBytes.byteLength
    || digest(document.originalBytes) !== document.envelope.sourceSha256
    || document.slices.length !== accepted.slices.length
    || document.blocks.length !== accepted.blocks.length) return null;
  let cursor = 0;
  const blockIds = new Set<string>();
  const sliceIds = new Set<string>();
  for (let index = 0; index < document.slices.length; index += 1) {
    const slice = document.slices[index];
    const expected = accepted.slices[index];
    if (!expected || sliceIds.has(slice.id) || slice.startByte !== cursor || slice.endByte <= slice.startByte
      || slice.endByte > document.originalBytes.byteLength || slice.id !== expected.id || slice.role !== expected.role
      || slice.blockId !== expected.blockId || slice.sha256 !== digest(slice.bytes) || slice.sha256 !== expected.sha256
      || !bytesEqual(slice.bytes, document.originalBytes.slice(slice.startByte, slice.endByte))
      || !bytesEqual(slice.bytes, expected.bytes)) return null;
    sliceIds.add(slice.id);
    cursor = slice.endByte;
  }
  if (cursor !== document.originalBytes.byteLength) return null;
  for (let index = 0; index < document.blocks.length; index += 1) {
    const block = document.blocks[index];
    const expected = accepted.blocks[index];
    const slice = document.slices.find((candidate) => candidate.id === block.sourceSliceId);
    if (!expected || blockIds.has(block.id) || block.id !== expected.id || block.kind !== expected.kind
      || block.editable !== expected.editable || block.sourceSliceId !== expected.sourceSliceId
      || block.semanticKey !== canonical(block.semantic) || block.semanticKey !== expected.semanticKey
      || block.projectionMarkdown !== expected.projectionMarkdown || !slice || slice.role !== 'block' || slice.blockId !== block.id) return null;
    blockIds.add(block.id);
  }
  return accepted;
}

function lineEndingOf(document: NotoMarkdownDocumentV1): string {
  return document.envelope.lineEnding === 'crlf' ? '\r\n' : '\n';
}

function buildAcceptedOutput(document: NotoMarkdownDocumentV1, reparsed: NotoMarkdownDocumentV1): NotoMarkdownDocumentV1 | null {
  if (reparsed.blocks.length !== document.blocks.length || reparsed.slices.length !== document.slices.length) return null;
  const blocks = reparsed.blocks.map((block, index) => ({ ...block, id: document.blocks[index].id, sourceSliceId: document.blocks[index].sourceSliceId }));
  const slices = reparsed.slices.map((slice, index) => ({ ...slice, id: document.slices[index].id, blockId: slice.role === 'block' ? blocks.find((block) => block.sourceSliceId === document.slices[index].id)?.id : undefined }));
  if (slices.some((slice) => slice.role === 'block' && !slice.blockId)) return null;
  return acceptDocument({ ...reparsed, documentId: document.documentId, slices, blocks });
}

export function rebindMarkdownIdentityV1(document: NotoMarkdownDocumentV1,
  identity: NotoDocumentIdentityMapV1): NotoMarkdownDocumentV1 | null {
  if (identity.version !== NOTO_MARKDOWN_CONTRACT_VERSION
    || !identity.documentId.startsWith('noto-doc-v1:')
    || !identity.revisionId.startsWith('noto-rev-v1:')
    || identity.blocks.length !== document.blocks.length) return null;
  const ids = new Set<string>();
  const blocks = document.blocks.map((block, index) => {
    const expected = identity.blocks[index];
    if (!expected || ids.has(expected.id) || !expected.id.startsWith('noto-block-v1:')
      || expected.kind !== block.kind || expected.editable !== block.editable
      || expected.semanticKey !== block.semanticKey) return null;
    ids.add(expected.id);
    return { ...block, id: expected.id };
  });
  if (blocks.some((block) => block === null)) return null;
  const typedBlocks = blocks as NotoSemanticBlockV1[];
  const blockIdBySlice = new Map(typedBlocks.map((block) => [block.sourceSliceId, block.id]));
  const slices = document.slices.map((slice) => slice.role === 'block'
    ? { ...slice, blockId: blockIdBySlice.get(slice.id) }
    : slice);
  if (slices.some((slice) => slice.role === 'block' && !slice.blockId)) return null;
  return acceptDocument({ ...document, documentId: identity.documentId, revisionId: identity.revisionId,
    slices, blocks: typedBlocks });
}

export function serializeMarkdownV1(document: NotoMarkdownDocumentV1, edits: readonly NotoBlockEditV1[]): NotoSerializationResultV1 {
  if (!hasVersionV1Discriminants(document)
    || edits.some((edit) => edit.version !== NOTO_MARKDOWN_CONTRACT_VERSION)) {
    return failed(document, 'UNSUPPORTED_VERSION', 'Document, envelope, slice, block, and edit discriminants must all be Noto Markdown v1.');
  }
  const accepted = validateAcceptedDocument(document);
  if (!accepted) return failed(document, 'DOCUMENT_INTEGRITY_FAILED', 'The document is forged, mutated, or inconsistent with its accepted projection.');
  if (edits.length === 0) {
    const outputBytes = accepted.originalBytes.slice();
    const deterministic = bytesEqual(outputBytes, accepted.originalBytes);
    const semanticReparseEquivalent = projectMarkdownV1(outputBytes).status === 'projected';
    if (!deterministic || !semanticReparseEquivalent) return failed(document, 'DOCUMENT_INTEGRITY_FAILED', 'The accepted no-edit document failed identity validation.');
    return { status: 'serialized', version: 1, documentId: accepted.documentId, fromRevisionId: accepted.revisionId, outputBytes, outputSha256: digest(outputBytes), deterministic: true, semanticReparseEquivalent: true, editedBlockId: null, editedBlockIdentityPolicy: 'preserved-within-document-v1', untouchedSlices: accepted.slices.map((slice) => ({ sliceId: slice.id, beforeSha256: slice.sha256, afterSha256: digest(slice.bytes), byteIdentical: true })), document, projection: toEditorProjectionV1(document) };
  }
  const ids = edits.map((edit) => edit.blockId);
  if (new Set(ids).size !== ids.length) return failed(document, 'DUPLICATE_BLOCK_EDIT', 'The same block cannot be edited twice in one serialization.');
  if (edits.length !== 1) return failed(document, 'STRUCTURE_CHANGED', 'The v1 transaction ceiling is one top-level block edit.');
  const edit = edits[0];
  if (edit.documentId !== accepted.documentId) return failed(document, 'WRONG_DOCUMENT', 'The edit belongs to another document.');
  if (edit.revisionId !== accepted.revisionId) return failed(document, 'STALE_REVISION', 'The edit revision is stale.');
  const blockIndex = accepted.blocks.findIndex((candidate) => candidate.id === edit.blockId);
  const block = accepted.blocks[blockIndex];
  if (!block) return failed(document, 'UNKNOWN_BLOCK', 'The edited block identity is unknown.');
  if (!block.editable) return failed(document, 'UNSUPPORTED_OPAQUE_EDIT', 'Opaque source-only blocks cannot be semantically edited in v1.');
  if (block.kind !== edit.expectedKind) return failed(document, 'BLOCK_KIND_CHANGED', 'The requested block kind does not match the projection.');
  const normalized = edit.markdown.replaceAll('\r\n', '\n');
  if (accepted.envelope.lineEnding === 'none' && normalized.includes('\n')) return failed(document, 'BLOCK_KIND_CHANGED', 'A no-line-ending envelope cannot acquire multiline syntax in v1.');
  const parsedEdit = projectMarkdownV1(new TextEncoder().encode(normalized));
  if (parsedEdit.status !== 'projected' || parsedEdit.document.blocks.length !== 1 || parsedEdit.document.slices.some((slice) => slice.role === 'gap')) return failed(document, 'BLOCK_KIND_CHANGED', 'The edit must be exactly one supported block without terminal separators.');
  const parsedBlock = parsedEdit.document.blocks[0];
  if (!parsedBlock.editable || parsedBlock.kind !== block.kind) return failed(document, 'BLOCK_KIND_CHANGED', 'The edited Markdown changed or invalidated the block kind.');
  if (parsedBlock.semanticKey !== edit.expectedSemanticKey) return failed(document, 'SEMANTIC_MISMATCH', 'The edited Markdown does not match the claimed semantics.');
  const replacement = new TextEncoder().encode(normalized.replaceAll('\n', lineEndingOf(accepted)));
  const editedSlice = accepted.slices.find((slice) => slice.blockId === block.id);
  if (!editedSlice) return failed(document, 'DOCUMENT_INTEGRITY_FAILED', 'The edited block has no accepted source slice.');
  const buildOutput = () => Buffer.concat(accepted.slices.map((slice) => Buffer.from(slice.id === editedSlice.id ? replacement : slice.bytes)));
  const output = buildOutput();
  const deterministic = bytesEqual(output, buildOutput());
  if (!deterministic) return failed(document, 'DOCUMENT_INTEGRITY_FAILED', 'Serialization output was not deterministic.');
  const projectedOutput = projectMarkdownV1(output);
  if (projectedOutput.status !== 'projected') return failed(document, 'STRUCTURE_CHANGED', `Serialized output did not reparse: ${projectedOutput.code}.`);
  const reparsedBlock = projectedOutput.document.blocks[blockIndex];
  const semanticReparseEquivalent = Boolean(reparsedBlock && reparsedBlock.kind === block.kind && reparsedBlock.semanticKey === parsedBlock.semanticKey);
  if (!semanticReparseEquivalent) return failed(document, 'SEMANTIC_MISMATCH', 'Serialized output did not preserve the requested semantic block.');
  const untouchedSlices = [];
  for (let index = 0; index < accepted.slices.length; index += 1) {
    const slice = accepted.slices[index];
    if (slice.id === editedSlice.id) continue;
    const after = projectedOutput.document.slices[index];
    const byteIdentical = Boolean(after && bytesEqual(after.bytes, slice.bytes) && digest(after.bytes) === slice.sha256);
    if (!byteIdentical) return failed(document, 'DOCUMENT_INTEGRITY_FAILED', `Untouched slice ${slice.id} changed during serialization.`);
    untouchedSlices.push({ sliceId: slice.id, beforeSha256: slice.sha256, afterSha256: digest(after!.bytes), byteIdentical: true as const });
  }
  const nextDocument = buildAcceptedOutput(accepted, projectedOutput.document);
  if (!nextDocument) return failed(document, 'STRUCTURE_CHANGED', 'Serialized output changed the accepted slice or block structure.');
  return { status: 'serialized', version: 1, documentId: accepted.documentId, fromRevisionId: accepted.revisionId, outputBytes: output, outputSha256: digest(output), deterministic: true, semanticReparseEquivalent: true, editedBlockId: block.id, editedBlockIdentityPolicy: 'preserved-within-document-v1', untouchedSlices, document: nextDocument, projection: toEditorProjectionV1(nextDocument) };
}

// yagni: v1 intentionally stops at one top-level edit and the versioned g002-v1 fixture grammar; extend through a v2 contract and fixtures rather than widening this parser silently.
