/**
 * Data-aware navigation utilities for spreadsheet selection and Ctrl+Arrow behavior.
 *
 * Pure functions that compute navigation targets based on actual cell data.
 * Used by KeyboardCoordinator to find data edges for Ctrl+Arrow navigation.
 */

import type { CellValue } from '@mog-sdk/contracts/core';
import type { Direction } from '@mog-sdk/contracts/machines';
import type { CellCoord } from '@mog-sdk/contracts/rendering';

// =============================================================================
// Types
// =============================================================================

/**
 * Function type for getting cell values.
 * Allows the algorithm to be pure and testable.
 * Returns CellValue or undefined (for out-of-bounds or empty cells).
 */
export type CellValueGetter = (row: number, col: number) => CellValue | undefined;

/**
 * Function type for checking if a row/column is hidden.
 * Used by navigation utilities to skip hidden cells.
 * Returns true if the cell at (row, col) is hidden (either row or column is hidden).
 */
export type VisibilityChecker = (row: number, col: number) => boolean;

/**
 * Function type for getting the merged region containing a cell.
 * Returns the merge bounds if the cell is part of a merge, or null if not.
 * Used by findDataEdge to treat merged cells as single data blocks.
 */
export type MergedRegionGetter = (
  row: number,
  col: number,
) => { startRow: number; startCol: number; endRow: number; endCol: number } | null;

// =============================================================================
// Data Edge Navigation
// =============================================================================

/**
 * Find the edge of a data region in a direction.
 *
 * Implements Excel's Ctrl+Arrow behavior with 4 cases:
 *
 * 1. Current cell empty, next cell empty:
 * → Jump to first non-empty cell in direction (or sheet edge)
 *
 * 2. Current cell empty, next cell has data:
 * → Jump to that immediately adjacent cell
 *
 * 3. Current cell has data, next cell empty:
 * → Jump over empty space to next data (or sheet edge)
 *
 * 4. Current cell has data, next cell has data:
 * → Walk to last cell before empty (edge of contiguous region)
 *
 * Hidden row/column awareness:
 * - If isHidden callback is provided, treats hidden cells as boundaries
 * - Stops at the edge of hidden regions (matches Excel behavior)
 *
 * @param cell - Starting cell position
 * @param direction - Direction to navigate
 * @param getCellValue - Function to retrieve cell values
 * @param maxRow - Maximum row index (typically 1048575 for Excel parity)
 * @param maxCol - Maximum column index (typically 16383 for Excel parity)
 * @param isHidden - Optional function to check if a cell is hidden
 * @param getMergedRegion - Optional function to get the merge region containing a cell
 * @returns Target cell position
 */
export function findDataEdge(
  cell: CellCoord,
  direction: Direction,
  getCellValue: CellValueGetter,
  maxRow: number,
  maxCol: number,
  isHidden?: VisibilityChecker,
  getMergedRegion?: MergedRegionGetter,
): CellCoord {
  const { row, col } = cell;

  // Helper to check if a value is "empty" (null, undefined, or empty string)
  const isEmpty = (value: CellValue | undefined): boolean => {
    return value == null || value === '';
  };

  // Helper to check if a cell has data, accounting for merged cells.
  // A merged cell has data if its origin (top-left) has data.
  const cellHasData = (r: number, c: number): boolean => {
    if (getMergedRegion) {
      const merge = getMergedRegion(r, c);
      if (merge) {
        // Check the merge origin for data
        return !isEmpty(getCellValue(merge.startRow, merge.startCol));
      }
    }
    return !isEmpty(getCellValue(r, c));
  };

  // Helper to advance past a merged cell in the walking direction.
  // Returns the position just past the far edge of the merge.
  const advancePastMerge = (
    r: number,
    c: number,
    d: { row: number; col: number },
  ): { row: number; col: number } => {
    if (!getMergedRegion) return { row: r + d.row, col: c + d.col };
    const merge = getMergedRegion(r, c);
    if (!merge) return { row: r + d.row, col: c + d.col };

    // Skip to the far edge of the merge in the walking direction, then one more step
    if (d.row > 0) return { row: merge.endRow + 1, col: c };
    if (d.row < 0) return { row: merge.startRow - 1, col: c };
    if (d.col > 0) return { row: r, col: merge.endCol + 1 };
    if (d.col < 0) return { row: r, col: merge.startCol - 1 };
    return { row: r + d.row, col: c + d.col };
  };

  // Helper to return the merge origin for a cell, or the cell as-is if not merged.
  // Ensures Ctrl+Arrow always lands on the top-left of a merged region (Excel behavior).
  const toMergeOrigin = (r: number, c: number): CellCoord => {
    if (!getMergedRegion) return { row: r, col: c };
    const merge = getMergedRegion(r, c);
    if (!merge) return { row: r, col: c };
    return { row: merge.startRow, col: merge.startCol };
  };

  // Get current cell value (merge-aware)
  const currentHasData = cellHasData(row, col);

  // Direction deltas
  const delta: Record<Direction, { row: number; col: number }> = {
    up: { row: -1, col: 0 },
    down: { row: 1, col: 0 },
    left: { row: 0, col: -1 },
    right: { row: 0, col: 1 },
  };

  const d = delta[direction];

  // Check if position is within bounds
  const inBounds = (r: number, c: number): boolean => {
    return r >= 0 && r <= maxRow && c >= 0 && c <= maxCol;
  };

  // Get next position (skip past current merge if applicable)
  const nextPos = advancePastMerge(row, col, d);
  let r = nextPos.row;
  let c = nextPos.col;

  // If we're already at the edge, stay put
  if (!inBounds(r, c)) {
    return cell;
  }

  // Check if next cell is hidden - if so, stop at current cell
  // This treats hidden regions as boundaries (Excel behavior)
  if (isHidden && isHidden(r, c)) {
    return cell;
  }

  const nextHasData = cellHasData(r, c);

  if (!currentHasData) {
    // Case 1 & 2: Current cell is empty
    if (nextHasData) {
      // Case 2: Next cell has data → stop at adjacent cell (merge origin)
      return toMergeOrigin(r, c);
    }

    // Case 1: Both empty → find first non-empty cell
    while (inBounds(r, c)) {
      // Stop at hidden region boundary
      if (isHidden && isHidden(r, c)) {
        return toMergeOrigin(r - d.row, c - d.col);
      }
      if (cellHasData(r, c)) {
        return toMergeOrigin(r, c);
      }
      r += d.row;
      c += d.col;
    }

    // Hit sheet edge without finding data
    return clampToEdge(r - d.row, c - d.col, direction, maxRow, maxCol);
  }

  // Case 3 & 4: Current cell has data
  if (!nextHasData) {
    // Case 3: Next cell is empty → jump over empty to next data
    while (inBounds(r, c)) {
      // Stop at hidden region boundary
      if (isHidden && isHidden(r, c)) {
        return toMergeOrigin(r - d.row, c - d.col);
      }
      if (cellHasData(r, c)) {
        return toMergeOrigin(r, c);
      }
      r += d.row;
      c += d.col;
    }

    // Hit sheet edge without finding data
    return clampToEdge(r - d.row, c - d.col, direction, maxRow, maxCol);
  }

  // Case 4: Both have data → walk to edge of contiguous region
  // Track previous position before advancePastMerge so backtrack lands on merge origin
  let prevR = row;
  let prevC = col;
  while (inBounds(r, c)) {
    // Stop at hidden region boundary
    if (isHidden && isHidden(r, c)) {
      return toMergeOrigin(prevR, prevC);
    }
    if (!cellHasData(r, c)) {
      // Found empty cell → return the last data cell (merge origin)
      return toMergeOrigin(prevR, prevC);
    }
    // Save current position before advancing past merge
    prevR = r;
    prevC = c;
    // Advance past any merge in this cell
    const next = advancePastMerge(r, c, d);
    r = next.row;
    c = next.col;
  }

  // Hit sheet edge while still in data
  return toMergeOrigin(prevR, prevC);
}

