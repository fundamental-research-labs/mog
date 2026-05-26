/**
 * Formula Range Hit Testing
 *
 * Hit testing for formula range boxes and their resize handles.
 * Used by range box dragging to edit formula references.
 */

import type { RenderRegion } from '@mog/canvas-engine';
import type { CellRange } from '@mog-sdk/contracts/core';
import type { ViewportPositionIndexLike } from '@mog-sdk/contracts/rendering';

import { rangeRectInRegion } from '../shared/cell-bounds';

// =============================================================================
// DIMENSION PROVIDER (narrowed interface for public API consumers)
// =============================================================================

/**
 * Minimal dimension provider for formula range hit testing.
 *
 * This is a subset of `ViewportPositionIndexLike` that covers only the
 * methods actually used by the hit test path (rangeRectInRegion). It is
 * intentionally narrow so that the public `PositionDimensions` type from
 * `@mog-sdk/sheet-view` satisfies it without additional adapters.
 */
export interface FormulaRangeDimensionProvider {
  getRowTop(row: number): number;
  getRowHeight(row: number): number;
  getColLeft(col: number): number;
  getColWidth(col: number): number;
}

// =============================================================================
// TYPES
// =============================================================================

/**
 * Types of handles on a formula range box.
 */
export type FormulaRangeHandleType =
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right'
  | 'center'; // Center means dragging the entire range (move, not resize)

/**
 * Result of hitting a formula range box.
 */
export interface FormulaRangeHitResult {
  /** Index of the formula range that was hit */
  rangeIndex: number;
  /** Which handle was hit (or 'center' for body hit) */
  handleType: FormulaRangeHandleType;
  /** The original range coordinates */
  range: CellRange;
  /** Pixel bounds of the range box */
  bounds: { x: number; y: number; width: number; height: number };
}

// =============================================================================
// CONSTANTS
// =============================================================================

/** Size of resize handles in pixels */
const HANDLE_SIZE = 8;
/** Half handle size for centering */
const HALF_HANDLE = HANDLE_SIZE / 2;

// =============================================================================
// HIT TESTING FUNCTIONS
// =============================================================================

/**
 * Test if a point hits any formula range box or its handles.
 *
 * @param point Point in canvas coordinates (CSS pixels, relative to grid area)
 * @param formulaRanges Array of formula ranges with their colors and indices
 * @param region Render region whose canonical formula maps doc-space cell
 *   coordinates to region-local pixels (composes `viewportOrigin`,
 *   `scrollOffset`, `bounds`, and `zoom`). The caller passes the region
 *   the click landed in.
 * @param dimensionProvider Provides cell dimensions
 * @returns Hit result if a range was hit, null otherwise
 */
export function hitTestFormulaRanges(
  point: { x: number; y: number },
  formulaRanges: Array<{ range: CellRange; color: string; index: number }>,
  region: RenderRegion,
  dimensionProvider: FormulaRangeDimensionProvider,
): FormulaRangeHitResult | null {
  // Test in reverse order so top-most ranges are tested first
  for (let i = formulaRanges.length - 1; i >= 0; i--) {
    const { range, index } = formulaRanges[i];
    const bounds = rangeToPixelBounds(range, region, dimensionProvider);

    if (!bounds) continue;

    // Test handles first (they have priority)
    const handleHit = testHandles(point, bounds);
    if (handleHit) {
      return {
        rangeIndex: index,
        handleType: handleHit,
        range,
        bounds,
      };
    }

    // Test body (center)
    if (pointInBounds(point, bounds)) {
      return {
        rangeIndex: index,
        handleType: 'center',
        range,
        bounds,
      };
    }
  }

  return null;
}

/**
 * Convert a cell range to region-local pixel bounds. Composes the canonical
 * helper `rangeRectInRegion` (which composes `docToCanvasXY`) so the
 * doc⇄canvas formula lives in exactly one place.
 */
function rangeToPixelBounds(
  range: CellRange,
  region: RenderRegion,
  dimensionProvider: FormulaRangeDimensionProvider,
): { x: number; y: number; width: number; height: number } | null {
  // The narrow FormulaRangeDimensionProvider is structurally compatible with
  // the methods rangeRectInRegion actually calls (getRowTop, getRowHeight,
  // getColLeft, getColWidth). The broader ViewportPositionIndexLike parameter
  // type on rangeRectInRegion is a legacy constraint from other call sites.
  return rangeRectInRegion(
    region,
    range.startRow,
    range.startCol,
    range.endRow,
    range.endCol,
    dimensionProvider as ViewportPositionIndexLike,
  );
}

