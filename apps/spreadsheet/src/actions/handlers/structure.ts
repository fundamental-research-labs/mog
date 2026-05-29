/**
 * Structure Action Handlers
 *
 * Pure handler functions for structure-related actions.
 * These handlers are called by the unified action dispatcher.
 *
 * ARCHITECTURE:
 * - Handlers are pure functions: (deps) => ActionResult
 * - They access actor state through deps.accessors (reads) and deps.commands (writes)
 * - They do NOT store references to deps
 *
 * MULTI-SHEET SUPPORT
 * - Structure operations broadcast to all selected sheets
 * - When multiple sheets are selected via Ctrl+click or Shift+click,
 * insert/delete/hide operations apply to all selected sheets
 * - Uses deps.getSelectedSheetIds() to get target sheets
 * - Falls back to [activeSheetId] if getSelectedSheetIds not provided
 *
 * This file handles:
 * - Row/column insertion (insert above/below, left/right)
 * - Row/column deletion
 * - Row/column visibility (hide/unhide)
 * - Undo/redo operations
 *
 */

import type {
  ActionDependencies,
  ActionResult,
  AsyncActionHandler,
} from '@mog-sdk/contracts/actions';

import type { CellRange, SheetId } from '@mog-sdk/contracts/core';

import { requestFormulaBarRefresh } from '../../infra/events/formula-bar-refresh';
import {
  handled,
  isProtectionRejection,
  notHandled,
  showProtectionFeedback,
} from './handler-utils';
import {
  deleteSelectedColumns,
  deleteSelectedRows,
  insertColumnLeftSelection,
  insertRowAboveSelection,
} from './structure-row-column';

// =============================================================================
// Type Helpers
// =============================================================================

/**
 * Get target sheet IDs for multi-sheet operations.
 * Returns selected sheets if available, otherwise falls back to [activeSheetId].
 *
 * Multi-Sheet Selection
 */
// getSelectedSheetIds is now async — sync callers use active sheet as safe default
function getTargetSheetIds(deps: ActionDependencies): SheetId[] {
  return [deps.getActiveSheetId()];
}

/**
 * Get selection context (active cell and ranges) via accessors.
 */
function getSelectionContext(deps: ActionDependencies): {
  activeCell: { row: number; col: number };
  ranges: CellRange[];
} {
  return {
    activeCell: deps.accessors.selection.getActiveCell(),
    ranges: deps.accessors.selection.getRanges(),
  };
}

function activeCellRange(activeCell: { row: number; col: number }): CellRange {
  return {
    startRow: activeCell.row,
    startCol: activeCell.col,
    endRow: activeCell.row,
    endCol: activeCell.col,
  };
}

function getRangesOrActiveCell(
  ranges: CellRange[],
  activeCell: { row: number; col: number },
): CellRange[] {
  return ranges.length > 0 ? ranges : [activeCellRange(activeCell)];
}

async function withProtectionFeedback<T>(
  deps: ActionDependencies,
  operation: () => Promise<T>,
): Promise<ActionResult> {
  try {
    await operation();
    return handled();
  } catch (err) {
    if (isProtectionRejection(err)) {
      showProtectionFeedback(deps, (err as Error).message);
      return notHandled('disabled');
    }
    throw err;
  }
}

/**
 * Get all unique rows from selection ranges.
 */
function getSelectedRows(ranges: CellRange[]): number[] {
  const rowsSet = new Set<number>();
  for (const range of ranges) {
    for (let row = range.startRow; row <= range.endRow; row++) {
      rowsSet.add(row);
    }
  }
  return Array.from(rowsSet).sort((a, b) => a - b);
}

function getSelectedRowsOrActive(
  ranges: CellRange[],
  activeCell: { row: number; col: number },
): number[] {
  const rows = getSelectedRows(ranges);
  return rows.length > 0 ? rows : [activeCell.row];
}

/**
 * Get all unique columns from selection ranges.
 */
function getSelectedCols(ranges: CellRange[]): number[] {
  const colsSet = new Set<number>();
  for (const range of ranges) {
    for (let col = range.startCol; col <= range.endCol; col++) {
      colsSet.add(col);
    }
  }
  return Array.from(colsSet).sort((a, b) => a - b);
}

