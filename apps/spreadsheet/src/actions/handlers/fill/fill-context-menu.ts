/**
 * Fill Context Menu Handlers
 *
 * Handles the right-click drag fill context menu and its various
 * fill type options (copy, series, formatting, dates, trends).
 *
 * Right-Click Drag Fill
 */

import type {
  ActionDependencies,
  ActionHandler,
  ActionResult,
  AsyncActionHandler,
} from '@mog-sdk/contracts/actions';
import type { Worksheet } from '@mog-sdk/contracts/api';
import { toCellId, type CellId } from '@mog-sdk/contracts/cell-identity';
import type { CellRange } from '@mog-sdk/contracts/core';

import type { FillOptions } from '../../../domain/fill/types';
import { DEFAULT_FILL_OPTIONS } from '../../../domain/fill/types';
import { executeFillViaWorksheet, getUIStore, handled } from './types';

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

/**
 * Helper: Execute fill with specific options for context menu actions.
 * Common logic used by all EXECUTE_FILL_* handlers.
 */
async function executeFillWithOptions(
  deps: ActionDependencies,
  fillOptions: FillOptions,
  payload?: {
    sourceRange: CellRange;
    targetCorners: { topLeft: string; bottomRight: string };
    direction: 'down' | 'right' | 'up' | 'left';
  },
): Promise<ActionResult> {
  if (!payload) {
    return { handled: false, reason: 'disabled', error: 'No fill info provided' };
  }

  const uiStore = getUIStore(deps);
  const sheetId = deps.getActiveSheetId();
  const ws = deps.workbook.getSheetById(sheetId);

  // Resolve target corners from CellIds using Worksheet API
  const targetCorners: { topLeft: CellId; bottomRight: CellId } = {
    topLeft: toCellId(payload.targetCorners.topLeft),
    bottomRight: toCellId(payload.targetCorners.bottomRight),
  };
  const cellIds = [targetCorners.topLeft, targetCorners.bottomRight];
  const positionMap = await ws._internal.batchGetCellPositions(cellIds);
  const topLeftEntry = positionMap.get(targetCorners.topLeft);
  const bottomRightEntry = positionMap.get(targetCorners.bottomRight);
  const topLeftPos = topLeftEntry
    ? { sheet: sheetId, row: topLeftEntry.row, col: topLeftEntry.col }
    : null;
  const bottomRightPos = bottomRightEntry
    ? { sheet: sheetId, row: bottomRightEntry.row, col: bottomRightEntry.col }
    : null;

  if (!topLeftPos || !bottomRightPos) {
    // CellIds no longer valid (cells deleted) - abort silently
    uiStore.getState().hideFillContextMenu();
    return {
      handled: false,
      reason: 'disabled',
      error: 'Target cells no longer exist',
    };
  }

  if (topLeftPos.sheet !== sheetId || bottomRightPos.sheet !== sheetId) {
    // Cells moved to different sheet - abort
    uiStore.getState().hideFillContextMenu();
    return {
      handled: false,
      reason: 'disabled',
      error: 'Target cells are on a different sheet',
    };
  }

  const targetRange: CellRange = {
    startRow: topLeftPos.row,
    startCol: topLeftPos.col,
    endRow: bottomRightPos.row,
    endCol: bottomRightPos.col,
  };

  // Protection check
  const hasProtectedCells = await checkRangeForProtectedCells(ws, targetRange);
  if (hasProtectedCells) {
    uiStore.getState().hideFillContextMenu();
    return {
      handled: true,
      error: 'Cannot fill: Selection contains protected cells',
    };
  }

  // Execute the fill operation through Mutations layer (Architecture Fix)
  // This properly triggers recalculation for filled formulas
  const result = await executeFillViaWorksheet(ws, payload.sourceRange, targetRange, sheetId, {
    ...fillOptions,
    direction: payload.direction,
  });

  // Hide context menu
  uiStore.getState().hideFillContextMenu();

  // Clear fill context in selection machine
  deps.commands.selection.clearFillContext();

  if (!result.success) {
    return {
      handled: true,
      error: result.updates.errors.map((e) => e.error).join(', '),
    };
  }

  return handled();
}

// =============================================================================
// Fill Context Menu (Right-Click Drag Fill)
// =============================================================================

/**
 * SHOW_FILL_CONTEXT_MENU
 *
 * Shows the fill context menu after a right-click drag fill handle release.
 * Called by fill-coordination after detecting right-drag end.
 *
 * @param deps - Action dependencies
 * @param payload - Menu position, source/target ranges, direction, hasDateValues
 */
