/**
 * Fill Series Analyzer
 *
 * Analyzes a selection to determine source (pattern) and target (fill) ranges
 * for the Fill Series dialog.
 *
 * The Fill Series dialog has different semantics than the fill handle:
 * - Fill Handle: User explicitly defines source (original selection) and target (drag extension)
 * - Fill Series Dialog: User selects a range containing BOTH source and target cells
 *
 * This analyzer examines the selection and splits it based on:
 * 1. Which cells have values (source/pattern cells)
 * 2. Which cells are empty (target cells to be filled)
 * 3. The fill direction
 *
 */

import type { Workbook } from '@mog-sdk/contracts/api';
import type { CellData, SheetId } from '@mog-sdk/contracts/core';

import type { CellRange, FillDirection } from './types';

// =============================================================================
// Types
// =============================================================================

/**
 * Result of analyzing a selection for Fill Series.
 */
export interface FillSeriesAnalysisResult {
  /** Source range (cells with existing values for pattern detection) */
  sourceRange: CellRange;
  /** Target range (empty cells to be filled) */
  targetRange: CellRange;
}

// =============================================================================
// Main Analyzer Function
// =============================================================================

/**
 * Analyze a selection to determine source (pattern) and target (fill) ranges
 * for Fill Series dialog.
 *
 * The function scans the selection based on the fill direction to find:
 * - Source: Contiguous cells with data at the "start" edge (based on direction)
 * - Target: Remaining cells (which should be empty or will be overwritten)
 *
 * @param sheetId - Sheet ID
 * @param selection - The user's full selection range
 * @param direction - Fill direction (down, up, right, left)
 * @param workbook - Workbook for unified API access
 * @returns Analysis result with source and target ranges, or null if invalid
 *
 * @example
 * // Selection B1:B6, B1=1, B2=2, B3=3, B4:B6 empty, direction='down'
 * // Returns: { sourceRange: B1:B3, targetRange: B4:B6 }
 *
 * @example
 * // Selection A1:C1, A1=1, B1=2, C1 empty, direction='right'
 * // Returns: { sourceRange: A1:B1, targetRange: C1:C1 }
 */
export async function analyzeSelectionForFillSeries(
  sheetId: SheetId,
  selection: CellRange,
  direction: FillDirection,
  workbook?: Workbook,
): Promise<FillSeriesAnalysisResult | null> {
  if (!workbook) return null;
  const ws = workbook.getSheetById(sheetId);

  // Pre-fetch the entire selection range in one IPC call.
  // CellData includes both value and formula, so we avoid per-cell IPC loops.
  const { startRow, startCol, endRow, endCol } = selection;
  const rangeData = await ws.getRange(startRow, startCol, endRow, endCol);

  switch (direction) {
    case 'down':
      return analyzeVerticalDown(rangeData, selection);
    case 'up':
      return analyzeVerticalUp(rangeData, selection);
    case 'right':
      return analyzeHorizontalRight(rangeData, selection);
    case 'left':
      return analyzeHorizontalLeft(rangeData, selection);
  }
}

// =============================================================================
// Direction-Specific Analyzers
// =============================================================================

/**
 * Check if a cell has data (non-empty value or formula) using pre-fetched range data.
 * Zero IPC calls — looks up the cell from the in-memory 2D array.
 *
 * @param rangeData - Pre-fetched CellData[][] from ws.getRange()
 * @param row - Absolute row index
 * @param col - Absolute column index
 * @param startRow - The start row of the pre-fetched range (for offset calculation)
 * @param startCol - The start column of the pre-fetched range (for offset calculation)
 */
function cellHasDataInRange(
  rangeData: CellData[][],
  row: number,
  col: number,
  startRow: number,
  startCol: number,
): boolean {
  const cellData = rangeData[row - startRow]?.[col - startCol];
  if (!cellData) return false;
  if (cellData.value !== null && cellData.value !== undefined && cellData.value !== '') return true;
  if (cellData.formula) return true;
  return false;
}

/**
 * Analyze for direction='down': Source at top, target below.
 * Scans from top row down to find the last row with data.
 */
