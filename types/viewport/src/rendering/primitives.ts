/**
 * Rendering Primitive Types
 *
 * Fundamental types used throughout the rendering system.
 * Extracted to break circular dependencies.
 *
 * @module @mog-sdk/contracts/rendering/primitives
 */

// =============================================================================
// Cell Coordinate
// =============================================================================

/**
 * Simple cell coordinate (row, col).
 * Used for: single cell positions, active cell, anchor points, invalidation, etc.
 */
export interface CellCoord {
  row: number;
  col: number;
}
