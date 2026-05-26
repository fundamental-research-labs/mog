/**
 * Anchor Types for Drawing Engine
 *
 * Pure math types for anchor resolution. The bridge (kernel) handles
 * CellId -> { row, col } translation. This package receives pre-resolved positions.
 */

// =============================================================================
// CELL DIMENSION LOOKUP
// =============================================================================

/**
 * Interface for looking up cell dimensions.
 * The bridge provides this; drawing-engine never touches CellId resolution.
 */
export interface CellDimensionLookup {
  /** Get the height of a row in pixels */
  getRowHeight(row: number): number;
  /** Get the width of a column in pixels */
  getColWidth(col: number): number;
  /** Get the Y position of a row's top edge */
  getRowTop(row: number): number;
  /** Get the X position of a column's left edge */
  getColLeft(col: number): number;
}

// =============================================================================
// ANCHOR TYPES
// =============================================================================

/**
 * A point anchored to a cell with pixel offsets.
 * Row/col are pre-resolved (from CellId via the bridge).
 */
export interface AnchorPoint {
  /** Row index (0-based, pre-resolved) */
  row: number;
  /** Column index (0-based, pre-resolved) */
  col: number;
  /** Horizontal offset from cell left edge in pixels */
  xOffset: number;
  /** Vertical offset from cell top edge in pixels */
  yOffset: number;
}

/**
 * Two-cell anchor: object is anchored to two cells and resizes with them.
 */
export interface TwoCellAnchor {
  type: 'twoCell';
  from: AnchorPoint;
  to: AnchorPoint;
}

/**
 * One-cell anchor: object is anchored to one cell, moves with it,
 * but has explicit width/height that don't change when cells resize.
 */
export interface OneCellAnchor {
  type: 'oneCell';
  from: AnchorPoint;
  width: number;
  height: number;
}

/**
 * Absolute anchor: object has an absolute position that doesn't move with cells.
 */
export interface AbsoluteAnchor {
  type: 'absolute';
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Union of all anchor types.
 */
export type Anchor = TwoCellAnchor | OneCellAnchor | AbsoluteAnchor;