function getSelectedColsOrActive(
  ranges: CellRange[],
  activeCell: { row: number; col: number },
): number[] {
  const cols = getSelectedCols(ranges);
  return cols.length > 0 ? cols : [activeCell.col];
}

// =============================================================================
// Row Insert Handlers
// =============================================================================

/**
 * Insert a row above the current selection.
 *
 * Multi-Sheet Support
 * - Broadcasts to all selected sheets when multiple sheets are selected
 */
export const INSERT_ROW_ABOVE: AsyncActionHandler = async (deps) => {
  return insertRowAboveSelection(deps);
};

/**
 * Insert a row below the current selection.
 *
 * Multi-Sheet Support
 * - Broadcasts to all selected sheets when multiple sheets are selected
 */
export const INSERT_ROW_BELOW: AsyncActionHandler = async (deps) => {
  const targetSheetIds = getTargetSheetIds(deps);
  const { activeCell, ranges } = getSelectionContext(deps);

  // Get the bottommost row in selection
  const rows = getSelectedRowsOrActive(ranges, activeCell);

  const insertAt = rows[rows.length - 1] + 1;

  return withProtectionFeedback(deps, async () => {
    for (const sheetId of targetSheetIds) {
      const ws = deps.workbook.getSheetById(sheetId);
      await ws.structure.insertRows(insertAt, 1);
    }
  });
};

// =============================================================================
// Column Insert Handlers
// =============================================================================

/**
 * Insert a column to the left of the current selection.
 *
 * Multi-Sheet Support
 * - Broadcasts to all selected sheets when multiple sheets are selected
 */
export const INSERT_COLUMN_LEFT: AsyncActionHandler = async (deps) => {
  return insertColumnLeftSelection(deps);
};

/**
 * Insert a column to the right of the current selection.
 *
 * Multi-Sheet Support
 * - Broadcasts to all selected sheets when multiple sheets are selected
 */
export const INSERT_COLUMN_RIGHT: AsyncActionHandler = async (deps) => {
  const targetSheetIds = getTargetSheetIds(deps);
  const { activeCell, ranges } = getSelectionContext(deps);

  // Get the rightmost column in selection
  const cols = getSelectedColsOrActive(ranges, activeCell);

  const insertAt = cols[cols.length - 1] + 1;

  return withProtectionFeedback(deps, async () => {
    for (const sheetId of targetSheetIds) {
      const ws = deps.workbook.getSheetById(sheetId);
      await ws.structure.insertColumns(insertAt, 1);
    }
  });
};

// =============================================================================
// Row/Column Delete Handlers
// =============================================================================

/**
 * Delete the selected rows.
 *
 * Multi-Sheet Support
 * - Broadcasts to all selected sheets when multiple sheets are selected
 */
export const DELETE_ROWS: AsyncActionHandler = async (deps) => {
  return deleteSelectedRows(deps);
};

/**
 * Delete the selected columns.
 *
 * Multi-Sheet Support
 * - Broadcasts to all selected sheets when multiple sheets are selected
 */
export const DELETE_COLUMNS: AsyncActionHandler = async (deps) => {
  return deleteSelectedColumns(deps);
};

// =============================================================================
// Row Visibility Handlers
// =============================================================================

/**
 * Hide the selected rows.
 *
 * Multi-Sheet Support
 * - Broadcasts to all selected sheets when multiple sheets are selected
 */
export const HIDE_ROW: AsyncActionHandler = async (deps) => {
  const targetSheetIds = getTargetSheetIds(deps);
  const { activeCell, ranges } = getSelectionContext(deps);

  const rows = getSelectedRowsOrActive(ranges, activeCell);
  if (rows.length > 0) {
    return withProtectionFeedback(deps, async () => {
      for (const sheetId of targetSheetIds) {
        const ws = deps.workbook.getSheetById(sheetId);
        for (const row of rows) {
          await ws.layout.setRowVisible(row, false);
        }
      }
    });
  }

  return handled();
};

/**
 * Unhide rows in the selected range.
 *
 * Multi-Sheet Support
 * - Broadcasts to all selected sheets when multiple sheets are selected
 */