export const SHOW_FILL_CONTEXT_MENU: ActionHandler = (
  deps: ActionDependencies,
  payload?: {
    position: { x: number; y: number };
    sourceRange: CellRange;
    targetCorners: { topLeft: string; bottomRight: string };
    direction: 'down' | 'right' | 'up' | 'left';
    hasDateValues: boolean;
  },
): ActionResult => {
  if (!payload) {
    return { handled: false, reason: 'disabled', error: 'No context menu info provided' };
  }

  const uiStore = getUIStore(deps);
  uiStore.getState().showFillContextMenu({
    position: payload.position,
    sourceRange: payload.sourceRange,
    targetCorners: {
      topLeft: toCellId(payload.targetCorners.topLeft),
      bottomRight: toCellId(payload.targetCorners.bottomRight),
    },
    direction: payload.direction,
    hasDateValues: payload.hasDateValues,
  });

  return handled();
};

/**
 * HIDE_FILL_CONTEXT_MENU
 *
 * Hides the fill context menu.
 * Called when user clicks away, presses Escape, or selects an option.
 *
 * @param deps - Action dependencies
 */
export const HIDE_FILL_CONTEXT_MENU: ActionHandler = (deps: ActionDependencies): ActionResult => {
  const uiStore = getUIStore(deps);
  uiStore.getState().hideFillContextMenu();
  return handled();
};

/**
 * EXECUTE_FILL_COPY_CELLS
 *
 * Fills by copying cells (no series increment).
 */
export const EXECUTE_FILL_COPY_CELLS: AsyncActionHandler = async (
  deps: ActionDependencies,
  payload?: {
    sourceRange: CellRange;
    targetCorners: { topLeft: string; bottomRight: string };
    direction: 'down' | 'right' | 'up' | 'left';
  },
): Promise<ActionResult> => {
  return executeFillWithOptions(
    deps,
    {
      ...DEFAULT_FILL_OPTIONS,
      fillType: 'all',
      seriesType: 'copy', // Just copy, no series
      includeFormulas: true,
      includeValues: true,
      includeFormats: true,
      smartFill: false,
    },
    payload,
  );
};

/**
 * EXECUTE_FILL_SERIES
 *
 * Fills with series detection (auto-increment numbers, dates, etc.).
 */
export const EXECUTE_FILL_SERIES_CONTEXT: AsyncActionHandler = async (
  deps: ActionDependencies,
  payload?: {
    sourceRange: CellRange;
    targetCorners: { topLeft: string; bottomRight: string };
    direction: 'down' | 'right' | 'up' | 'left';
  },
): Promise<ActionResult> => {
  return executeFillWithOptions(
    deps,
    {
      ...DEFAULT_FILL_OPTIONS,
      fillType: 'all',
      seriesType: 'auto', // Auto-detect series
      includeFormulas: true,
      includeValues: true,
      includeFormats: true,
      smartFill: true,
    },
    payload,
  );
};

/**
 * EXECUTE_FILL_FORMATTING_ONLY
 *
 * Fills only formatting, not values.
 */
export const EXECUTE_FILL_FORMATTING_ONLY: AsyncActionHandler = async (
  deps: ActionDependencies,
  payload?: {
    sourceRange: CellRange;
    targetCorners: { topLeft: string; bottomRight: string };
    direction: 'down' | 'right' | 'up' | 'left';
  },
): Promise<ActionResult> => {
  return executeFillWithOptions(
    deps,
    {
      ...DEFAULT_FILL_OPTIONS,
      fillType: 'formats', // Only formats
      includeFormulas: false,
      includeValues: false,
      includeFormats: true,
      smartFill: false,
    },
    payload,
  );
};

/**
 * EXECUTE_FILL_WITHOUT_FORMATTING
 *
 * Fills values only, no formatting.
 */
export const EXECUTE_FILL_WITHOUT_FORMATTING: AsyncActionHandler = async (
  deps: ActionDependencies,
  payload?: {
    sourceRange: CellRange;
    targetCorners: { topLeft: string; bottomRight: string };
    direction: 'down' | 'right' | 'up' | 'left';
  },
): Promise<ActionResult> => {
  return executeFillWithOptions(
    deps,
    {
      ...DEFAULT_FILL_OPTIONS,
      fillType: 'values', // Only values, no formatting
      seriesType: 'auto',
      includeFormulas: true,
      includeValues: true,
      includeFormats: false,
      smartFill: true,
    },
    payload,
  );
};

/**
 * EXECUTE_FILL_DAYS
 *
 * Fills dates incrementing by days.
 */
