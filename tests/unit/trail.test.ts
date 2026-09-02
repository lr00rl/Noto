import { describe, expect, it } from 'vitest';
import { EMPTY_TRAIL, forget, record, stepBack, stepForward, TRAIL_CAP } from '../../src/renderer/trail';

const visit = (...paths: string[]) => paths.reduce(record, EMPTY_TRAIL);

describe('the trail', () => {
  it('remembers where you came from, three deep', () => {
    const trail = visit('a', 'b', 'c', 'd', 'e');
    expect(trail.current).toBe('e');
    expect(trail.back).toEqual(['b', 'c', 'd']);
    expect(trail.back).toHaveLength(TRAIL_CAP);
    expect(trail.forward).toEqual([]);
  });

  it('steps back and forward without recording, like a browser', () => {
    const back = stepBack(visit('a', 'b', 'c'))!;
    expect(back.target).toBe('b');
    expect(back.trail).toEqual({ back: ['a'], forward: ['c'], current: 'b' });

    const again = stepBack(back.trail)!;
    expect(again.target).toBe('a');
    expect(again.trail).toEqual({ back: [], forward: ['b', 'c'], current: 'a' });
    expect(stepBack(again.trail)).toBeNull();

    const forward = stepForward(again.trail)!;
    expect(forward.target).toBe('b');
    expect(forward.trail).toEqual({ back: ['a'], forward: ['c'], current: 'b' });
  });

  it('clears the way forward when you open something new from the middle', () => {
    const back = stepBack(visit('a', 'b', 'c'))!.trail;
    const fresh = record(back, 'x');
    expect(fresh).toEqual({ back: ['a', 'b'], forward: [], current: 'x' });
  });

  it('does not record the note that is already in front', () => {
    const trail = visit('a', 'b');
    expect(record(trail, 'b')).toBe(trail);
    // A note visited twice is in the trail twice, as in a browser: the trail
    // is where you went, not a set of places.
    expect(visit('a', 'b', 'a', 'b').back).toEqual(['a', 'b', 'a']);
  });

  it('forgets a note that is gone', () => {
    const trail = forget(visit('a', 'b', 'c'), 'b');
    expect(trail).toEqual({ back: ['a'], forward: [], current: 'c' });
    expect(stepBack(trail)!.target).toBe('a');
  });
});
