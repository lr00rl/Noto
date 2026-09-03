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
export const TREE_ARM_OFFSET = 13;

export interface TreeGuideOptions {
  /**
   * How far down the lit branch reaches, or null on a level that is not on the
   * path to anything. The outline passes nothing: it has a current heading but
   * no branch leading to it, since every level is visible at once.
   */
  readonly litChild?: (level: HTMLElement) => HTMLElement | null;
  /** Where the lit stem stops within its child. Half a row, by default. */
  readonly litOffset?: number;
}

/**
 * Measure every level under `container` and set the two lengths on it.
 *
 * The quiet stem stops at the top of the last child rather than at the bottom
 * of the level. The last child draws a rounded corner that takes the line the
 * rest of the way and round the bend, and a stem running past that point would
 * be drawn straight over the curve. The extra pixel is the overlap that keeps
 * the join from showing a seam at a fractional scale factor.
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
    const offset = options.litOffset ?? TREE_ARM_OFFSET;
    level.style.setProperty('--path-stop', `${lit.offsetTop - level.offsetTop + offset}px`);
  }
}

/** The child of `level` that leads to the file in front, if any. */
export function branchToCurrentFile(level: HTMLElement): HTMLElement | null {
  return level.querySelector<HTMLElement>(
    ':scope > .tree-node-active, :scope > .tree-node:has(> .tree-on-path)',
  );
}