export const UNHIDE_ROW: AsyncActionHandler = async (deps) => {
  const targetSheetIds = getTargetSheetIds(deps);
  const { activeCell, ranges } = getSelectionContext(deps);

  const rows = getSelectedRowsOrActive(ranges, activeCell);
  if (rows.length > 0) {
    return withProtectionFeedback(deps, async () => {
      for (const sheetId of targetSheetIds) {
        const ws = deps.workbook.getSheetById(sheetId);
        for (const row of rows) {
          await ws.layout.setRowVisible(row, true);
        }
      }
    });
  }

  return handled();
};

// =============================================================================
// Column Visibility Handlers
// =============================================================================

/**
 * Hide the selected columns.
 *
 * Multi-Sheet Support
 * - Broadcasts to all selected sheets when multiple sheets are selected
 */
export const HIDE_COLUMN: AsyncActionHandler = async (deps) => {
  const targetSheetIds = getTargetSheetIds(deps);
  const { activeCell, ranges } = getSelectionContext(deps);

  const cols = getSelectedColsOrActive(ranges, activeCell);
  if (cols.length > 0) {
    return withProtectionFeedback(deps, async () => {
      for (const sheetId of targetSheetIds) {
        const ws = deps.workbook.getSheetById(sheetId);
        for (const col of cols) {
          await ws.layout.setColumnVisible(col, false);
        }
      }
    });
  }

  return handled();
};

/**
 * Unhide columns in the selected range.
 *
 * Multi-Sheet Support
 * - Broadcasts to all selected sheets when multiple sheets are selected
 */
export const UNHIDE_COLUMN: AsyncActionHandler = async (deps) => {
  const targetSheetIds = getTargetSheetIds(deps);
  const { activeCell, ranges } = getSelectionContext(deps);

  const cols = getSelectedColsOrActive(ranges, activeCell);
  if (cols.length > 0) {
    return withProtectionFeedback(deps, async () => {
      for (const sheetId of targetSheetIds) {
        const ws = deps.workbook.getSheetById(sheetId);
        for (const col of cols) {
          await ws.layout.setColumnVisible(col, true);
        }
      }
    });
  }

  return handled();
};

// =============================================================================
// Auto-Fit Handlers (Insert ribbon dispatch)
// =============================================================================

/**
 * Auto-fit row height for the selected rows.
 * Mirrors the prior CellsGroup hook autoFitRowHeight behavior — uses
 * canvas text measurement to compute optimal heights and applies them
 * through the unified Worksheet API.
 *
 * The dynamic imports avoid pulling the autofit + grid-renderer modules
 * into the dispatcher entry-point bundle.
 */
export const AUTO_FIT_ROW_HEIGHT: AsyncActionHandler = async (deps) => {
  const sheetId = deps.getActiveSheetId();
  const { activeCell, ranges } = getSelectionContext(deps);
  const rows = getSelectedRowsOrActive(ranges, activeCell);

  const [{ autoFitRows }, { getTextMeasurementService }] = await Promise.all([
    import('../../systems/grid-editing/features/autofit'),
    import('@mog/grid-renderer'),
  ]);
  const textMeasurement = getTextMeasurementService();
  const ws = deps.workbook.getSheetById(sheetId);
  return withProtectionFeedback(deps, () =>
    autoFitRows(
      sheetId,
      rows,
      textMeasurement,
      (entries) => ws.formatValues(entries),
      deps.workbook,
    ),
  );
};

/**
 * Auto-fit column width for the selected columns.
 * @see AUTO_FIT_ROW_HEIGHT
 */
export const AUTO_FIT_COLUMN_WIDTH: AsyncActionHandler = async (deps) => {
  const sheetId = deps.getActiveSheetId();
  const { activeCell, ranges } = getSelectionContext(deps);
  const cols = getSelectedColsOrActive(ranges, activeCell);

  const [{ autoFitColumns }, { getTextMeasurementService }] = await Promise.all([
    import('../../systems/grid-editing/features/autofit'),
    import('@mog/grid-renderer'),
  ]);
  const textMeasurement = getTextMeasurementService();
  const ws = deps.workbook.getSheetById(sheetId);
  return withProtectionFeedback(deps, () =>
    autoFitColumns(
      sheetId,
      cols,
      textMeasurement,
      (entries) => ws.formatValues(entries),
      deps.workbook,
    ),
  );
};

// =============================================================================
// Apply explicit row height / column width (Row Height / Column Width dialogs)
// =============================================================================

