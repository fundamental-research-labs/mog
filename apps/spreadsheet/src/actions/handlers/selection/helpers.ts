/**
 * Selection Handlers - Shared Utilities
 *
 * Common types, helpers, and utilities shared across all selection handler modules.
 * This module is extracted from selection.ts to support the modular refactor.
 *
 */

import type {
  ActionDependencies,
  ActionHandler,
  ActionResult,
  AsyncActionHandler,
} from '@mog-sdk/contracts/actions';
import type { CellRange } from '@mog-sdk/contracts/core';
import { MAX_COLS, MAX_ROWS } from '@mog-sdk/contracts/core';
import type { Direction } from '@mog-sdk/contracts/machines';
import type { CellCoord } from '@mog-sdk/contracts/rendering';

import type { CellValueGetter } from '../../../infra/utils';
import { normalizeRange } from '../../../systems/shared/types';
import { getActiveSheetId, getUIStore, handled } from '../handler-utils';

// =============================================================================
// Re-exports for Handler Modules
// =============================================================================

// Re-export types that handlers need
export { MAX_COLS, MAX_ROWS, normalizeRange };
export type {
  ActionDependencies,
  ActionHandler,
  ActionResult,
  AsyncActionHandler,
  CellCoord,
  CellRange,
  Direction,
};

// Re-export shared handler utilities
export { getActiveSheetId, getUIStore, handled };

// =============================================================================
// Factory Helpers
// =============================================================================

/**
 * Create a cell value getter for the current sheet.
 * Uses ViewportBuffer for sync viewport-scoped reads.
 *
 * WARNING: Only sees cells within the current viewport prefetch region.
 * For data-edge navigation (Ctrl+Arrow), use createCellValueGetterForStrip()
 * which pre-fetches the full strip from the kernel.
 */
export function createCellValueGetter(deps: ActionDependencies): CellValueGetter {
  const ws = deps.workbook.activeSheet;
  return (row: number, col: number) => {
    const cellData = ws.viewport.getCellData(row, col);
    return cellData?.value ?? undefined;
  };
}

/**
 * Create a visibility checker for the current sheet.
 * Used by navigation utilities to skip hidden rows/columns.
 * Returns true if the cell at (row, col) is hidden (either row or column is hidden).
 *
 * Fetches hidden-row and hidden-column bitmaps upfront (async), then returns
 * a sync checker that uses Set.has() — no unawaited promises.
 */
export async function createVisibilityChecker(
  deps: ActionDependencies,
): Promise<(row: number, col: number) => boolean> {
  const sheetId = deps.getActiveSheetId();
  const ws = deps.workbook.getSheetById(sheetId);
  const [hiddenRows, hiddenCols] = await Promise.all([
    ws.layout.getHiddenRowsBitmap(),
    ws.layout.getHiddenColumnsBitmap(),
  ]);
  return (row: number, col: number) => {
    return hiddenRows.has(row) || hiddenCols.has(col);
  };
}

// `createMergedRegionGetter` was deleted. Its sole consumer was
// `selection/movement.ts`, which moved the merge-escape concern into the
// selection machine (`machines/selection/merge-escape.ts`). The machine reads
// merges via `ctx.getMergedRegionAt`, wired by the coordinator in
// `GridEditingSystem.refreshLayoutCallbacks()`. Handlers no longer touch
// merge geometry. If you need merge resolution from a non-handler context,
// call the worksheet viewport directly (`ws.viewport.getMerges()`).

// =============================================================================
// Selection Utility Functions
// =============================================================================

/**
 * Check if a selection has multiple cells (for Tab/Enter cycling, collapse behavior).
 * A selection has multiple cells if any range spans more than one cell.
 *
 * Used by: Tab/Enter cycling (Excel Parity 2.1), Arrow key collapse
 */
export function hasMultiCellSelection(ranges: CellRange[]): boolean {
  return ranges.some((r) => {
    const normalized = normalizeRange(r);
    return normalized.startRow !== normalized.endRow || normalized.startCol !== normalized.endCol;
  });
}

// `getCollapseTarget` was deleted. Its sole consumer was
// `selection/movement.ts`, which now delegates collapse semantics to the
// selection machine's KEY_ARROW assign action (`moveActiveCell` in
// `machines/selection/keyboard-actions.ts`). The machine handles collapse
// for multi-cell selections inline using the same anchor-relative geometry
// rules previously implemented here.
