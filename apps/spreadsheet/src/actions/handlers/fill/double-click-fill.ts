/**
 * Double-Click Fill Handle Handler
 *
 * Automatically fills down to the extent of adjacent data when user
 * double-clicks the fill handle. This is a critical Excel productivity feature.
 *
 * Item 5.4
 */

import type {
  ActionDependencies,
  ActionResult,
  AsyncActionHandler,
} from '@mog-sdk/contracts/actions';
import type { Worksheet } from '@mog-sdk/contracts/api';
import type { CellRange } from '@mog-sdk/contracts/core';

import type { FillOptions } from '../../../domain/fill/types';
import { DEFAULT_FILL_OPTIONS } from '../../../domain/fill/types';
import { executeFillViaWorksheet, handled, notHandled } from './types';

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Check if any cells in a range are protected.
 */
async function checkRangeForProtectedCells(ws: Worksheet, range: CellRange): Promise<boolean> {
  for (let row = range.startRow; row <= range.endRow; row++) {
    for (let col = range.startCol; col <= range.endCol; col++) {
      if (!(await ws.protection.canEditCell(row, col))) {
        return true; // Found a protected cell
      }
    }
  }
  return false;
}

// =============================================================================
// Double-Click Fill Handle
// =============================================================================

/**
 * Find the extent of data in a single column, starting from startRow.
 * Returns the last row with non-empty data, or null if no data found.
 *
 * Uses ws.getRange() for batch reads (Unified Worksheet API).
 *
 * @param ws - Worksheet instance
 * @param col - Column to scan
 * @param startRow - Row to start scanning from
 * @returns Last row with data, or null if column is empty at startRow
 */
export async function findColumnExtent(
  ws: Worksheet,
  col: number,
  startRow: number,
): Promise<number | null> {
  const MAX_SCAN_ROWS = 10000; // Safety limit to prevent infinite loops

  // Batch-query the column from startRow down via ws.getRange
  const rangeData = await ws.getRange(startRow, col, startRow + MAX_SCAN_ROWS, col);

  // Build a lookup of row -> display value for quick access
  const cellMap = new Map<number, string>();
  for (let r = 0; r < rangeData.length; r++) {
    const cell = rangeData[r]?.[0];
    const value = cell?.value;
    cellMap.set(startRow + r, value != null ? String(value) : '');
  }

  // First check if the starting row has data
  const startValue = cellMap.get(startRow) ?? '';
  if (startValue === '') {
    return null; // No data in adjacent column at this row
  }

  // Scan downward to find where data ends
  let row = startRow;
  while (row - startRow < MAX_SCAN_ROWS) {
    const nextRow = row + 1;
    const value = cellMap.get(nextRow) ?? '';
    if (value === '') {
      break; // Found empty cell - stop here
    }
    row = nextRow;
  }

  return row;
}

/**
 * Find the extent of adjacent data for double-click fill.
 * Looks at the column immediately to the left of the source range first,
 * then falls back to the column immediately to the right.
 *
 * Algorithm (matches Excel behavior):
 * 1. Check left adjacent column for data
 * 2. If left has data, find how far down it extends
 * 3. If left is empty, check right adjacent column
 * 4. Return the row where fill should stop
 *
 * Uses Unified Worksheet API via ws parameter.
 *
 * @param ws - Worksheet instance
 * @param sourceRange - The source range to fill from
 * @returns Target row number, or null if no adjacent data
 */
export async function findAdjacentDataExtent(
  ws: Worksheet,
  sourceRange: CellRange,
): Promise<number | null> {
  const startRow = sourceRange.startRow;

  // Try left column first
  const leftCol = sourceRange.startCol - 1;
  if (leftCol >= 0) {
    const leftExtent = await findColumnExtent(ws, leftCol, startRow);
    if (leftExtent !== null && leftExtent > sourceRange.endRow) {
      return leftExtent;
    }
  }

  // Fall back to right column
  const rightCol = sourceRange.endCol + 1;
  const rightExtent = await findColumnExtent(ws, rightCol, startRow);
  if (rightExtent !== null && rightExtent > sourceRange.endRow) {
    return rightExtent;
  }

  return null; // No adjacent data found
}

/**
 * DOUBLE_CLICK_FILL_HANDLE
 *
 * Automatically fills down to the extent of adjacent data when user
 * double-clicks the fill handle. This is a critical Excel productivity feature.
 *
 * Algorithm:
 * 1. Get current selection (source range)
 * 2. Find extent of adjacent data (left column first, then right)
 * 3. Calculate target range for fill
 * 4. Execute the fill operation
 * 5. Update selection to include filled range
 *
 * Helper functions now use Unified Worksheet API (ws.getRange)
 * for batch cell reads.
 *
 * @param deps - Action dependencies
 */
export const DOUBLE_CLICK_FILL_HANDLE: AsyncActionHandler = async (
  deps: ActionDependencies,
): Promise<ActionResult> => {
  const sheetId = deps.getActiveSheetId();
  const ws = deps.workbook.getSheetById(sheetId);

  // Get current selection state via accessor
  const ranges = deps.accessors.selection.getRanges();

  if (!ranges || ranges.length === 0) {
    return notHandled('disabled');
  }

  // Use primary selection range
  const sourceRange: CellRange = ranges[0];

  // findAdjacentDataExtent uses Unified Worksheet API
  const targetEndRow = await findAdjacentDataExtent(ws, sourceRange);

  if (targetEndRow === null || targetEndRow <= sourceRange.endRow) {
    // No adjacent data to fill to, or adjacent data doesn't extend past source
    return notHandled('disabled');
  }

  // Compute target range (excludes source range - only the cells to fill)
  const targetRange: CellRange = {
    startRow: sourceRange.endRow + 1,
    startCol: sourceRange.startCol,
    endRow: targetEndRow,
    endCol: sourceRange.endCol,
  };

  // Protection check
  const hasProtectedCells = await checkRangeForProtectedCells(ws, targetRange);
  if (hasProtectedCells) {
    return {
      handled: true,
      error: 'Cannot fill: Selection contains protected cells',
    };
  }

  // Build fill options (standard fill down)
  const fillOptions: FillOptions = {
    ...DEFAULT_FILL_OPTIONS,
    direction: 'down',
    fillType: 'all',
    seriesType: 'auto',
    includeFormulas: true,
    includeValues: true,
    includeFormats: true,
    smartFill: true,
  };

  // Execute fill through Mutations layer (Architecture Fix)
  // This properly triggers recalculation for filled formulas
  const result = await executeFillViaWorksheet(ws, sourceRange, targetRange, sheetId, fillOptions);

  if (!result.success) {
    return {
      handled: true,
      error: result.updates.errors.map((e: { error: string }) => e.error).join(', '),
    };
  }

  // Update selection to include filled range
  const expandedRange: CellRange = {
    startRow: sourceRange.startRow,
    startCol: sourceRange.startCol,
    endRow: targetEndRow,
    endCol: sourceRange.endCol,
  };

  const activeCell = deps.accessors.selection.getActiveCell();
  deps.commands.selection.setSelection([expandedRange], activeCell);

  return handled();
};