/**
 * APPLY_ROW_HEIGHT — set an explicit pixel height for the selected rows.
 * Payload: { height: number, applyToAll?: boolean }
 *
 * When `applyToAll` is true (the dialog default for multi-row selections),
 * every row covered by the current selection ranges receives `height`.
 * When false, only the row of the active cell is resized.
 */
export const APPLY_ROW_HEIGHT: AsyncActionHandler = async (deps, payload) => {
  const height = (payload as { height?: number } | undefined)?.height;
  if (typeof height !== 'number' || !Number.isFinite(height) || height <= 0) {
    return { handled: false, error: 'Missing or invalid height in payload' };
  }
  const applyToAll = (payload as { applyToAll?: boolean } | undefined)?.applyToAll ?? true;

  const sheetId = deps.getActiveSheetId();
  const { activeCell, ranges } = getSelectionContext(deps);
  const rows = applyToAll ? getSelectedRowsOrActive(ranges, activeCell) : [activeCell.row];

  const ws = deps.workbook.getSheetById(sheetId);
  return withProtectionFeedback(deps, async () => {
    for (const row of rows) {
      await ws.layout.setRowHeight(row, height);
    }
  });
};

/**
 * APPLY_COLUMN_WIDTH — set an explicit pixel width for the selected columns.
 * Payload: { width: number, applyToAll?: boolean }
 *
 * @see APPLY_ROW_HEIGHT
 */
export const APPLY_COLUMN_WIDTH: AsyncActionHandler = async (deps, payload) => {
  const width = (payload as { width?: number } | undefined)?.width;
  if (typeof width !== 'number' || !Number.isFinite(width) || width <= 0) {
    return { handled: false, error: 'Missing or invalid width in payload' };
  }
  const applyToAll = (payload as { applyToAll?: boolean } | undefined)?.applyToAll ?? true;

  const sheetId = deps.getActiveSheetId();
  const { activeCell, ranges } = getSelectionContext(deps);
  const cols = applyToAll ? getSelectedColsOrActive(ranges, activeCell) : [activeCell.col];

  const ws = deps.workbook.getSheetById(sheetId);
  return withProtectionFeedback(deps, () =>
    ws.layout.setColumnWidths(cols.map((col) => [col, width])),
  );
};

// =============================================================================
// Undo/Redo Handlers
// =============================================================================

/**
 * Undo the last operation.
 * Uses unified Workbook API.
 */
export const UNDO: AsyncActionHandler = async (deps) => {
  const receipt = await deps.workbook.history.undo();
  if (receipt.success) {
    const sheetId = deps.getActiveSheetId();
    const { ranges } = getSelectionContext(deps);
    requestFormulaBarRefresh({ sheetIds: [sheetId], ranges });
  }
  return handled();
};

/**
 * Redo the last undone operation.
 * Uses unified Workbook API.
 */
export const REDO: AsyncActionHandler = async (deps) => {
  const receipt = await deps.workbook.history.redo();
  if (receipt.success) {
    const sheetId = deps.getActiveSheetId();
    const { ranges } = getSelectionContext(deps);
    requestFormulaBarRefresh({ sheetIds: [sheetId], ranges });
  }
  return handled();
};

// =============================================================================
// Page Break Handlers
// =============================================================================

/**
 * Insert a horizontal page break at the start of the selection.
 * The break appears above the selected row.
 *
 * Page Break actions
 */
export const INSERT_HORIZONTAL_PAGE_BREAK: AsyncActionHandler = async (deps) => {
  const { ranges } = getSelectionContext(deps);

  if (ranges.length === 0) return handled();

  // Insert break at the start row of the first selection range
  const startRow = ranges[0].startRow;
  const ws = deps.workbook.activeSheet;
  await ws.print.addPageBreak('horizontal', startRow);

  return handled();
};

/**
 * Remove a horizontal page break at the start of the selection.
 *
 * Page Break actions
 */
export const REMOVE_HORIZONTAL_PAGE_BREAK: AsyncActionHandler = async (deps) => {
  const { ranges } = getSelectionContext(deps);

  if (ranges.length === 0) return handled();

  // Remove break at the start row of the first selection range
  const startRow = ranges[0].startRow;
  const ws = deps.workbook.activeSheet;
  await ws.print.removePageBreak('horizontal', startRow);

  return handled();
};

