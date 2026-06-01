/**
 * Position Adjustment Utilities
 *
 * Pure functions for adjusting cell positions and ranges after structure changes
 * (row/column insert/delete). These are used by state machines to keep their
 * coordinates in sync with the grid after structure modifications.
 *
 * Design Principles:
 * - PURE functions - no side effects, fully deterministic
 * - Return null when position/range is deleted
 * - Preserve immutability - always return new objects
 * - Handle edge cases (empty ranges, boundary conditions)
 *
 * @see ISSUE-1-STRUCTURE-CHANGE-COORDINATION.md
 */

import type { CellRange } from '@mog-sdk/contracts/core';
import type { CellCoord } from '@mog-sdk/contracts/rendering';

import { clampCell } from '../types';

// =============================================================================
// STRUCTURE CHANGE TYPE
// =============================================================================

/**
 * Represents a structural change to the grid.
 * Used to communicate what changed so positions can be adjusted.
 */
export type StructureChange =
  | { type: 'rows:inserted'; sheetId: string; startRow: number; count: number }
  | { type: 'rows:deleted'; sheetId: string; startRow: number; count: number }
  | { type: 'columns:inserted'; sheetId: string; startCol: number; count: number }
  | { type: 'columns:deleted'; sheetId: string; startCol: number; count: number };

// =============================================================================
// STRUCTURE CHANGE FACTORIES
// =============================================================================

/**
 * Factory functions for creating StructureChange objects.
 * Use these instead of inline objects to avoid magic strings.
 */
export const StructureChanges = {
  rowsInserted: (sheetId: string, startRow: number, count: number): StructureChange => ({
    type: 'rows:inserted',
    sheetId,
    startRow,
    count,
  }),

  rowsDeleted: (sheetId: string, startRow: number, count: number): StructureChange => ({
    type: 'rows:deleted',
    sheetId,
    startRow,
    count,
  }),

  columnsInserted: (sheetId: string, startCol: number, count: number): StructureChange => ({
    type: 'columns:inserted',
    sheetId,
    startCol,
    count,
  }),

  columnsDeleted: (sheetId: string, startCol: number, count: number): StructureChange => ({
    type: 'columns:deleted',
    sheetId,
    startCol,
    count,
  }),
} as const;

// =============================================================================
// POSITION ADJUSTMENT
// =============================================================================

/**
 * Adjust a single cell position after a structure change.
 *
 * @param cell - The cell coordinate to adjust
 * @param change - The structure change that occurred
 * @returns Adjusted position, or null if the cell was deleted
 *
 * @example
 * // Row inserted above cell
 * adjustPosition({ row: 5, col: 0 }, { type: 'rows:inserted', sheetId: 's1', startRow: 3, count: 1 })
 * // Returns { row: 6, col: 0 }
 *
 * @example
 * // Cell's row deleted
 * adjustPosition({ row: 5, col: 0 }, { type: 'rows:deleted', sheetId: 's1', startRow: 5, count: 1 })
 * // Returns null
 */
export function adjustPosition(cell: CellCoord, change: StructureChange): CellCoord | null {
  switch (change.type) {
    case 'rows:inserted':
      // If cell is at or below the insert point, shift down
      if (cell.row >= change.startRow) {
        return { row: cell.row + change.count, col: cell.col };
      }
      return cell;

    case 'rows:deleted': {
      const deleteEndRow = change.startRow + change.count - 1;

      // Cell is within the deleted range
      if (cell.row >= change.startRow && cell.row <= deleteEndRow) {
        return null;
      }

      // Cell is below the deleted range - shift up
      if (cell.row > deleteEndRow) {
        return { row: cell.row - change.count, col: cell.col };
      }

      // Cell is above the deleted range - no change
      return cell;
    }

    case 'columns:inserted':
      // If cell is at or right of the insert point, shift right
      if (cell.col >= change.startCol) {
        return { row: cell.row, col: cell.col + change.count };
      }
      return cell;

    case 'columns:deleted': {
      const deleteEndCol = change.startCol + change.count - 1;

      // Cell is within the deleted range
      if (cell.col >= change.startCol && cell.col <= deleteEndCol) {
        return null;
      }

      // Cell is right of the deleted range - shift left
      if (cell.col > deleteEndCol) {
        return { row: cell.row, col: cell.col - change.count };
      }

      // Cell is left of the deleted range - no change
      return cell;
    }
  }
}

// =============================================================================
// RANGE ADJUSTMENT
// =============================================================================

