/**
 * Subpixel Snapping Utility
 *
 * Snaps coordinates to half-pixel boundaries for crisp line rendering
 * on high-DPI displays. All layers drawing lines (grid lines, borders,
 * selection outlines, dividers) should use this.
 *
 * @module @mog/canvas-engine/utils
 */

/**
 * Snap a coordinate to the nearest half-pixel boundary for the given DPR.
 *
 * This ensures crisp 1px lines on high-DPI displays. Without snapping,
 * lines that fall between physical pixels appear blurry (anti-aliased
 * across 2 pixels instead of sharp on 1 pixel).
 *
 * Formula: Math.floor(value * dpr) / dpr + 0.5 / dpr
 *
 * @param value - Coordinate in CSS pixels
 * @param dpr - Device pixel ratio
 * @returns Snapped coordinate in CSS pixels
 */
export function snapToPixelGrid(value: number, dpr: number): number {
  return Math.floor(value * dpr) / dpr + 0.5 / dpr;
}
