/**
 * Fill Series Dialog Handlers
 *
 * Handles Fill Series dialog open/close and execution.
 *
 * Architecture Note:
 * The Fill Series dialog operates on a user selection that contains BOTH:
 * - Pattern source cells (cells with existing values)
 * - Target cells (empty cells to be filled)
 *
 * This is different from the fill handle, where source and target are disjoint.
 * The EXECUTE handler must analyze the selection to separate source vs target
 * cells based on the fill direction.
 */

import type {
  ActionDependencies,
  ActionHandler,
  ActionResult,
  AsyncActionHandler,
} from '@mog-sdk/contracts/actions';
import type { FillSeriesOptions } from '@mog-sdk/contracts/fill';
import type { Worksheet } from '@mog-sdk/contracts/api';
import { MAX_COLS, MAX_ROWS, type CellRange } from '@mog-sdk/contracts/core';
import { cellRangeToA1 } from '@mog/spreadsheet-utils/a1';

import { getUIStore, handled } from './types';

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

function getSeriesSourceCell(
  range: CellRange,
  direction: FillSeriesOptions['direction'],
): { row: number; col: number } {
  switch (direction) {
    case 'down':
      return { row: range.startRow, col: range.startCol };
    case 'up':
      return { row: range.endRow, col: range.startCol };
    case 'right':
      return { row: range.startRow, col: range.startCol };
    case 'left':
      return { row: range.startRow, col: range.endCol };
  }
}

function getLinearStopValueItemCount(startValue: number, step: number, stopValue: number): number {
  if (!Number.isFinite(startValue) || !Number.isFinite(step) || !Number.isFinite(stopValue)) {
    return 0;
  }
  if (step === 0) {
    return 0;
  }
  if ((step > 0 && stopValue < startValue) || (step < 0 && stopValue > startValue)) {
    return 0;
  }

  const distance = step > 0 ? stopValue - startValue : startValue - stopValue;
  const itemCount = Math.floor(distance / Math.abs(step)) + 1;
  return itemCount >= 2 ? itemCount : 0;
}

function rangeWithStopValueExtent(
  range: CellRange,
  direction: FillSeriesOptions['direction'],
  itemCount: number,
): CellRange {
  const additionalCells = itemCount - 1;
  switch (direction) {
    case 'down':
      return {
        ...range,
        endRow: Math.min(MAX_ROWS - 1, range.startRow + additionalCells),
      };
    case 'up':
      return {
        ...range,
        startRow: Math.max(0, range.endRow - additionalCells),
      };
    case 'right':
      return {
        ...range,
        endCol: Math.min(MAX_COLS - 1, range.startCol + additionalCells),
      };
    case 'left':
      return {
        ...range,
        startCol: Math.max(0, range.endCol - additionalCells),
      };
  }
}

async function resolveFillSeriesExecutionRange(
  ws: Worksheet,
  selectionRange: CellRange,
  options: Pick<FillSeriesOptions, 'direction' | 'seriesType' | 'stopValue'> & { step: number },
): Promise<CellRange> {
  if (
    options.seriesType === 'growth' ||
    options.stopValue === undefined ||
    !Number.isFinite(options.stopValue)
  ) {
    return selectionRange;
  }

  const sourceCell = getSeriesSourceCell(selectionRange, options.direction);
  const sourceData = await ws.getCell(sourceCell.row, sourceCell.col);
  const startValue = sourceData.value;
  if (typeof startValue !== 'number') {
    return selectionRange;
  }

  const itemCount = getLinearStopValueItemCount(startValue, options.step, options.stopValue);
  if (itemCount === 0) {
    return selectionRange;
  }

  return rangeWithStopValueExtent(selectionRange, options.direction, itemCount);
}

// =============================================================================
// Handlers
// =============================================================================

/**
 * OPEN_FILL_SERIES_DIALOG
 *
 * Opens the Fill Series dialog for a given range.
 * Stores the position-based range directly (not CellIds) because:
 * 1. The selection may include empty cells (which don't have CellIds)
 * 2. This is a transient modal operation where structural stability is not needed
 *
 * @param deps - Action dependencies
 * @param payload - Range and direction
 */