export const EXECUTE_FILL_DAYS: AsyncActionHandler = async (
  deps: ActionDependencies,
  payload?: {
    sourceRange: CellRange;
    targetCorners: { topLeft: string; bottomRight: string };
    direction: 'down' | 'right' | 'up' | 'left';
  },
): Promise<ActionResult> => {
  return executeFillWithOptions(
    deps,
    {
      ...DEFAULT_FILL_OPTIONS,
      fillType: 'all',
      seriesType: 'date',
      dateUnit: 'day',
      includeFormulas: false,
      includeValues: true,
      includeFormats: true,
      smartFill: false,
    },
    payload,
  );
};

/**
 * EXECUTE_FILL_WEEKDAYS
 *
 * Fills dates incrementing by weekdays (skips weekends).
 */
export const EXECUTE_FILL_WEEKDAYS: AsyncActionHandler = async (
  deps: ActionDependencies,
  payload?: {
    sourceRange: CellRange;
    targetCorners: { topLeft: string; bottomRight: string };
    direction: 'down' | 'right' | 'up' | 'left';
  },
): Promise<ActionResult> => {
  return executeFillWithOptions(
    deps,
    {
      ...DEFAULT_FILL_OPTIONS,
      fillType: 'all',
      seriesType: 'date',
      dateUnit: 'weekday',
      includeFormulas: false,
      includeValues: true,
      includeFormats: true,
      smartFill: false,
    },
    payload,
  );
};

/**
 * EXECUTE_FILL_MONTHS
 *
 * Fills dates incrementing by months.
 */
export const EXECUTE_FILL_MONTHS: AsyncActionHandler = async (
  deps: ActionDependencies,
  payload?: {
    sourceRange: CellRange;
    targetCorners: { topLeft: string; bottomRight: string };
    direction: 'down' | 'right' | 'up' | 'left';
  },
): Promise<ActionResult> => {
  return executeFillWithOptions(
    deps,
    {
      ...DEFAULT_FILL_OPTIONS,
      fillType: 'all',
      seriesType: 'date',
      dateUnit: 'month',
      includeFormulas: false,
      includeValues: true,
      includeFormats: true,
      smartFill: false,
    },
    payload,
  );
};

/**
 * EXECUTE_FILL_YEARS
 *
 * Fills dates incrementing by years.
 */
export const EXECUTE_FILL_YEARS: AsyncActionHandler = async (
  deps: ActionDependencies,
  payload?: {
    sourceRange: CellRange;
    targetCorners: { topLeft: string; bottomRight: string };
    direction: 'down' | 'right' | 'up' | 'left';
  },
): Promise<ActionResult> => {
  return executeFillWithOptions(
    deps,
    {
      ...DEFAULT_FILL_OPTIONS,
      fillType: 'all',
      seriesType: 'date',
      dateUnit: 'year',
      includeFormulas: false,
      includeValues: true,
      includeFormats: true,
      smartFill: false,
    },
    payload,
  );
};

/**
 * EXECUTE_FILL_LINEAR_TREND
 *
 * Fills numeric values using linear trend (best-fit line).
 * Excel calculates a linear regression and extends the trend.
 * For now, this uses smartFill with 'linear' series type which
 * detects arithmetic progression and extends it.
 */
export const EXECUTE_FILL_LINEAR_TREND: AsyncActionHandler = async (
  deps: ActionDependencies,
  payload?: {
    sourceRange: CellRange;
    targetCorners: { topLeft: string; bottomRight: string };
    direction: 'down' | 'right' | 'up' | 'left';
  },
): Promise<ActionResult> => {
  return executeFillWithOptions(
    deps,
    {
      ...DEFAULT_FILL_OPTIONS,
      fillType: 'all',
      seriesType: 'linear', // Linear series (constant step)
      includeFormulas: false,
      includeValues: true,
      includeFormats: true,
      smartFill: true, // Pattern detection for linear trend
    },
    payload,
  );
};

/**
 * EXECUTE_FILL_GROWTH_TREND
 *
 * Fills numeric values using growth trend (exponential/geometric).
 * Excel calculates an exponential regression and extends the trend.
 * For now, this uses smartFill with 'growth' series type which
 * detects geometric progression and extends it.
 */
export const EXECUTE_FILL_GROWTH_TREND: AsyncActionHandler = async (
  deps: ActionDependencies,
  payload?: {
    sourceRange: CellRange;
    targetCorners: { topLeft: string; bottomRight: string };
    direction: 'down' | 'right' | 'up' | 'left';
  },
): Promise<ActionResult> => {
  return executeFillWithOptions(
    deps,
    {
      ...DEFAULT_FILL_OPTIONS,
      fillType: 'all',
      seriesType: 'growth', // Growth series (constant multiplier)
      includeFormulas: false,
      includeValues: true,
      includeFormats: true,
      smartFill: true, // Pattern detection for growth trend
    },
    payload,
  );
};