/**
 * Clamp coordinates to valid sheet bounds based on direction.
 */
function clampToEdge(
  row: number,
  col: number,
  _direction: Direction,
  maxRow: number,
  maxCol: number,
): CellCoord {
  return {
    row: Math.max(0, Math.min(maxRow, row)),
    col: Math.max(0, Math.min(maxCol, col)),
  };
}

// =============================================================================
// Used Range Detection
// =============================================================================

/**
 * Find the last used cell in a sheet.
 *
 * Scans the sheet to find the cell with the highest row and column indices
 * that contains data. Used for Ctrl+End navigation.
 *
 * Note: This is potentially expensive for large datasets. In practice,
 * we should maintain a cached "used range" that's updated incrementally.
 * For now, we use the data extent from the sheet maps.
 *
 * @param getCellValue - Function to retrieve cell values
 * @param maxScanRow - Maximum row to scan
 * @param maxScanCol - Maximum column to scan
 * @returns The last used cell coordinates, or (0,0) if sheet is empty
 */
export function findLastUsedCell(
  getCellValue: CellValueGetter,
  maxScanRow: number = 1_000,
  maxScanCol: number = 100,
): CellCoord {
  let lastRow = 0;
  let lastCol = 0;

  for (let row = 0; row <= maxScanRow; row++) {
    for (let col = 0; col <= maxScanCol; col++) {
      const value = getCellValue(row, col);
      if (value != null && value !== '') {
        if (row > lastRow) lastRow = row;
        if (col > lastCol) lastCol = col;
      }
    }
  }

  return { row: lastRow, col: lastCol };
}

/**
 * Get the used range of a sheet.
 *
 * Returns the bounding rectangle containing all cells with data.
 *
 * @param getCellValue - Function to retrieve cell values
 * @param maxScanRow - Maximum row to scan
 * @param maxScanCol - Maximum column to scan
 * @returns The used range, or null if sheet is empty
 */
export function getUsedRange(
  getCellValue: CellValueGetter,
  maxScanRow: number = 1_000,
  maxScanCol: number = 100,
): { startRow: number; startCol: number; endRow: number; endCol: number } | null {
  let minRow = Infinity;
  let minCol = Infinity;
  let maxRow = -Infinity;
  let maxCol = -Infinity;
  let hasData = false;

  for (let row = 0; row <= maxScanRow; row++) {
    for (let col = 0; col <= maxScanCol; col++) {
      const value = getCellValue(row, col);
      if (value != null && value !== '') {
        hasData = true;
        if (row < minRow) minRow = row;
        if (row > maxRow) maxRow = row;
        if (col < minCol) minCol = col;
        if (col > maxCol) maxCol = col;
      }
    }
  }

  if (!hasData) {
    return null;
  }

  return {
    startRow: minRow,
    startCol: minCol,
    endRow: maxRow,
    endCol: maxCol,
  };
}
