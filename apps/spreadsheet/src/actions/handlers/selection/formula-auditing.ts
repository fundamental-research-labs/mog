/**
 * Formula Auditing Selection Handlers
 *
 * Handlers for formula auditing keyboard shortcuts:
 * - SELECT_PRECEDENTS (Ctrl+[): Navigate to cells that the formula references
 * - SELECT_DEPENDENTS (Ctrl+]): Navigate to cells that reference this cell
 * - SELECT_VISIBLE_CELLS (Alt+;): Select only visible cells in current selection
 *
 *.5: Formula Auditing keyboard shortcuts
 *
 */

import type { AsyncActionHandler } from '@mog-sdk/contracts/actions';
import { parseA1 } from '@mog/spreadsheet-utils/a1';
import { handled, type CellCoord } from './helpers';
import { cellCoordsToOptimizedRanges } from './special-selections';

// =============================================================================
// Formula Auditing Handlers
// =============================================================================

/**
 * SELECT_PRECEDENTS - Navigate to direct precedents of the active cell.
 * Selects the first precedent cell (cells that the formula references).
 * Excel behavior: Ctrl+[ navigates to the first cell referenced by the formula.
 *
 *.5: Formula Auditing keyboard shortcuts
 */
export const SELECT_PRECEDENTS: AsyncActionHandler = async (deps) => {
  const sheetId = deps.getActiveSheetId();
  const activeCell = deps.accessors.selection.getActiveCell();
  const { row, col } = activeCell;

  const ws = deps.workbook.getSheetById(sheetId);
  const precedentAddresses = await ws.getPrecedents(row, col);

  if (precedentAddresses.length === 0) {
    return { handled: true };
  }

  // Navigate to the first precedent (same-sheet only)
  // Note: cross-sheet info not available in current API (returns A1 addresses without sheet prefix)
  // TODO: Handle cross-sheet navigation when API is enhanced
  const firstPrec = parseA1(precedentAddresses[0]);
  deps.commands.selection.goTo({ row: firstPrec.row, col: firstPrec.col });

  return handled();
};

/**
 * SELECT_DEPENDENTS - Navigate to direct dependents of the active cell.
 * Selects the first dependent cell (cells that reference this cell in their formulas).
 * Excel behavior: Ctrl+] navigates to the first cell that references this cell.
 *
 *.5: Formula Auditing keyboard shortcuts
 */
export const SELECT_DEPENDENTS: AsyncActionHandler = async (deps) => {
  const sheetId = deps.getActiveSheetId();
  const activeCell = deps.accessors.selection.getActiveCell();
  const { row, col } = activeCell;

  const ws = deps.workbook.getSheetById(sheetId);
  const dependentAddresses = await ws.getDependents(row, col);

  if (dependentAddresses.length === 0) {
    return { handled: true };
  }

  // Navigate to the first dependent (same-sheet only)
  // TODO: Handle cross-sheet navigation when API is enhanced
  const firstDep = parseA1(dependentAddresses[0]);
  deps.commands.selection.goTo({ row: firstDep.row, col: firstDep.col });

  return handled();
};

/**
 * SELECT_VISIBLE_CELLS - Select only visible cells in the current selection.
 * Alt+; keyboard shortcut.
 *
 * This modifies the current selection to exclude:
 * - Hidden rows (manually hidden or filter-hidden)
 * - Hidden columns
 *
 * Creates a multi-range selection containing only the visible cells.
 * If the current active cell is visible, it remains the active cell.
 * Otherwise, the first visible cell becomes the active cell.
 */
export const SELECT_VISIBLE_CELLS: AsyncActionHandler = async (deps) => {
  const sheetId = deps.getActiveSheetId();
  // Use data-bounded ranges to avoid iterating 1M empty cells for full column/row selections
  const ranges = deps.accessors.selection.getDataBoundedRanges(sheetId);
  const currentActiveCell = deps.accessors.selection.getActiveCell();

  const ws = deps.workbook.getSheetById(sheetId);

  // Batch-fetch hidden rows and columns (2 IPC calls total, in parallel)
  const [hiddenRows, hiddenCols] = await Promise.all([
    ws.layout.getHiddenRowsBitmap(),
    ws.layout.getHiddenColumnsBitmap(),
  ]);

  const visibleCells: CellCoord[] = [];

  for (const range of ranges) {
    for (let row = range.startRow; row <= range.endRow; row++) {
      if (hiddenRows.has(row)) continue;
      for (let col = range.startCol; col <= range.endCol; col++) {
        if (hiddenCols.has(col)) continue;
        visibleCells.push({ row, col });
      }
    }
  }

  if (visibleCells.length === 0) {
    return handled(); // Nothing to select - selection unchanged
  }

  // Optimize: merge adjacent cells into ranges
  const optimizedRanges = cellCoordsToOptimizedRanges(visibleCells);

  // Preserve current active cell if visible
  const isCurrentActiveCellVisible =
    currentActiveCell &&
    visibleCells.some((c) => c.row === currentActiveCell.row && c.col === currentActiveCell.col);
  const activeCell = isCurrentActiveCellVisible ? currentActiveCell : visibleCells[0];

  deps.commands.selection.setSelection(optimizedRanges, activeCell);
  return handled();
};
