/**
 * How often and how recently, in one number.
 *
 * The property that matters: an empty quick-open box should already be showing
 * the right few files. That only works if recency dominates while frequency
 * still counts for something, and if neither can run away with the ranking.
 */

import { describe, expect, it } from 'vitest';
import {
  coerceStore, frecencyScore, pruneStore, rankByFrecency, recencyWeight, recordOpen,
  removePaths, searchBoost, SEARCH_BOOST_CAP,
} from '../../src/shared/search/v1/frecency';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const now = 1_700_000_000_000;
const entry = (path: string, count: number, ago: number) =>
  ({ path, count, lastOpenedAt: now - ago });

describe('recency', () => {
  it('steps down in bands a person would recognise', () => {
    expect(recencyWeight(HOUR / 2)).toBe(100);
    expect(recencyWeight(2 * HOUR)).toBe(80);
    expect(recencyWeight(3 * DAY)).toBe(60);
    expect(recencyWeight(400 * DAY)).toBe(10);
  });

  it('treats a file from the future as just opened rather than as ancient', () => {
    expect(recencyWeight(-5_000)).toBe(100);
  });
});

describe('frecency', () => {
  it('lets this hour beat many opens from last month', () => {
    const fresh = frecencyScore(entry('/fresh.md', 1, HOUR / 2), now);
    const stale = frecencyScore(entry('/stale.md', 40, 45 * DAY), now);
    expect(fresh).toBeGreaterThan(stale);
  });

  it('breaks a recency tie by how often the file is opened', () => {
    const often = frecencyScore(entry('/often.md', 30, HOUR / 2), now);
    const once = frecencyScore(entry('/once.md', 1, HOUR / 2), now);
    expect(often).toBeGreaterThan(once);
  });

  it('caps frequency so one hot file cannot bury everything else', () => {
    const capped = frecencyScore(entry('/a.md', 50, HOUR / 2), now);
    const beyond = frecencyScore(entry('/b.md', 5_000, HOUR / 2), now);
    expect(beyond).toBe(capped);
  });

  it('counts an open without mutating the store it was given', () => {
    const before = { '/a.md': entry('/a.md', 1, DAY) };
    const after = recordOpen(before, '/a.md', now);
    expect(before['/a.md'].count).toBe(1);
    expect(after['/a.md'].count).toBe(2);
    expect(after['/a.md'].lastOpenedAt).toBe(now);
  });

  it('bounds the lift a history can give a search match', () => {
    const store = { '/a.md': entry('/a.md', 5_000, 0) };
    expect(searchBoost(store, '/a.md', now)).toBeLessThanOrEqual(SEARCH_BOOST_CAP);
    expect(searchBoost(store, '/unknown.md', now)).toBe(0);
  });
});

describe('keeping the store honest', () => {
  it('ranks by usefulness and prunes from the bottom', () => {
    const store = {
      '/hot.md': entry('/hot.md', 20, HOUR / 2),
      '/warm.md': entry('/warm.md', 3, 2 * DAY),
      '/cold.md': entry('/cold.md', 1, 200 * DAY),
    };
    expect(rankByFrecency(store, now)).toEqual(['/hot.md', '/warm.md', '/cold.md']);
    expect(Object.keys(pruneStore(store, now, 2)).sort()).toEqual(['/hot.md', '/warm.md']);
    expect(pruneStore(store, now, 10)).toBe(store);
  });

  it('removes exactly what is named, never what merely was not checked', () => {
    const store = {
      '/a.md': entry('/a.md', 1, DAY),
      '/b.md': entry('/b.md', 1, DAY),
      '/c.md': entry('/c.md', 1, DAY),
    };
    // Only /a.md was verified missing; /c.md was never looked at and must stay.
    expect(Object.keys(removePaths(store, ['/a.md'])).sort()).toEqual(['/b.md', '/c.md']);
    expect(removePaths(store, [])).toBe(store);
  });

  it('reads a persisted store without trusting any of it', () => {
    expect(coerceStore(null)).toEqual({});
    expect(coerceStore(['/legacy.md'])).toEqual({});
    expect(coerceStore({ '/a.md': { count: 'many', lastOpenedAt: 1 } })).toEqual({});
    expect(coerceStore({ '/a.md': { count: 2.7, lastOpenedAt: 5.9 } }))
      .toEqual({ '/a.md': { path: '/a.md', count: 2, lastOpenedAt: 5 } });
  });
});
