/**
 * Coordinate System Types
 *
 * Re-exports coordinate types from @mog-sdk/contracts.
 * The canonical definitions are in contracts/src/rendering/coordinates.ts.
 *
 * Coordinate Spaces:
 * 1. CELL SPACE - Logical cell references { row: 0, col: 0 } = A1
 * 2. DOCUMENT SPACE - Full document coordinates in pixels (no scroll)
 * 3. VIEWPORT SPACE - What you see on screen (accounts for scroll)
 * 4. CANVAS SPACE - Physical pixels on canvas (viewport * devicePixelRatio)
 *
 * @module canvas/coordinates/types
 */

// Re-export all coordinate types from contracts - these are the canonical definitions
export type { CellRange } from '@mog-sdk/contracts/core';
export type {
  CellCoord,
  CoordinateSystem,
  FrozenPanes,
  HitTestResult,
  ScrollViewport,
  VisibleRegions,
} from '@mog-sdk/contracts/rendering';
export type { Point, Rect } from '@mog-sdk/contracts/viewport';
