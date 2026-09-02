/**
 * The arithmetic behind dragging a table row or column into a new place.
 *
 * Kept apart from the DOM so the awkward parts can be tested directly: which
 * gap a pointer is nearest, and what the order becomes when something is
 * lifted out of one place and put down in another. Both are one-off-by-one
 * away from being wrong in a way that is hard to see on screen.
 */

/**
 * The gap the pointer is in, given the edges of every track.
 *
 * `edges` holds one more number than there are tracks: the start of the first,
 * then the end of each. The answer is a gap index, so 0 is before the first
 * track and `edges.length - 1` is after the last.
 */
export function dropIndex(edges: readonly number[], pointer: number): number {
  if (edges.length < 2) return 0;
  let nearest = 0;
  let best = Math.abs(pointer - edges[0]);
  for (let i = 1; i < edges.length; i += 1) {
    const distance = Math.abs(pointer - edges[i]);
    if (distance < best) {
      best = distance;
      nearest = i;
    }
  }
  return nearest;
}

/**
 * The order after taking the track at `from` and putting it down in gap `to`.
 *
 * Gaps are counted in the original order, which is what a drop indicator drawn
 * between two tracks means. Dropping into either gap beside where the track
 * already is leaves the order alone.
 */
export function reorder(count: number, from: number, to: number): number[] {
  const order = Array.from({ length: count }, (_, i) => i);
  if (from < 0 || from >= count || to < 0 || to > count) return order;
  order.splice(from, 1);
  order.splice(to > from ? to - 1 : to, 0, from);
  return order;
}

/** Whether a drop in gap `to` would actually move the track at `from`. */
export function movesAnything(from: number, to: number): boolean {
  return to !== from && to !== from + 1;
}
