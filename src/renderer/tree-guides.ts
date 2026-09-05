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

/** Where the arm crosses a row, matching `--tree-arm` in the stylesheet. */
export const TREE_ARM = 14;

export interface TreeGuideOptions {
  /**
   * The child of `level` on the way to the file in front, or null on a level
   * that leads nowhere. The lit stem runs from the level's top to that child's
   * arm, which is the author's tree-guides plugin's rule. The outline passes
   * nothing: every level of one is visible at once and there is no branch to
   * lead the eye along.
   */
  readonly litChild?: (level: HTMLElement) => HTMLElement | null;
}

/**
 * Measure every level under `container` and set its two lengths.
 *
 * The quiet stem stops at the top of the last child rather than at the bottom
 * of the level. The last child draws a rounded corner that takes the line the
 * rest of the way and round the bend, and a stem running past that point would
 * be drawn straight over the curve. The extra pixel is the overlap that keeps
 * the join from showing a seam at a fractional scale factor.
 *
 * The lit stem, where there is one, stops exactly at the arm of the child on
 * the path, so the arm's own lit colour carries on from where it ends.
 */
/**
 * How far down the level a child sits.
 *
 * The level is the positioned ancestor of its own children, so their offsets
 * are already measured from it; a level whose stylesheet has not made it one
 * needs its own offset taken off. Getting this wrong is silent and looks like
 * a stem of the right length in the wrong place, which is how the lit branch
 * came to be measured at a negative height.
 */
function offsetIn(level: HTMLElement, child: HTMLElement): number {
  return child.offsetParent === level ? child.offsetTop : child.offsetTop - level.offsetTop;
}

export function sizeTreeGuides(container: HTMLElement, options: TreeGuideOptions = {}): void {
  for (const level of container.querySelectorAll<HTMLElement>('.tree-level')) {
    const last = level.lastElementChild as HTMLElement | null;
    if (last) {
      level.style.setProperty('--stem-stop', `${Math.max(0, offsetIn(level, last) + 1)}px`);
    } else {
      level.style.removeProperty('--stem-stop');
    }

    const lit = options.litChild?.(level) ?? null;
    if (!lit) {
      level.style.removeProperty('--path-stop');
      continue;
    }
    // The lit stem ends where the quiet one would: at the arm of the child on
    // the path, or, when that child is the last of its level, at its top,
    // because from there the child's own corner draws the line and the curve.
    // Running the straight stem down through the curve drew two lines over
    // each other at the join, and the corner that is smooth unlit came out
    // ragged the moment it was lit.
    const stop = lit === last
      ? Math.max(0, offsetIn(level, lit) + 1)
      : offsetIn(level, lit) + TREE_ARM;
    level.style.setProperty('--path-stop', `${stop}px`);
  }
}

/**
 * Where each level's stems begin, once the rail has been scrolled.
 *
 * A folder on the path to the open file holds its row at the top of the rail
 * while its contents scroll past. The level under that row keeps its own top
 * far above, so its stem was drawn from there: straight up through the held
 * row and every row held above it, which is a line where the tree has no
 * line, and a lit branch that ran the height of the rail.
 *
 * The author's own tree-guides plugin answers this by starting each group at
 * its parent row's current bottom rather than at the group's top, and that is
 * what this measures. Read on scroll, since it is the scroll that moves it.
 */
export function startTreeGuides(container: HTMLElement): void {
  for (const level of container.querySelectorAll<HTMLElement>('.tree-level:not(.is-root)')) {
    const row = level.parentElement?.querySelector<HTMLElement>(':scope > .tree-row');
    if (!row) {
      level.style.removeProperty('--stem-start');
      continue;
    }
    const start = row.getBoundingClientRect().bottom - level.getBoundingClientRect().top;
    if (start > 0.5) level.style.setProperty('--stem-start', `${Math.round(start)}px`);
    else level.style.removeProperty('--stem-start');
  }
}

/** The child of `level` that leads to the file in front, if any. */
export function branchToCurrentFile(level: HTMLElement): HTMLElement | null {
  return level.querySelector<HTMLElement>(
    ':scope > .tree-node-active, :scope > .tree-node:has(> .tree-on-path)',
  );
}