function analyzeVerticalDown(
  rangeData: CellData[][],
  selection: CellRange,
): FillSeriesAnalysisResult | null {
  const { startRow, endRow, startCol, endCol } = selection;

  // Find the last row that has data in at least one column
  let lastDataRow = startRow - 1;

  for (let row = startRow; row <= endRow; row++) {
    let rowHasData = false;
    for (let col = startCol; col <= endCol; col++) {
      if (cellHasDataInRange(rangeData, row, col, startRow, startCol)) {
        rowHasData = true;
        break;
      }
    }

    if (rowHasData) {
      lastDataRow = row;
    } else {
      // Stop at first empty row (contiguous source)
      break;
    }
  }

  // Validate: need at least one source row and one target row
  if (lastDataRow < startRow) {
    // No source data found
    return null;
  }

  if (lastDataRow >= endRow) {
    // No target rows (all rows have data)
    return null;
  }

  return {
    sourceRange: {
      startRow,
      startCol,
      endRow: lastDataRow,
      endCol,
    },
    targetRange: {
      startRow: lastDataRow + 1,
      startCol,
      endRow,
      endCol,
    },
  };
}

/**
 * Analyze for direction='up': Source at bottom, target above.
 * Scans from bottom row up to find the first row with data.
 */
function analyzeVerticalUp(
  rangeData: CellData[][],
  selection: CellRange,
): FillSeriesAnalysisResult | null {
  const { startRow, endRow, startCol, endCol } = selection;

  // Find the first row (from bottom) that has data
  let firstDataRow = endRow + 1;

  for (let row = endRow; row >= startRow; row--) {
    let rowHasData = false;
    for (let col = startCol; col <= endCol; col++) {
      if (cellHasDataInRange(rangeData, row, col, startRow, startCol)) {
        rowHasData = true;
        break;
      }
    }

    if (rowHasData) {
      firstDataRow = row;
    } else {
      // Stop at first empty row (contiguous source from bottom)
      break;
    }
  }

  // Validate: need at least one source row and one target row
  if (firstDataRow > endRow) {
    // No source data found
    return null;
  }

  if (firstDataRow <= startRow) {
    // No target rows (all rows have data)
    return null;
  }

  return {
    sourceRange: {
      startRow: firstDataRow,
      startCol,
      endRow,
      endCol,
    },
    targetRange: {
      startRow,
      startCol,
      endRow: firstDataRow - 1,
      endCol,
    },
  };
}

/**
 * Analyze for direction='right': Source at left, target to the right.
 * Scans from left column right to find the last column with data.
 */
function analyzeHorizontalRight(
  rangeData: CellData[][],
  selection: CellRange,
): FillSeriesAnalysisResult | null {
  const { startRow, endRow, startCol, endCol } = selection;

  // Find the last column that has data in at least one row
  let lastDataCol = startCol - 1;

  for (let col = startCol; col <= endCol; col++) {
    let colHasData = false;
    for (let row = startRow; row <= endRow; row++) {
      if (cellHasDataInRange(rangeData, row, col, startRow, startCol)) {
        colHasData = true;
        break;
      }
    }

    if (colHasData) {
      lastDataCol = col;
    } else {
      // Stop at first empty column (contiguous source)
      break;
    }
  }

  // Validate: need at least one source column and one target column
  if (lastDataCol < startCol) {
    // No source data found
    return null;
  }

  if (lastDataCol >= endCol) {
    // No target columns (all columns have data)
    return null;
  }

  return {
    sourceRange: {
      startRow,
      startCol,
      endRow,
      endCol: lastDataCol,
    },
    targetRange: {
      startRow,
      startCol: lastDataCol + 1,
      endRow,
      endCol,
    },
  };
}

/**
 * Analyze for direction='left': Source at right, target to the left.
 * Scans from right column left to find the first column with data.
 */
function analyzeHorizontalLeft(
  rangeData: CellData[][],
  selection: CellRange,
): FillSeriesAnalysisResult | null {
  const { startRow, endRow, startCol, endCol } = selection;

  // Find the first column (from right) that has data
  let firstDataCol = endCol + 1;

  for (let col = endCol; col >= startCol; col--) {
    let colHasData = false;
    for (let row = startRow; row <= endRow; row++) {
      if (cellHasDataInRange(rangeData, row, col, startRow, startCol)) {
        colHasData = true;
        break;
      }
    }

    if (colHasData) {
      firstDataCol = col;
    } else {
      // Stop at first empty column (contiguous source from right)
      break;
    }
  }

  // Validate: need at least one source column and one target column
  if (firstDataCol > endCol) {
    // No source data found
    return null;
  }

  if (firstDataCol <= startCol) {
    // No target columns (all columns have data)
    return null;
  }

  return {
    sourceRange: {
      startRow,
      startCol: firstDataCol,
      endRow,
      endCol,
    },
    targetRange: {
      startRow,
      startCol,
      endRow,
      endCol: firstDataCol - 1,
    },
  };
}
