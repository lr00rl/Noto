/**
 * Sizing the guide lines a tree draws down its levels.
 *
 * The lines are two gradients on each level rather than elements of their own,
 * so the only thing a stylesheet cannot work out for itself is how far down to
 * draw them. That is a measurement, and it is the same measurement for the file
 * tree and for the outline, which is why it lives here rather than inside
 * either of them: the outline had the same markup and the same stylesheet and,
 * because nothing measured it, drew its stems the full height of every level
 * and straight over the corner at the foot of each.
 *
 * Pure DOM and no React, so it can be called from an effect in either component
 * and tested against a fragment.
 */

/**
 * Measure every level under `container` and set the stem's length on it.
 *
 * The stem stops at the top of the last child rather than at the bottom of the
 * level. The last child draws a rounded corner that takes the line the rest of
 * the way and round the bend, and a stem running past that point would be
 * drawn straight over the curve. The extra pixel is the overlap that keeps the
 * join from showing a seam at a fractional scale factor.
 *
 * Nothing is lit. The theme this tree imitates draws every connector in one
 * colour and keeps the accent for the active row alone.
 */
export function sizeTreeGuides(container: HTMLElement): void {
  for (const level of container.querySelectorAll<HTMLElement>('.tree-level')) {
    const last = level.lastElementChild as HTMLElement | null;
    if (last) {
      level.style.setProperty('--stem-stop', `${Math.max(0, last.offsetTop - level.offsetTop + 1)}px`);
    } else {
      level.style.removeProperty('--stem-stop');
    }
  }
}