/**
 * Adjust a cell range after a structure change.
 *
 * Handles all cases:
 * 1. Range fully above/left of change → no change
 * 2. Range fully below/right of change → shift entire range
 * 3. Insert inside range → expand range
 * 4. Delete inside range → contract range
 * 5. Delete overlaps range start → adjust start
 * 6. Delete overlaps range end → adjust end
 * 7. Delete encompasses entire range → return null
 *
 * @param range - The range to adjust
 * @param change - The structure change that occurred
 * @returns Adjusted range, or null if entire range was deleted
 *
 * @example
 * // Row inserted inside range expands it
 * adjustRange({ startRow: 0, startCol: 0, endRow: 4, endCol: 0 },
 * { type: 'rows:inserted', sheetId: 's1', startRow: 2, count: 1 })
 * // Returns { startRow: 0, startCol: 0, endRow: 5, endCol: 0 }
 */
export function adjustRange(range: CellRange, change: StructureChange): CellRange | null {
  // Normalize range (ensure start <= end)
  const minRow = Math.min(range.startRow, range.endRow);
  const maxRow = Math.max(range.startRow, range.endRow);
  const minCol = Math.min(range.startCol, range.endCol);
  const maxCol = Math.max(range.startCol, range.endCol);

  switch (change.type) {
    case 'rows:inserted':
      return adjustRangeForRowInsert(range, minRow, maxRow, change.startRow, change.count);

    case 'rows:deleted':
      return adjustRangeForRowDelete(range, minRow, maxRow, change.startRow, change.count);

    case 'columns:inserted':
      return adjustRangeForColInsert(range, minCol, maxCol, change.startCol, change.count);

    case 'columns:deleted':
      return adjustRangeForColDelete(range, minCol, maxCol, change.startCol, change.count);
  }
}

/**
 * Adjust range for row insertion.
 */
function adjustRangeForRowInsert(
  range: CellRange,
  minRow: number,
  maxRow: number,
  insertRow: number,
  count: number,
): CellRange {
  // Case 1: Insert is below range - no change
  if (insertRow > maxRow) {
    return range;
  }

  // Case 2: Insert is above range - shift entire range down
  if (insertRow <= minRow) {
    return {
      ...range,
      startRow: range.startRow + count,
      endRow: range.endRow + count,
    };
  }

  // Case 3: Insert is inside range - expand range
  // Adjust the "bottom" of the range (whichever bound is larger)
  if (range.startRow >= range.endRow) {
    // Reversed range - startRow is the bottom
    return {
      ...range,
      startRow: range.startRow + count,
    };
  } else {
    // Normal range - endRow is the bottom
    return {
      ...range,
      endRow: range.endRow + count,
    };
  }
}

/**
 * Adjust range for row deletion.
 */
function adjustRangeForRowDelete(
  range: CellRange,
  minRow: number,
  maxRow: number,
  deleteStart: number,
  count: number,
): CellRange | null {
  const deleteEnd = deleteStart + count - 1;

  // Case 1: Delete is entirely below range - no change
  if (deleteStart > maxRow) {
    return range;
  }

  // Case 2: Delete is entirely above range - shift entire range up
  if (deleteEnd < minRow) {
    return {
      ...range,
      startRow: range.startRow - count,
      endRow: range.endRow - count,
    };
  }

  // Case 3: Delete encompasses entire range - return null
  if (deleteStart <= minRow && deleteEnd >= maxRow) {
    return null;
  }

  // Case 4: Delete overlaps start of range
  if (deleteStart <= minRow && deleteEnd < maxRow) {
    // New start is at delete position, end shifts up
    const newStartRow = deleteStart;
    const newEndRow = range.endRow - count;

    // Preserve direction (startRow vs endRow relationship)
    if (range.startRow <= range.endRow) {
      return { ...range, startRow: newStartRow, endRow: newEndRow };
    } else {
      return { ...range, startRow: newEndRow, endRow: newStartRow };
    }
  }

  // Case 5: Delete overlaps end of range
  if (deleteStart > minRow && deleteEnd >= maxRow) {
    // Start unchanged, end becomes row before delete
    const newEndRow = deleteStart - 1;

    // Preserve direction
    if (range.startRow <= range.endRow) {
      return { ...range, endRow: newEndRow };
    } else {
      return { ...range, startRow: newEndRow };
    }
  }

  // Case 6: Delete is entirely inside range - contract range
  return {
    ...range,
    endRow: range.endRow - count,
  };
}

