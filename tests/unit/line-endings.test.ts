/**
 * Converting a file's line endings, and deciding whether it ends with one.
 *
 * This is the only thing a save does that deliberately rewrites bytes it was
 * not asked to edit, so the tests here are as much about what it leaves alone
 * as about what it changes: a save that was not asked to convert has to be
 * exactly the save it always was.
 */

import { describe, expect, it } from 'vitest';
import { parseDocument } from '../../src/shared/markdown/v3/document';
import { serializeDocument, identityTransaction } from '../../src/shared/markdown/v3/serialize';
import {
  NOTO_MARKDOWN_VERSION,
  type NotoDocument,
  type NotoLineEnding,
  type NotoTransaction,
} from '../../src/shared/markdown/v3/contracts';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function parsed(source: string): NotoDocument {
  const result = parseDocument(encoder.encode(source));
  if (result.status !== 'parsed') throw new Error(`fixture did not parse: ${result.code}`);
  return result.document;
}

/** Every block untouched, with only the file's shape asked to change. */
function reshaping(document: NotoDocument, lineEnding: NotoLineEnding, hasFinalNewline: boolean): NotoTransaction {
  return {
    ...(identityTransaction(document) as Extract<NotoTransaction, { mode: 'blocks' }>),
    envelope: { lineEnding, hasFinalNewline },
  };
}

const written = (document: NotoDocument, transaction: NotoTransaction): string => {
  const result = serializeDocument(document, transaction);
  if (result.status !== 'serialized') throw new Error(`did not serialize: ${result.message}`);
  return decoder.decode(result.outputBytes);
};

const LF = '# Title\n\nFirst paragraph.\n\n- one\n- two\n\nLast.\n';
const CRLF = LF.replaceAll('\n', '\r\n');

describe('converting line endings', () => {
  it('rewrites every line, including the blocks nobody edited', () => {
    const document = parsed(LF);
    expect(written(document, reshaping(document, 'crlf', true))).toBe(CRLF);
  });

  it('converts the other way just as completely', () => {
    const document = parsed(CRLF);
    expect(written(document, reshaping(document, 'lf', true))).toBe(LF);
  });

  it('changes nothing at all when the target is what the file already is', () => {
    const document = parsed(CRLF);
    expect(written(document, reshaping(document, 'crlf', true))).toBe(CRLF);
    expect(written(document, identityTransaction(document))).toBe(CRLF);
  });

  it('leaves the endings alone when the target says mixed', () => {
    // Which is what every ordinary save asks for, so this is the property that
    // keeps a save byte for byte when nobody asked to convert anything.
    const document = parsed(CRLF);
    expect(written(document, reshaping(document, 'mixed', true))).toBe(CRLF);
  });

  it('claims nothing was preserved when it rewrote the whole file', () => {
    // `preserved` is the evidence a range came through untouched, and the store
    // checks it. Every line has moved, so there is nothing to point at.
    const document = parsed(LF);
    const converted = serializeDocument(document, reshaping(document, 'crlf', true));
    expect(converted.status).toBe('serialized');
    if (converted.status !== 'serialized') return;
    expect(converted.preserved).toEqual([]);

    const untouched = serializeDocument(document, identityTransaction(document));
    expect(untouched.status === 'serialized' && untouched.preserved.length).toBeGreaterThan(0);
  });

  it('says what it was written with afterwards, not what it used to be', () => {
    // The next revision carries the endings the file now has. Carrying the old
    // value forward meant a converted file went on claiming the endings it had
    // before, so the menu ticked the wrong one and a second save thought it
    // still had a conversion to do.
    const document = parsed(LF);
    const converted = serializeDocument(document, reshaping(document, 'crlf', true));
    expect(converted.status).toBe('serialized');
    if (converted.status !== 'serialized') return;
    expect(converted.document.envelope.lineEnding).toBe('crlf');
    expect(converted.document.envelope.hasFinalNewline).toBe(true);

    const stripped = serializeDocument(document, reshaping(document, 'mixed', false));
    expect(stripped.status === 'serialized' && stripped.document.envelope.hasFinalNewline).toBe(false);
  });

  it('converts a file whose own endings are mixed into one or the other', () => {
    const document = parsed('# Title\r\n\r\nOne.\n\nTwo.\r\n');
    expect(written(document, reshaping(document, 'lf', true))).toBe('# Title\n\nOne.\n\nTwo.\n');
  });
});

describe('the final newline', () => {
  it('adds one to a file that had none', () => {
    const document = parsed('# Title\n\nNo newline at the end.');
    expect(written(document, reshaping(document, 'mixed', true))).toBe('# Title\n\nNo newline at the end.\n');
  });

  it('takes one away when it is turned off', () => {
    const document = parsed('# Title\n\nEnds with one.\n');
    expect(written(document, reshaping(document, 'mixed', false))).toBe('# Title\n\nEnds with one.');
  });

  it('keeps a blank line the author left, rather than trimming to exactly one', () => {
    // The option is about whether the file ends with a newline, not how many.
    const document = parsed('# Title\n\nEnds with a blank line.\n\n');
    expect(written(document, reshaping(document, 'mixed', true))).toBe('# Title\n\nEnds with a blank line.\n\n');
  });

  it('writes the new newline in the endings the file is being written with', () => {
    const document = parsed('# Title\r\n\r\nNo newline at the end.');
    expect(written(document, reshaping(document, 'crlf', true))).toBe('# Title\r\n\r\nNo newline at the end.\r\n');
  });

  it('leaves a file alone when neither the endings nor the last byte change', () => {
    const document = parsed(LF);
    expect(written(document, reshaping(document, 'mixed', true))).toBe(LF);
  });
});