/**
 * Test if a point is inside bounds (with some tolerance).
 */
function pointInBounds(
  point: { x: number; y: number },
  bounds: { x: number; y: number; width: number; height: number },
  tolerance = 0,
): boolean {
  return (
    point.x >= bounds.x - tolerance &&
    point.x <= bounds.x + bounds.width + tolerance &&
    point.y >= bounds.y - tolerance &&
    point.y <= bounds.y + bounds.height + tolerance
  );
}

/**
 * Test which handle (if any) was hit.
 */
function testHandles(
  point: { x: number; y: number },
  bounds: { x: number; y: number; width: number; height: number },
): FormulaRangeHandleType | null {
  const handles: Array<{
    type: FormulaRangeHandleType;
    x: number;
    y: number;
  }> = [
    { type: 'top-left', x: bounds.x, y: bounds.y },
    { type: 'top-right', x: bounds.x + bounds.width, y: bounds.y },
    { type: 'bottom-left', x: bounds.x, y: bounds.y + bounds.height },
    { type: 'bottom-right', x: bounds.x + bounds.width, y: bounds.y + bounds.height },
  ];

  for (const handle of handles) {
    if (
      point.x >= handle.x - HALF_HANDLE &&
      point.x <= handle.x + HALF_HANDLE &&
      point.y >= handle.y - HALF_HANDLE &&
      point.y <= handle.y + HALF_HANDLE
    ) {
      return handle.type;
    }
  }

  return null;
}

/**
 * Calculate the new range after dragging a handle.
 *
 * @param originalRange The original range before dragging
 * @param handleType Which handle is being dragged
 * @param targetCell The cell the handle is being dragged to
 * @returns The new range, normalized (start <= end)
 */
export function calculateDraggedRange(
  originalRange: CellRange,
  handleType: FormulaRangeHandleType,
  targetCell: { row: number; col: number },
): CellRange {
  let startRow = originalRange.startRow;
  let startCol = originalRange.startCol;
  let endRow = originalRange.endRow;
  let endCol = originalRange.endCol;

  switch (handleType) {
    case 'top-left':
      startRow = targetCell.row;
      startCol = targetCell.col;
      break;
    case 'top-right':
      startRow = targetCell.row;
      endCol = targetCell.col;
      break;
    case 'bottom-left':
      endRow = targetCell.row;
      startCol = targetCell.col;
      break;
    case 'bottom-right':
      endRow = targetCell.row;
      endCol = targetCell.col;
      break;
    case 'center': {
      const isSingleCell =
        originalRange.startRow === originalRange.endRow &&
        originalRange.startCol === originalRange.endCol;

      if (isSingleCell) {
        // For single-cell references, expand the range to include the target cell.
        // This matches the expected UX: dragging a single cell reference like E2
        // to E5 produces E2:E5, not a move to E5.
        startRow = Math.min(originalRange.startRow, targetCell.row);
        startCol = Math.min(originalRange.startCol, targetCell.col);
        endRow = Math.max(originalRange.endRow, targetCell.row);
        endCol = Math.max(originalRange.endCol, targetCell.col);
      } else {
        // Move the entire range
        const rowDelta = targetCell.row - originalRange.startRow;
        const colDelta = targetCell.col - originalRange.startCol;
        startRow = originalRange.startRow + rowDelta;
        startCol = originalRange.startCol + colDelta;
        endRow = originalRange.endRow + rowDelta;
        endCol = originalRange.endCol + colDelta;
      }
      break;
    }
  }

  // Normalize (ensure start <= end)
  return {
    startRow: Math.min(startRow, endRow),
    startCol: Math.min(startCol, endCol),
    endRow: Math.max(startRow, endRow),
    endCol: Math.max(startCol, endCol),
  };
}

/**
 * Get the cursor style for a formula range handle.
 */
export function getHandleCursor(handleType: FormulaRangeHandleType | null): string {
  switch (handleType) {
    case 'top-left':
    case 'bottom-right':
      return 'nwse-resize';
    case 'top-right':
    case 'bottom-left':
      return 'nesw-resize';
    case 'center':
      return 'move';
    default:
      return 'default';
  }
}
