/**
 * Frecency: how recently and how often a file is opened, in one number.
 *
 * Pure recency forgets that a note opened ten times a day matters more than one
 * touched once last night. Pure frequency never lets go of a note opened
 * constantly last month and never since. Blending them is what makes an empty
 * quick-open box already show the right five files, which is what lets it stand
 * in for navigating the tree at all.
 *
 * Ported from the author's `fuzzy-search` Typora plugin. Pure and serialisable,
 * so it can be tested without a filesystem and persisted as plain JSON.
 */

export interface FrecencyEntryV1 {
  readonly path: string;
  readonly count: number;
  /** Epoch milliseconds of the most recent open. */
  readonly lastOpenedAt: number;
}

export type FrecencyStoreV1 = Readonly<Record<string, FrecencyEntryV1>>;

/** Frequency stops earning weight here, so one hot file cannot bury the rest. */
export const FREQUENCY_CAP = 50;

/** Paths kept before the least useful are dropped. */
export const STORE_CAP = 400;

/**
 * Recency weight, in bands rather than a smooth decay.
 *
 * Bands are legible and testable: everything opened within the hour shares the
 * top one, and the steps down are places a person would recognise, which
 * matters when explaining why a file ranked where it did.
 */
export function recencyWeight(ageMs: number): number {
  const hour = 3_600_000;
  const day = 24 * hour;
  // Clock skew, or a file opened in the future. Treat it as just now rather
  // than letting a negative age produce a nonsense weight.
  if (ageMs < 0) return 100;
  if (ageMs <= hour) return 100;
  if (ageMs <= day) return 80;
  if (ageMs <= 7 * day) return 60;
  if (ageMs <= 30 * day) return 40;
  if (ageMs <= 90 * day) return 20;
  return 10;
}

/** Recency dominates; frequency is a capped tie-breaker underneath it. */
export function frecencyScore(entry: FrecencyEntryV1, now: number): number {
  return recencyWeight(now - entry.lastOpenedAt) + Math.min(entry.count, FREQUENCY_CAP) * 2;
}

/** Record an open. Never mutates the store it is given. */
export function recordOpen(store: FrecencyStoreV1, path: string, now: number): FrecencyStoreV1 {
  const existing = store[path];
  return {
    ...store,
    [path]: { path, count: (existing?.count ?? 0) + 1, lastOpenedAt: now },
  };
}

/** Paths by frecency, most useful first. */
export function rankByFrecency(store: FrecencyStoreV1, now: number): string[] {
  return Object.values(store)
    .map((entry) => ({ path: entry.path, score: frecencyScore(entry, now) }))
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
    .map((entry) => entry.path);
}

/** The most a file's history may lift it in a text search. */
export const SEARCH_BOOST_CAP = 40;

/**
 * A bounded lift for a file's history, added to its match score.
 *
 * Bounded on purpose: a file you open constantly should win among comparable
 * matches, and should still lose to a file whose name you actually typed.
 */
export function searchBoost(store: FrecencyStoreV1, path: string, now: number): number {
  const entry = store[path];
  if (!entry) return 0;
  return Math.min(SEARCH_BOOST_CAP, frecencyScore(entry, now) * 0.2);
}

/** Drop the least useful entries once the store outgrows `max`. */
export function pruneStore(store: FrecencyStoreV1, now: number, max = STORE_CAP): FrecencyStoreV1 {
  const ranked = rankByFrecency(store, now);
  if (ranked.length <= max) return store;
  const keep = new Set(ranked.slice(0, max));
  const next: Record<string, FrecencyEntryV1> = {};
  for (const path of keep) {
    const entry = store[path];
    if (entry) next[path] = entry;
  }
  return next;
}

/**
 * Remove exactly the paths named.
 *
 * Keyed on what is confirmed gone, never on what survived a check: callers
 * verify only the handful of paths they are about to show, and inverting that
 * would delete every entry they did not look at.
 */
export function removePaths(store: FrecencyStoreV1, missing: Iterable<string>): FrecencyStoreV1 {
  const drop = missing instanceof Set ? missing : new Set(missing);
  if (drop.size === 0) return store;
  const next: Record<string, FrecencyEntryV1> = {};
  for (const [path, entry] of Object.entries(store)) {
    if (!drop.has(path)) next[path] = entry;
  }
  return next;
}

/** Read a persisted store without trusting any of it. */
export function coerceStore(value: unknown): FrecencyStoreV1 {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  const next: Record<string, FrecencyEntryV1> = {};
  for (const [path, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw !== 'object' || raw === null) continue;
    const entry = raw as Partial<FrecencyEntryV1>;
    if (typeof entry.count !== 'number' || !Number.isFinite(entry.count)) continue;
    if (typeof entry.lastOpenedAt !== 'number' || !Number.isFinite(entry.lastOpenedAt)) continue;
    next[path] = {
      path,
      count: Math.max(0, Math.floor(entry.count)),
      lastOpenedAt: Math.floor(entry.lastOpenedAt),
    };
  }
  return next;
}
