/**
 * Row/Column Differences Handlers
 *
 * Handlers for:
 * - Ctrl+\: Select Row Differences
 * - Ctrl+Shift+\: Select Column Differences
 *
 * Keyboard Shortcuts - Special Selection Shortcuts
 *
 */

import type { AsyncActionHandler } from '@mog-sdk/contracts/actions';
import { handled, type CellCoord } from './helpers';
import { cellCoordsToOptimizedRanges } from './special-selections';

// =============================================================================
// Row/Column Differences
// =============================================================================

/**
 * SELECT_ROW_DIFFERENCES - Select cells that differ from active cell (Ctrl+\)
 *
 * Keyboard Shortcuts - Special Selection Shortcuts
 *
 * For each row in the selection, compares cells to the cell in the active cell's column.
 * Selects all cells that have different values.
 *
 * Example: If active cell is B2 with value "X", and selection is A1:C3:
 * - In row 1: compares A1, C1 to B1 - selects those that differ from B1
 * - In row 2: compares A2, C2 to B2 (active cell) - selects those that differ
 * - In row 3: compares A3, C3 to B3 - selects those that differ from B3
 */
export const SELECT_ROW_DIFFERENCES: AsyncActionHandler = async (deps) => {
  const sheetId = deps.getActiveSheetId();
  const activeCell = deps.accessors.selection.getActiveCell();
  // Use data-bounded ranges to avoid iterating 1M empty cells for full column selections
  const ranges = deps.accessors.selection.getDataBoundedRanges(sheetId);

  if (!activeCell || ranges.length === 0) {
    return handled();
  }

  const ws = deps.workbook.getSheetById(sheetId);

  // Use the first selection range
  const range = ranges[0];
  const comparisonCol = activeCell.col;

  // Collect cells that differ
  const differentCells: CellCoord[] = [];

  // Batch fetch entire range in 1 IPC call
  const rangeData = await ws.getRange(range.startRow, range.startCol, range.endRow, range.endCol);

  for (let row = range.startRow; row <= range.endRow; row++) {
    const rowIdx = row - range.startRow;
    const compColIdx = comparisonCol - range.startCol;
    // Get comparison value from the active cell's column in this row
    const comparisonValue = rangeData[rowIdx]?.[compColIdx]?.value ?? null;

    for (let col = range.startCol; col <= range.endCol; col++) {
      // Skip the comparison column itself
      if (col === comparisonCol) continue;

      const colIdx = col - range.startCol;
      const cellValue = rangeData[rowIdx]?.[colIdx]?.value ?? null;

      // Compare values (using string comparison to handle different types)
      const compStr = comparisonValue === null ? '' : String(comparisonValue);
      const cellStr = cellValue === null ? '' : String(cellValue);

      if (compStr !== cellStr) {
        differentCells.push({ row, col });
      }
    }
  }

  if (differentCells.length === 0) {
    // No differences found - keep current selection
    return handled();
  }

  // Sort and optimize into ranges
  differentCells.sort((a, b) => {
    if (a.row !== b.row) return a.row - b.row;
    return a.col - b.col;
  });

  const optimizedRanges = cellCoordsToOptimizedRanges(differentCells);

  // Set selection with first different cell as active
  deps.commands.selection.setSelection(optimizedRanges, differentCells[0]);
  return handled();
};

/**
 * SELECT_COLUMN_DIFFERENCES - Select cells that differ from active cell (Ctrl+Shift+\)
 *
 * Keyboard Shortcuts - Special Selection Shortcuts
 *
 * For each column in the selection, compares cells to the cell in the active cell's row.
 * Selects all cells that have different values.
 *
 * Example: If active cell is B2 with value "X", and selection is A1:C3:
 * - In column A: compares A1, A3 to A2 - selects those that differ from A2
 * - In column B: compares B1, B3 to B2 (active cell) - selects those that differ
 * - In column C: compares C1, C3 to C2 - selects those that differ from C2
 */
export const SELECT_COLUMN_DIFFERENCES: AsyncActionHandler = async (deps) => {
  const sheetId = deps.getActiveSheetId();
  const activeCell = deps.accessors.selection.getActiveCell();
  // Use data-bounded ranges to avoid iterating 1M empty cells for full column selections
  const ranges = deps.accessors.selection.getDataBoundedRanges(sheetId);

  if (!activeCell || ranges.length === 0) {
    return handled();
  }

  const ws = deps.workbook.getSheetById(sheetId);

  // Use the first selection range
  const range = ranges[0];
  const comparisonRow = activeCell.row;

  // Collect cells that differ
  const differentCells: CellCoord[] = [];

  // Batch fetch entire range in 1 IPC call
  const rangeData = await ws.getRange(range.startRow, range.startCol, range.endRow, range.endCol);

  for (let col = range.startCol; col <= range.endCol; col++) {
    const colIdx = col - range.startCol;
    const compRowIdx = comparisonRow - range.startRow;
    // Get comparison value from the active cell's row in this column
    const comparisonValue = rangeData[compRowIdx]?.[colIdx]?.value ?? null;

    for (let row = range.startRow; row <= range.endRow; row++) {
      // Skip the comparison row itself
      if (row === comparisonRow) continue;

      const rowIdx = row - range.startRow;
      const cellValue = rangeData[rowIdx]?.[colIdx]?.value ?? null;

      // Compare values (using string comparison to handle different types)
      const compStr = comparisonValue === null ? '' : String(comparisonValue);
      const cellStr = cellValue === null ? '' : String(cellValue);

      if (compStr !== cellStr) {
        differentCells.push({ row, col });
      }
    }
  }

  if (differentCells.length === 0) {
    // No differences found - keep current selection
    return handled();
  }

  // Sort and optimize into ranges
  differentCells.sort((a, b) => {
    if (a.row !== b.row) return a.row - b.row;
    return a.col - b.col;
  });

  const optimizedRanges = cellCoordsToOptimizedRanges(differentCells);

  // Set selection with first different cell as active
  deps.commands.selection.setSelection(optimizedRanges, differentCells[0]);
  return handled();
};
