/**
 * Pure-primitive rendering bounds types
 *
 * Leaf types (zero intra-contracts deps) that describe geometric/visual
 * records. Tier-1 contract: they are consumed by both
 * Tier 2 machines/actors and Tier 2 rendering, so hosting them here
 * breaks what would otherwise be a types-machines ↔ types-rendering cycle.
 *
 * @module @mog/types-viewport/rendering/bounds
 */

/**
 * Object bounds in pixel coordinates.
 * Used for rendering floating objects on the overlay layer.
 *
 * Originated in contracts/src/rendering/hit-test.ts; the canonical home
 * is now this leaf file.
 */
export interface ObjectBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}

/**
 * Type of page break being dragged.
 */
export type PageBreakType = 'manual' | 'automatic';

/**
 * Orientation of the page break line.
 * - horizontal: breaks between rows (spans columns)
 * - vertical: breaks between columns (spans rows)
 */
export type PageBreakOrientation = 'horizontal' | 'vertical';

/**
 * Information about a page break being dragged.
 *
 * Originated in contracts/src/rendering/render-context.ts; the canonical
 * home is now this leaf file.
 */
export interface PageBreakInfo {
  /** Type of page break (manual or automatic) */
  type: PageBreakType;
  /** Orientation of the page break line */
  orientation: PageBreakOrientation;
  /** Original position (row index for horizontal, col index for vertical) */
  originalPosition: number;
  /** Sheet ID where the page break exists */
  sheetId: string;
}
