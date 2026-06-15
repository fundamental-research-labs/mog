/**
 * Home/End Navigation Handlers
 *
 * Handles home/end-based navigation actions:
 * - MOVE_TO_ROW_START (Home) - Move to first column in current row
 * - MOVE_TO_ROW_END (End) - Move to last column in current row when End Mode active
 * - MOVE_TO_A1 (Ctrl+Home) - Move to cell A1
 * - MOVE_TO_LAST_USED_CELL (Ctrl+End) - Move to last used cell
 * - EXTEND_TO_ROW_START (Shift+Home) - Extend selection to first column
 * - EXTEND_TO_A1 (Ctrl+Shift+Home) - Extend selection to A1
 * - EXTEND_TO_LAST_USED_CELL (Ctrl+Shift+End) - Extend selection to last used cell
 *
 */

import type { AsyncActionHandler } from '@mog-sdk/contracts/actions';
import { getMovingEdge, rangeFromAnchorAndCell } from '../../../systems/shared/types';
import { getActiveSheetId, handled, type ActionHandler, type CellCoord } from './helpers';

// =============================================================================
// Home/End Move Handlers
// =============================================================================

/**
 * MOVE_TO_ROW_START (Home)
 * Move active cell to the first column (A) of the current row.
 */
export const MOVE_TO_ROW_START: ActionHandler = (deps) => {
  deps.commands.selection.keyHome(false, false);
  return handled();
};

/**
 * MOVE_TO_ROW_END (End when End Mode active)
 * Move active cell to the last column of the current row.
 */
export const MOVE_TO_ROW_END: ActionHandler = (deps) => {
  deps.commands.selection.keyEnd(false, false);
  return handled();
};

/**
 * MOVE_TO_A1 (Ctrl+Home)
 * Move active cell to cell A1 (top-left of sheet).
 */
export const MOVE_TO_A1: ActionHandler = (deps) => {
  deps.commands.selection.keyHome(true, false);
  return handled();
};

/**
 * MOVE_TO_LAST_USED_CELL (Ctrl+End)
 * Move active cell to the last used cell in the sheet.
 *
 * Uses cached usedRange metadata for O(1) performance.
 * The usedRange is updated incrementally when cells are written.
 */
export const MOVE_TO_LAST_USED_CELL: AsyncActionHandler = async (deps) => {
  const sheetId = getActiveSheetId(deps);
  const ws = deps.workbook.getSheetById(sheetId);

  // getUsedRange() returns CellRange | null — endRow/endCol are inclusive (last row/col with data, 0-indexed)
  const usedRange = await ws.getUsedRange();
  const lastUsed: CellCoord = usedRange
    ? { row: usedRange.endRow, col: usedRange.endCol }
    : { row: 0, col: 0 };

  deps.commands.selection.goTo(lastUsed);
  return handled();
};

// =============================================================================
// Home/End Extend Handlers (Shift key)
// =============================================================================

/**
 * EXTEND_TO_ROW_START (Shift+Home)
 * Extend selection from anchor to the first column of the current row.
 */
export const EXTEND_TO_ROW_START: ActionHandler = (deps) => {
  deps.commands.selection.keyHome(false, true);
  return handled();
};

/**
 * EXTEND_TO_ROW_END (Shift+End)
 * Extend selection from anchor to the last column of the current row.
 */
export const EXTEND_TO_ROW_END: AsyncActionHandler = async (deps) => {
  const activeCell = deps.accessors.selection.getActiveCell();
  const ranges = deps.accessors.selection.getRanges();
  const anchor = deps.accessors.selection.getAnchor();
  const sheetId = getActiveSheetId(deps);
  const ws = deps.workbook.getSheetById(sheetId);

  const anchorCell: CellCoord = anchor ?? activeCell;
  const currentRange = ranges[ranges.length - 1];
  const extendFrom: CellCoord = currentRange ? getMovingEdge(currentRange, anchorCell) : activeCell;

  const { lastDataCol } = await ws.findLastColumn(extendFrom.row);
  if (lastDataCol === null) return handled();

  const targetCell: CellCoord = { row: extendFrom.row, col: lastDataCol };
  const newRange = rangeFromAnchorAndCell(anchorCell, targetCell);

  deps.commands.selection.setSelection([newRange], anchorCell, anchorCell);
  return handled();
};

/**
 * EXTEND_TO_A1 (Ctrl+Shift+Home)
 * Extend selection from anchor to cell A1.
 */
export const EXTEND_TO_A1: ActionHandler = (deps) => {
  const activeCell = deps.accessors.selection.getActiveCell();
  const anchor = deps.accessors.selection.getAnchor();
  const targetCell: CellCoord = { row: 0, col: 0 };
  const anchorCell: CellCoord = anchor ?? activeCell;
  const newRange = rangeFromAnchorAndCell(anchorCell, targetCell);

  deps.commands.selection.setSelection([newRange], anchorCell, anchorCell);
  return handled();
};

/**
 * EXTEND_TO_LAST_USED_CELL (Ctrl+Shift+End)
 * Extend selection from anchor to the last used cell in the sheet.
 *
 * Uses cached usedRange metadata for O(1) performance.
 */
export const EXTEND_TO_LAST_USED_CELL: AsyncActionHandler = async (deps) => {
  const activeCell = deps.accessors.selection.getActiveCell();
  const anchor = deps.accessors.selection.getAnchor();
  const sheetId = getActiveSheetId(deps);
  const ws = deps.workbook.getSheetById(sheetId);

  // getUsedRange() returns CellRange | null — endRow/endCol are inclusive (last row/col with data, 0-indexed)
  const usedRange = await ws.getUsedRange();
  const lastUsed: CellCoord = usedRange
    ? { row: usedRange.endRow, col: usedRange.endCol }
    : { row: 0, col: 0 };

  // Create new range from anchor to last used cell
  const anchorCell: CellCoord = anchor ?? activeCell;
  const newRange = rangeFromAnchorAndCell(anchorCell, lastUsed);

  deps.commands.selection.setSelection([newRange], anchorCell, anchorCell);
  return handled();
};
