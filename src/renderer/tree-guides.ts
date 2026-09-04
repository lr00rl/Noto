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
export function sizeTreeGuides(container: HTMLElement, options: TreeGuideOptions = {}): void {
  for (const level of container.querySelectorAll<HTMLElement>('.tree-level')) {
    const last = level.lastElementChild as HTMLElement | null;
    if (last) {
      level.style.setProperty('--stem-stop', `${Math.max(0, last.offsetTop - level.offsetTop + 1)}px`);
    } else {
      level.style.removeProperty('--stem-stop');
    }

    const lit = options.litChild?.(level) ?? null;
    if (!lit) {
      level.style.removeProperty('--path-stop');
      continue;
    }
    level.style.setProperty('--path-stop', `${lit.offsetTop - level.offsetTop + TREE_ARM}px`);
  }
}

/** The child of `level` that leads to the file in front, if any. */
export function branchToCurrentFile(level: HTMLElement): HTMLElement | null {
  return level.querySelector<HTMLElement>(
    ':scope > .tree-node-active, :scope > .tree-node:has(> .tree-on-path)',
  );
}
