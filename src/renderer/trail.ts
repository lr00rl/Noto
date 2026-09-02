/**
 * The trail: bounded back and forward across recently visited notes.
 *
 * Ported from the author's `trail` plugin for Typora. Two stacks, each capped
 * at three entries. A user-driven open pushes the note being left onto the
 * back stack and clears forward, as a browser does; stepping back or forward
 * moves one entry between the stacks without recording, which the shell
 * signals by replaying the open rather than by asking the trail to guess.
 *
 * Pure, so the arithmetic is tested on its own and the shell only decides
 * when to record.
 */

/** Three each way. Past that nobody remembers where they were, they search. */
export const TRAIL_CAP = 3;

export interface Trail {
  readonly back: readonly string[];
  readonly forward: readonly string[];
  readonly current: string | null;
}

export const EMPTY_TRAIL: Trail = Object.freeze({ back: [], forward: [], current: null });

/** A note came to the front by the reader's own hand. */
export function record(trail: Trail, path: string): Trail {
  if (path === trail.current) return trail;
  const back = trail.current === null
    ? trail.back
    : [...trail.back, trail.current].slice(-TRAIL_CAP);
  return { back, forward: [], current: path };
}

export function stepBack(trail: Trail): { trail: Trail; target: string } | null {
  const target = trail.back.at(-1);
  if (target === undefined) return null;
  const forward = trail.current === null ? trail.forward : [trail.current, ...trail.forward].slice(0, TRAIL_CAP);
  return { target, trail: { back: trail.back.slice(0, -1), forward, current: target } };
}

export function stepForward(trail: Trail): { trail: Trail; target: string } | null {
  const target = trail.forward[0];
  if (target === undefined) return null;
  const back = trail.current === null ? trail.back : [...trail.back, trail.current].slice(-TRAIL_CAP);
  return { target, trail: { back, forward: trail.forward.slice(1), current: target } };
}

/** A note that no longer exists is not somewhere to go back to. */
export function forget(trail: Trail, path: string): Trail {
  return {
    back: trail.back.filter((entry) => entry !== path),
    forward: trail.forward.filter((entry) => entry !== path),
    current: trail.current === path ? null : trail.current,
  };
}