/**
 * Insert a vertical page break at the start of the selection.
 * The break appears before the selected column.
 *
 * Page Break actions
 */
export const INSERT_VERTICAL_PAGE_BREAK: AsyncActionHandler = async (deps) => {
  const { ranges } = getSelectionContext(deps);

  if (ranges.length === 0) return handled();

  // Insert break at the start col of the first selection range
  const startCol = ranges[0].startCol;
  const ws = deps.workbook.activeSheet;
  await ws.print.addPageBreak('vertical', startCol);

  return handled();
};

/**
 * Remove a vertical page break at the start of the selection.
 *
 * Page Break actions
 */
export const REMOVE_VERTICAL_PAGE_BREAK: AsyncActionHandler = async (deps) => {
  const { ranges } = getSelectionContext(deps);

  if (ranges.length === 0) return handled();

  // Remove break at the start col of the first selection range
  const startCol = ranges[0].startCol;
  const ws = deps.workbook.activeSheet;
  await ws.print.removePageBreak('vertical', startCol);

  return handled();
};

// =============================================================================
// Insert/Delete Cells Handlers
// =============================================================================

/**
 * Insert cells by shifting existing cells down (default ribbon behavior).
 *
 * This is the handler for clicking the Insert button directly (not the dropdown arrow).
 * Excel behavior: immediately shifts cells down without showing a dialog.
 * If the selection is a full row, inserts a row above instead.
 * If the selection is a full column, inserts a column to the left instead.
 */
export const INSERT_CELLS_SHIFT_DOWN: AsyncActionHandler = async (deps) => {
  const { activeCell, ranges } = getSelectionContext(deps);
  const range = getRangesOrActiveCell(ranges, activeCell)[0];
  if (range.isFullRow) return INSERT_ROW_ABOVE(deps);
  if (range.isFullColumn) return INSERT_COLUMN_LEFT(deps);
  const ws = deps.workbook.activeSheet;
  return withProtectionFeedback(deps, () =>
    ws.structure.insertCellsWithShift(
      range.startRow,
      range.startCol,
      range.endRow,
      range.endCol,
      'down',
    ),
  );
};

/**
 * Insert cells by shifting existing cells in a specified direction.
 *
 * Insert Cells Dialog - Shift cells right/down option.
 *
 * Payload:
 * - range: { startRow, startCol, endRow, endCol } - The range to insert into
 * - direction: 'right' | 'down' - Direction to shift existing cells
 *
 * When direction is 'right', cells at col >= startCol within affected rows
 * shift right by (endCol - startCol + 1).
 * When direction is 'down', cells at row >= startRow within affected cols
 * shift down by (endRow - startRow + 1).
 */
export const INSERT_CELLS: AsyncActionHandler = async (deps, payload) => {
  // Extract payload
  const { range, direction } = payload as {
    range: CellRange;
    direction: 'right' | 'down';
  };

  if (!range) {
    console.warn('[INSERT_CELLS] Missing range in payload');
    return handled();
  }

  const ws = deps.workbook.activeSheet;
  return withProtectionFeedback(deps, () =>
    ws.structure.insertCellsWithShift(
      range.startRow,
      range.startCol,
      range.endRow,
      range.endCol,
      direction,
    ),
  );
};

/**
 * Delete cells by shifting remaining cells in a specified direction.
 *
 * Delete Cells Dialog - Shift cells left/up option.
 *
 * Payload:
 * - range: { startRow, startCol, endRow, endCol } - The range to delete
 * - direction: 'left' | 'up' - Direction to shift remaining cells
 *
 * When direction is 'left', cells in the range are deleted and cells to
 * the right shift left within affected rows.
 * When direction is 'up', cells in the range are deleted and cells below
 * shift up within affected columns.
 */
export const DELETE_CELLS: AsyncActionHandler = async (deps, payload) => {
  // Extract payload
  const { range, direction } = payload as {
    range: CellRange;
    direction: 'left' | 'up';
  };

  if (!range) {
    console.warn('[DELETE_CELLS] Missing range in payload');
    return handled();
  }

  const ws = deps.workbook.activeSheet;
  return withProtectionFeedback(deps, () =>
    ws.structure.deleteCellsWithShift(
      range.startRow,
      range.startCol,
      range.endRow,
      range.endCol,
      direction,
    ),
  );
};
