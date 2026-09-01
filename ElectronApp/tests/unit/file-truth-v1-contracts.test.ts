import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { parseDocument, toWire } from '../../src/shared/markdown/v3/document';
import type { NotoDocumentWire } from '../../src/shared/markdown/v3/contracts';
import { isFileTruthDiagnosticsResultV1, isFileTruthOpenResultV1, isFileTruthRequestV1, isFileTruthSaveOutcomeV1,
  isFileTruthSaveRequestV1, isFileTruthSaveResultV1, sha256Hex } from '../../src/shared/file-truth/v1/validate';

const bytes = (value: string) => new TextEncoder().encode(value);
const alternateHash = 'd'.repeat(64);

function wireDocument(source = '# Title\n\nText.\n'): NotoDocumentWire {
  const value = parseDocument(bytes(source));
  if (value.status !== 'parsed') throw new Error(value.message);
  return toWire(value.document);
}

/**
 * Change the text without changing the declared hash. The validator recomputes
 * the digest from the text it was handed, so this must be rejected.
 */
function documentWithForgedText(document: NotoDocumentWire): NotoDocumentWire {
  return { ...document, text: document.text.replace('Text.', 'Txet.') };
}

function fingerprint(contentSha256: string, byteLength = 16) {
  return { version: 1 as const, object: { scheme: 'noto-file-object-v1' as const, basis: 'inode' as const, opaqueId: 'dev:1' },
    byteLength, mtimeNanoseconds: '1', contentSha256 };
}

function savedOutcome() {
  const document = wireDocument();
  const acceptedFingerprint = fingerprint(document.envelope.sourceSha256, document.envelope.byteLength);
  return {
    version: 1 as const,
    status: 'saved' as const,
    attemptId: 'attempt:1',
    safeStage: 'journal-complete' as const,
    dirtyPreserved: false as const,
    message: 'saved',
    accepted: { version: 1 as const, canonicalPath: '/tmp/note.md', fingerprint: acceptedFingerprint, posixMode: 0o640 },
    saveToken: { version: 1 as const, documentRevisionId: document.revisionId, editorRevision: 1,
      fingerprint: acceptedFingerprint },
    outputSha256: document.envelope.sourceSha256,
    replacedOriginal: true as const,
    document,
  };
}

function openReply() {
  const document = wireDocument();
  return {
    version: 1 as const,
    path: '/tmp/note.md',
    document,
    saveToken: { version: 1 as const, documentRevisionId: document.revisionId, editorRevision: 0,
      fingerprint: fingerprint(document.envelope.sourceSha256, document.envelope.byteLength) },
    recovery: null,
    initialOutcome: null,
  };
}

/**
 * A reopen that presents the durable recovery candidate rather than what is on
 * disk, so the document must agree with the journal instead of the save token.
 */
function recoveryOpenReply() {
  const document = wireDocument('# Title\n\nRecovered text.\n');
  return {
    version: 1 as const,
    path: '/tmp/note.md',
    document,
    saveToken: { version: 1 as const, documentRevisionId: document.revisionId, editorRevision: 0,
      fingerprint: fingerprint(alternateHash, 999) },
    recovery: {
      version: 1 as const,
      schema: 'noto-file-truth-journal-v2' as const,
      attemptId: 'recovery:1',
      stage: 'candidate-durable' as const,
      originalPath: '/tmp/note.md',
      payloadPath: '/tmp/note.payload',
      journalPath: '/tmp/note.journal',
      tempPath: null,
      candidateSha256: document.envelope.sourceSha256,
      candidateByteLength: document.envelope.byteLength,
      acceptedFingerprint: fingerprint('a'.repeat(64), 16),
      posixMode: 0o640,
    },
    initialOutcome: null,
  };
}