export const OPEN_FILL_SERIES_DIALOG: ActionHandler = (
  deps: ActionDependencies,
  payload?: { range: CellRange; direction: 'row' | 'column' },
): ActionResult => {
  let range: CellRange;
  let direction: 'row' | 'column';

  if (payload) {
    range = payload.range;
    direction = payload.direction;
  } else {
    // Fallback: read from current selection. This branch is taken by ribbon
    // call sites that no longer thread a payload (post insert ribbon scope
    // dispatch migration) — the handler is now the single source of truth
    // for both selection lookup and shape inference.
    const ranges = deps.accessors.selection.getRanges();
    if (!ranges || ranges.length === 0) {
      return { handled: false, reason: 'disabled', error: 'No range provided' };
    }
    range = ranges[0];
    // Determine direction based on selection shape (wider → row, taller → column)
    direction = range.endCol - range.startCol > range.endRow - range.startRow ? 'row' : 'column';
  }

  const uiStore = getUIStore(deps);

  // Store the range directly - the user's selection defines both the pattern source
  // (cells with values) and the fill target (the entire selection boundary)
  uiStore.getState().openFillSeriesDialog(range, direction);

  return handled();
};

/**
 * CLOSE_FILL_SERIES_DIALOG
 *
 * Closes the Fill Series dialog.
 */
export const CLOSE_FILL_SERIES_DIALOG: ActionHandler = (deps: ActionDependencies): ActionResult => {
  const uiStore = getUIStore(deps);
  uiStore.getState().closeFillSeriesDialog();
  return handled();
};

/**
 * EXECUTE_FILL_SERIES
 *
 * Executes a fill series operation with the specified options.
 *
 * The Fill Series dialog operates on a selection that contains BOTH:
 * - Pattern source cells (cells with existing values)
 * - Target cells (empty cells to be filled)
 *
 * This is different from the fill handle, where source and target are disjoint.
 * Delegates to ws.fillSeries() which splits the selection into source + target
 * in the kernel based on the fill direction.
 *
 * Uses Draft + Apply pattern: reads options from UIStore.fillSeriesDialog.pendingOptions
 *
 * @param deps - Action dependencies
 */
export const EXECUTE_FILL_SERIES: AsyncActionHandler = async (
  deps: ActionDependencies,
): Promise<ActionResult> => {
  const uiStore = getUIStore(deps);
  const sheetId = deps.getActiveSheetId();
  const ws = deps.workbook.getSheetById(sheetId);

  // Read from UIStore (Draft + Apply pattern)
  const { sourceRange: selectionRange, pendingOptions } = uiStore.getState().fillSeriesDialog;

  if (!selectionRange) {
    return { handled: false, reason: 'disabled', error: 'No source range' };
  }

  if (!pendingOptions) {
    return { handled: false, reason: 'disabled', error: 'No pending options' };
  }

  const { direction, seriesType, dateUnit, step, stopValue } = pendingOptions;

  // Validate seriesType is one the kernel accepts (not 'auto' or 'copy')
  if (seriesType !== 'linear' && seriesType !== 'growth' && seriesType !== 'date') {
    uiStore.getState().closeFillSeriesDialog();
    return {
      handled: true,
      error: `Cannot fill series: Unsupported series type "${seriesType}" for Fill Series dialog`,
    };
  }

  const executionRange = await resolveFillSeriesExecutionRange(ws, selectionRange, {
    direction,
    seriesType,
    step,
    stopValue,
  });

  // Protection check: Verify all cells in the effective fill range are editable
  const hasProtectedCells = await checkRangeForProtectedCells(ws, executionRange);
  if (hasProtectedCells) {
    return {
      handled: true,
      error: 'Cannot fill series: Range contains protected cells',
    };
  }

  // Build FillSeriesOptions from pending options
  const options: FillSeriesOptions = {
    direction,
    seriesType,
    stepValue: step,
    stopValue,
    dateUnit,
  };

  // Convert range to A1 notation and delegate to ws.fillSeries()
  // The kernel handles splitting the range into source + target based on direction
  const rangeA1 = cellRangeToA1(executionRange);

  try {
    await ws.fillSeries(rangeA1, options);
  } catch (err) {
    uiStore.getState().closeFillSeriesDialog();
    return {
      handled: true,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  // Close dialog
  uiStore.getState().closeFillSeriesDialog();

  return handled();
};
