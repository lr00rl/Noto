/**
 * Which four notes the strip along the bottom shows.
 *
 * Its own description says "the last few documents" and "a way back to the note
 * you were just in", and it was showing the first four of a list ordered by when
 * each was opened. With more than four notes open, the one thing missing from
 * the way back was the note you had just been in.
 */

import { describe, expect, it } from 'vitest';
import { recentlyActive, RECENT_SHOWN } from '../../src/renderer/RecentStrip';
import type { WorkspaceTabV1 } from '../../src/shared/workspace/v1/contracts';

const tab = (name: string, activatedAt: number, active = false): WorkspaceTabV1 => ({
  path: `/vault/${name}.md`,
  name: `${name}.md`,
  documentId: `noto-doc-v3:${name.padEnd(64, '0')}`,
  active,
  activatedAt,
});

const names = (tabs: readonly WorkspaceTabV1[]) => tabs.map((entry) => entry.name);

describe('recentlyActive', () => {
  it('takes the most recently visited, not the first opened', () => {
    // The list arrives in the order the documents were opened, because that is
    // the order a neighbour is chosen from when one is closed.
    const opened = [
      tab('first', 1), tab('second', 2), tab('third', 3),
      tab('fourth', 4), tab('fifth', 5), tab('sixth', 6, true),
    ];
    expect(names(recentlyActive(opened))).toEqual(['sixth.md', 'fifth.md', 'fourth.md', 'third.md']);
  });

  it('keeps the note you are in, marked, since a signpost includes where you stand', () => {
    const opened = [tab('a', 1), tab('b', 3, true), tab('c', 2)];
    expect(names(recentlyActive(opened))).toEqual(['b.md', 'c.md', 'a.md']);
  });

  it('follows a revisit rather than the order things were opened in', () => {
    // Opened a, b, c, then went back to a: a is the most recent.
    const opened = [tab('a', 4), tab('b', 2), tab('c', 3, true)];
    expect(names(recentlyActive(opened))).toEqual(['a.md', 'c.md', 'b.md']);
  });

  it('shows no more than it can be taken in at a glance', () => {
    const many = Array.from({ length: 20 }, (_, index) => tab(`n${index}`, index + 1));
    expect(recentlyActive(many)).toHaveLength(RECENT_SHOWN);
  });

  it('is the one note when only one is open, which the strip itself then hides', () => {
    expect(names(recentlyActive([tab('only', 1, true)]))).toEqual(['only.md']);
  });
});