describe('Noto file-truth v1 contracts', () => {
  it('computes browser-safe SHA-256 against standard known vectors', () => {
    expect(sha256Hex(bytes(''))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex(bytes('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256Hex(new Uint8Array(1_000_000).fill(0x61)))
      .toBe('cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0');
  });

  it('accepts exact request discriminants and rejects malformed or surplus payloads', () => {
    expect(isFileTruthRequestV1({ version: 1, requestId: 'open:1' })).toBe(true);
    expect(isFileTruthRequestV1({ version: 2, requestId: 'open:1' })).toBe(false);
    expect(isFileTruthRequestV1({ version: 1, requestId: 'open:1', extra: true })).toBe(false);
    expect(isFileTruthSaveRequestV1({ version: 1, requestId: 'save:1', candidate: {} })).toBe(false);
  });

  it('admits exact v3 block and full-source candidates through the file-truth lease', () => {
    const fingerprint = { version: 1, object: { scheme: 'noto-file-object-v1', basis: 'inode', opaqueId: 'dev:1' },
      byteLength: 4, mtimeNanoseconds: '1', contentSha256: 'a'.repeat(64) };
    const saveToken = { version: 1, documentRevisionId: `noto-rev-v3:${'b'.repeat(64)}`, editorRevision: 0, fingerprint };
    const base = { version: 3, documentId: `noto-doc-v3:${'b'.repeat(64)}`, revisionId: saveToken.documentRevisionId };
    const blockRequest = { version: 1, requestId: 'save:v3', candidate: { version: 3, saveToken,
      transaction: { ...base, mode: 'blocks', units: [{ origin: null, markdown: 'Text.' }] } } };
    expect(isFileTruthSaveRequestV1(blockRequest)).toBe(true);
    expect(isFileTruthSaveRequestV1({ ...blockRequest, candidate: { ...blockRequest.candidate,
      transaction: { ...blockRequest.candidate.transaction, extra: true } } })).toBe(false);
    // The retired v2 shape must not be accepted through the same lease.
    expect(isFileTruthSaveRequestV1({ ...blockRequest, candidate: { ...blockRequest.candidate, version: 2 } })).toBe(false);
    const sourceRequest = { version: 1, requestId: 'save:source', candidate: { version: 3, saveToken,
      transaction: { ...base, mode: 'source', expectedSourceSha256: 'c'.repeat(64), sourceBytes: new Uint8Array([65]) } } };
    expect(isFileTruthSaveRequestV1(sourceRequest)).toBe(true);
  });

  it('rejects malformed, surplus, mismatched, and false-clean protocol replies', () => {
    expect(isFileTruthSaveResultV1({ ok: true, requestId: 'save:1', value: { status: 'saved' } }, 'save:1')).toBe(false);
    expect(isFileTruthSaveResultV1({ ok: false, requestId: 'other', error: { code: 'BAD_REQUEST', message: 'bad' } }, 'save:1')).toBe(false);
    expect(isFileTruthSaveResultV1({ ok: false, requestId: 'save:1', error: { code: 'BAD_REQUEST', message: 'bad' }, extra: true }, 'save:1')).toBe(false);
    expect(isFileTruthSaveResultV1({ ok: true, requestId: 'save:1', value: {
      version: 1, status: 'write-failed', attemptId: 'a', safeStage: 'before-temp-write', dirtyPreserved: false,
      message: 'must stay dirty', recovery: null, residuePaths: [],
    } }, 'save:1')).toBe(false);
  });

  it('requires exact failure stages, residue strings, and diagnostic counters', () => {
    const failure = { version: 1, status: 'write-failed', attemptId: 'attempt', safeStage: 'before-temp-write',
      dirtyPreserved: true, message: 'failed safely', recovery: null, recoveryRecordId: null, residuePaths: [] };
    expect(isFileTruthSaveResultV1({ ok: true, requestId: 'save:1', value: failure }, 'save:1')).toBe(true);
    expect(isFileTruthSaveResultV1({ ok: true, requestId: 'save:1', value: { ...failure, safeStage: 'invented' } }, 'save:1')).toBe(false);
    expect(isFileTruthSaveResultV1({ ok: true, requestId: 'save:1', value: { ...failure, residuePaths: [1] } }, 'save:1')).toBe(false);
    expect(isFileTruthSaveResultV1({ ok: true, requestId: 'save:1', value: { ...failure, extra: true } }, 'save:1')).toBe(false);

    const diagnostics = { version: 1, state: 'failed', watcherGeneration: 1,
      watcherEvents: { self: 0, foreign: 1 }, lastOutcome: failure };
    expect(isFileTruthDiagnosticsResultV1({ ok: true, requestId: 'diag:1', value: diagnostics }, 'diag:1')).toBe(true);
    expect(isFileTruthDiagnosticsResultV1({ ok: true, requestId: 'diag:1', value: { ...diagnostics,
      watcherEvents: { self: -1, foreign: 1 } } }, 'diag:1')).toBe(false);
    expect(isFileTruthDiagnosticsResultV1({ ok: true, requestId: 'diag:1', value: { ...diagnostics, extra: true } }, 'diag:1')).toBe(false);
  });

  it('accepts a saved outcome only when its document, token, and output hash agree', () => {
    expect(isFileTruthSaveOutcomeV1(savedOutcome())).toBe(true);
  });

  it('rejects a saved outcome that omits the newly accepted document', () => {
    const { document: _document, ...withoutDocument } = savedOutcome();
    expect(isFileTruthSaveOutcomeV1(withoutDocument)).toBe(false);
  });

  it('rejects saved text tampering even when every declared hash agrees with itself', () => {
    const value = savedOutcome();
    // Same length, same declared hashes, different bytes. Only recomputing the
    // digest from the text catches this.
    expect(isFileTruthSaveOutcomeV1({ ...value, document: documentWithForgedText(value.document) })).toBe(false);
  });

  it.each([
    ['document revision and save-token revision', (value: ReturnType<typeof savedOutcome>) => ({ ...value,
      saveToken: { ...value.saveToken, documentRevisionId: `noto-rev-v3:${alternateHash}` } })],
    ['document source hash and output hash', (value: ReturnType<typeof savedOutcome>) => ({ ...value,
      outputSha256: alternateHash })],
    ['fingerprint hash and document envelope', (value: ReturnType<typeof savedOutcome>) => ({ ...value,
      accepted: { ...value.accepted, fingerprint: fingerprint(alternateHash, value.document.envelope.byteLength) },
      saveToken: { ...value.saveToken, fingerprint: fingerprint(alternateHash, value.document.envelope.byteLength) },
      outputSha256: alternateHash })],
    ['fingerprint byte length and document envelope', (value: ReturnType<typeof savedOutcome>) => ({ ...value,
      accepted: { ...value.accepted,
        fingerprint: fingerprint(value.outputSha256, value.document.envelope.byteLength + 1) },
      saveToken: { ...value.saveToken,
        fingerprint: fingerprint(value.outputSha256, value.document.envelope.byteLength + 1) } })],
    ['declared byte length and actual text', (value: ReturnType<typeof savedOutcome>) => ({ ...value,
      document: { ...value.document,
        envelope: { ...value.document.envelope, byteLength: value.document.envelope.byteLength + 1 } } })],
    ['block ordinals and their order', (value: ReturnType<typeof savedOutcome>) => ({ ...value,
      document: { ...value.document, origins: [...value.document.origins].reverse() } })],
  ])('rejects a saved outcome with mismatched %s', (_label, mismatch) => {
    expect(isFileTruthSaveOutcomeV1(mismatch(savedOutcome()))).toBe(false);
  });

  it('accepts an open reply only when its document and save token agree', () => {
    expect(isFileTruthOpenResultV1({ ok: true, requestId: 'open:1', value: openReply() }, 'open:1')).toBe(true);
  });

  it('rejects open text tampering when the declared hashes are forged consistently', () => {
    const value = openReply();
    expect(isFileTruthOpenResultV1({ ok: true, requestId: 'open:1', value: {
      ...value,
      document: documentWithForgedText(value.document),
    } }, 'open:1')).toBe(false);
  });

  it.each([
    ['document and save-token revisions', (value: ReturnType<typeof openReply>) => ({ ...value,
      saveToken: { ...value.saveToken, documentRevisionId: `noto-rev-v3:${alternateHash}` } })],
    ['save-token fingerprint hash and document source', (value: ReturnType<typeof openReply>) => ({ ...value,
      saveToken: { ...value.saveToken,
        fingerprint: fingerprint(alternateHash, value.document.envelope.byteLength) } })],
    ['save-token fingerprint byte length and document source', (value: ReturnType<typeof openReply>) => ({ ...value,
      saveToken: { ...value.saveToken,
        fingerprint: fingerprint(value.document.envelope.sourceSha256, value.document.envelope.byteLength + 1) } })],
  ])('rejects an open reply with mismatched %s', (_label, mismatch) => {
    const value = mismatch(openReply());
    expect(isFileTruthOpenResultV1({ ok: true, requestId: 'open:1', value }, 'open:1')).toBe(false);
  });

  it('binds a recovery open reply to the durable candidate rather than the file on disk', () => {
    const value = recoveryOpenReply();
    // The save token deliberately describes different bytes: during recovery the
    // presented document is the candidate, so it must match the journal.
    expect(value.saveToken.fingerprint.contentSha256).not.toBe(value.document.envelope.sourceSha256);
    expect(value.recovery.candidateSha256).toBe(value.document.envelope.sourceSha256);
    expect(isFileTruthOpenResultV1({ ok: true, requestId: 'open:recovery', value }, 'open:recovery')).toBe(true);
  });

  it.each([
    ['candidate source hash', (value: ReturnType<typeof recoveryOpenReply>) => ({ ...value,
      recovery: { ...value.recovery, candidateSha256: alternateHash } })],
    ['candidate byte length', (value: ReturnType<typeof recoveryOpenReply>) => ({ ...value,
      recovery: { ...value.recovery, candidateByteLength: value.document.envelope.byteLength + 1 } })],
    ['journal schema version', (value: ReturnType<typeof recoveryOpenReply>) => ({ ...value,
      recovery: { ...value.recovery, schema: 'noto-file-truth-journal-v1' } })],
  ])('rejects a recovery open reply with mismatched %s', (_label, mismatch) => {
    const value = mismatch(recoveryOpenReply());
    expect(isFileTruthOpenResultV1({ ok: true, requestId: 'open:recovery', value }, 'open:recovery')).toBe(false);
  });

  it('keeps the Noto domain contract vendor and platform type free', async () => {
    const source = await readFile(new URL('../../src/shared/file-truth/v1/contracts.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/from ['"](?:node:|electron|@milkdown|prosemirror|remark)/);
    expect(source).not.toContain('Buffer');
    expect(source).not.toMatch(/\b(dev|ino|Stats|BigIntStats)\b/);
  });
});
