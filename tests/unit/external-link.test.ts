import { describe, expect, it } from 'vitest';
import { isOpenableExternalUrl, isWorkspaceOpenExternalRequestV1, openableExternalUrl } from '../../src/shared/workspace/v1/validate';

/**
 * A URL in a note is text somebody else may have written, and the call it ends
 * at hands the string to the operating system, which launches a handler for
 * any scheme the machine knows. Only three get through.
 */
describe('the links a note may open', () => {
  it('allows the web and mail', () => {
    expect(isOpenableExternalUrl('https://example.com/a?b=c#d')).toBe(true);
    expect(isOpenableExternalUrl('http://example.com')).toBe(true);
    expect(isOpenableExternalUrl('mailto:someone@example.com')).toBe(true);
  });

  it('refuses every scheme that reaches the machine itself', () => {
    expect(isOpenableExternalUrl('file:///etc/passwd')).toBe(false);
    expect(isOpenableExternalUrl('javascript:alert(1)')).toBe(false);
    expect(isOpenableExternalUrl('vscode://file/etc/hosts')).toBe(false);
    expect(isOpenableExternalUrl('smb://host/share')).toBe(false);
    expect(isOpenableExternalUrl('data:text/html,<script>x</script>')).toBe(false);
    expect(isOpenableExternalUrl('ms-msdt:/id')).toBe(false);
  });

  it('refuses what is not a URL at all, and what is too long to be one', () => {
    expect(isOpenableExternalUrl('')).toBe(false);
    expect(isOpenableExternalUrl('example.com')).toBe(false);
    expect(isOpenableExternalUrl('./notes/other.md')).toBe(false);
    expect(isOpenableExternalUrl(`https://example.com/${'a'.repeat(2100)}`)).toBe(false);
  });

  it('gives back the normalised URL, which is the one that may be opened', () => {
    // The parser here and the one the operating system opens with do not have
    // to agree. Checking one string and opening another is the bug; only the
    // string that was checked is handed on.
    expect(openableExternalUrl('https:/\\/\\evil.com')).toBe('https://evil.com/');
    expect(openableExternalUrl('HTTPS://Example.COM')).toBe('https://example.com/');
    expect(openableExternalUrl('https://example.com/a\tb')).toBe('https://example.com/ab');
    expect(openableExternalUrl('https://exa\nmple.com/a')).toBe('https://example.com/a');
    expect(openableExternalUrl('file:///etc/passwd')).toBeNull();
  });

  it('refuses a scheme hidden behind whitespace inside it', () => {
    // The check runs on the parsed URL, so the parser's own stripping cannot
    // be used to smuggle a scheme past a check on the raw text.
    expect(isOpenableExternalUrl(' javascript:alert(1)')).toBe(false);
    expect(isOpenableExternalUrl('java\nscript:alert(1)')).toBe(false);
    expect(isOpenableExternalUrl('jav\tascript:alert(1)')).toBe(false);
  });

  it('is applied by the request validator, not only available to it', () => {
    const request = (url: string) => ({ version: 1 as const, requestId: 'open-external:1', url });
    expect(isWorkspaceOpenExternalRequestV1(request('https://example.com'))).toBe(true);
    expect(isWorkspaceOpenExternalRequestV1(request('file:///etc/passwd'))).toBe(false);
    // The shape is checked too: no extra fields, and a request id that fits.
    expect(isWorkspaceOpenExternalRequestV1({ ...request('https://example.com'), extra: 1 })).toBe(false);
    expect(isWorkspaceOpenExternalRequestV1({ version: 1, url: 'https://example.com' })).toBe(false);
  });
});
