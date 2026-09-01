import { describe, expect, it } from 'vitest';
import { summarizeUntrustedText } from '../../src/main/logger';

describe('untrusted runtime log redaction', () => {
  it('never retains renderer console or service stream text', () => {
    const sentinel = 'PRIVATE_DOCUMENT_SENTINEL_不要记录';
    const renderer = summarizeUntrustedText(sentinel);
    const service = summarizeUntrustedText(Buffer.from(sentinel));
    expect(JSON.stringify({ renderer, service })).not.toContain(sentinel);
    expect(renderer).toMatchObject({ bytes: expect.any(Number), sha256: expect.stringMatching(/^[a-f0-9]{64}$/) });
  });
});

