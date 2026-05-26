/**
 * Reduce Selection Handler - Shift+Backspace collapse to active cell.
 *
 * Collapses the current selection to a single-cell range at the active cell.
 */

import { handled, type ActionHandler } from './helpers';

export const REDUCE_SELECTION: ActionHandler = (deps) => {
  const activeCell = deps.accessors.selection.getActiveCell();
  const singleCellRange = {
    startRow: activeCell.row,
    startCol: activeCell.col,
    endRow: activeCell.row,
    endCol: activeCell.col,
  };
  deps.commands.selection.setSelection([singleCellRange], activeCell);
  return handled();
};