/**
 * Adjust range for column insertion.
 */
function adjustRangeForColInsert(
  range: CellRange,
  minCol: number,
  maxCol: number,
  insertCol: number,
  count: number,
): CellRange {
  // Case 1: Insert is right of range - no change
  if (insertCol > maxCol) {
    return range;
  }

  // Case 2: Insert is left of range - shift entire range right
  if (insertCol <= minCol) {
    return {
      ...range,
      startCol: range.startCol + count,
      endCol: range.endCol + count,
    };
  }

  // Case 3: Insert is inside range - expand range
  // Adjust the "right side" of the range (whichever bound is larger)
  if (range.startCol >= range.endCol) {
    // Reversed range - startCol is the right side
    return {
      ...range,
      startCol: range.startCol + count,
    };
  } else {
    // Normal range - endCol is the right side
    return {
      ...range,
      endCol: range.endCol + count,
    };
  }
}

/**
 * Adjust range for column deletion.
 */
function adjustRangeForColDelete(
  range: CellRange,
  minCol: number,
  maxCol: number,
  deleteStart: number,
  count: number,
): CellRange | null {
  const deleteEnd = deleteStart + count - 1;

  // Case 1: Delete is entirely right of range - no change
  if (deleteStart > maxCol) {
    return range;
  }

  // Case 2: Delete is entirely left of range - shift entire range left
  if (deleteEnd < minCol) {
    return {
      ...range,
      startCol: range.startCol - count,
      endCol: range.endCol - count,
    };
  }

  // Case 3: Delete encompasses entire range - return null
  if (deleteStart <= minCol && deleteEnd >= maxCol) {
    return null;
  }

  // Case 4: Delete overlaps start of range
  if (deleteStart <= minCol && deleteEnd < maxCol) {
    const newStartCol = deleteStart;
    const newEndCol = range.endCol - count;

    // Preserve direction
    if (range.startCol <= range.endCol) {
      return { ...range, startCol: newStartCol, endCol: newEndCol };
    } else {
      return { ...range, startCol: newEndCol, endCol: newStartCol };
    }
  }

  // Case 5: Delete overlaps end of range
  if (deleteStart > minCol && deleteEnd >= maxCol) {
    const newEndCol = deleteStart - 1;

    // Preserve direction
    if (range.startCol <= range.endCol) {
      return { ...range, endCol: newEndCol };
    } else {
      return { ...range, startCol: newEndCol };
    }
  }

  // Case 6: Delete is entirely inside range - contract range
  return {
    ...range,
    endCol: range.endCol - count,
  };
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Create a single-cell range from a coordinate.
 */
export function singleCellRange(cell: CellCoord): CellRange {
  return {
    startRow: cell.row,
    startCol: cell.col,
    endRow: cell.row,
    endCol: cell.col,
  };
}

/**
 * Check if a structure change affects a given sheet.
 */
export function changeAffectsSheet(change: StructureChange, sheetId: string): boolean {
  return change.sheetId === sheetId;
}

/**
 * Get the fallback position when a cell is deleted.
 *
 * When a row is deleted, the fallback stays at the deletion index — the row that
 * shifts up into the vacated slot becomes active — while preserving the column.
 * When a column is deleted, the fallback stays at the deletion index — the column
 * that shifts left into the vacated slot becomes active — while preserving the row.
 *
 * This matches Excel: deleting the selected row/column keeps the cursor at that
 * same index rather than jumping to the row/column just above/left of it. Because
 * the grid is a fixed Excel-sized matrix (blank rows/cols backfill at the far
 * edge), the deletion index is always a valid coordinate; `clampCell` enforces
 * grid bounds defensively as the single source of truth.
 *
 * @param change - The structure change that caused the deletion
 * @param originalCell - The original cell position (used to preserve the non-affected coordinate)
 */
export function getDeletedCellFallback(
  change: StructureChange,
  originalCell?: CellCoord,
): CellCoord {
  switch (change.type) {
    case 'rows:deleted':
      // Stay at the deletion index (row shifted up into the slot), preserving the column
      return clampCell({
        row: change.startRow,
        col: originalCell?.col ?? 0,
      });
    case 'columns:deleted':
      // Stay at the deletion index (column shifted left into the slot), preserving the row
      return clampCell({
        row: originalCell?.row ?? 0,
        col: change.startCol,
      });
    default:
      // For inserts, this shouldn't be called, but return origin as fallback
      return { row: 0, col: 0 };
  }
}
