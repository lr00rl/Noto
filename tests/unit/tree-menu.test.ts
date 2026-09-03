import { describe, expect, it } from 'vitest';
import { isWorkspaceTreeMenuRequestV1 } from '../../src/shared/workspace/v1/validate';

/**
 * The renderer names a row and main draws the menu for it. The path is a
 * request to act somewhere, so the shape is checked here and the location is
 * checked again in main against the folder that is actually open.
 */
describe('a request for a tree row menu', () => {
  const request = (over: Record<string, unknown> = {}) => ({
    version: 1 as const, requestId: 'tree-menu:1', path: '/vault/note.md', kind: 'file' as const, ...over,
  });

  it('takes a file or a directory and nothing else', () => {
    expect(isWorkspaceTreeMenuRequestV1(request())).toBe(true);
    expect(isWorkspaceTreeMenuRequestV1(request({ kind: 'directory' }))).toBe(true);
    expect(isWorkspaceTreeMenuRequestV1(request({ kind: 'symlink' }))).toBe(false);
    expect(isWorkspaceTreeMenuRequestV1(request({ kind: '' }))).toBe(false);
  });

  it('refuses a path that is empty or longer than one can be', () => {
    expect(isWorkspaceTreeMenuRequestV1(request({ path: '' }))).toBe(false);
    expect(isWorkspaceTreeMenuRequestV1(request({ path: 'a'.repeat(4097) }))).toBe(false);
  });

  it('refuses a request with a field it should not have, or one missing', () => {
    expect(isWorkspaceTreeMenuRequestV1({ ...request(), extra: 1 })).toBe(false);
    expect(isWorkspaceTreeMenuRequestV1({ version: 1, path: '/x', kind: 'file' })).toBe(false);
    expect(isWorkspaceTreeMenuRequestV1(request({ requestId: 'not a valid id!' }))).toBe(false);
  });
});
