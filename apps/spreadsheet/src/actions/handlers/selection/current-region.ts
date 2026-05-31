/**
 * Shared Ctrl+A current-region behavior.
 *
 * Kept outside select-all.ts so table-progressive fallback can reuse the
 * implementation without importing another dispatcher-registered handler module.
 */

import type { AsyncActionHandler } from '@mog-sdk/contracts/actions';

import { getUIStore, handled, normalizeRange, type CellRange } from './helpers';

function isAllCellsSelected(ranges: CellRange[]): boolean {
  if (ranges.length !== 1) return false;
  const range = normalizeRange(ranges[0]);
  // Check if the selection covers the entire sheet (row 0 to MAX, col 0 to MAX)
  // The selectAll range is 0-999, 0-25 per getSelectAllRange()
  return range.startRow === 0 && range.startCol === 0 && range.endRow >= 999 && range.endCol >= 25;
}

/**
 * SELECT_CURRENT_REGION - literal Ctrl+Shift+* current-region selection.
 *
 * Unlike Ctrl+A, this command is not progressive. It always selects the
 * kernel-reported current region around the active cell and resets any stale
 * Ctrl+A cycle state so the next Ctrl+A starts fresh.
 */
export const selectCurrentRegion: AsyncActionHandler = async (deps) => {
  const sheetId = deps.getActiveSheetId();
  const activeCell = deps.accessors.selection.getActiveCell();

  const ws = deps.workbook.getSheetById(sheetId);
  const region = await ws.getCurrentRegion(activeCell.row, activeCell.col);

  deps.commands.selection.setSelection(
    [
      {
        startRow: region.startRow,
        startCol: region.startCol,
        endRow: region.endRow,
        endCol: region.endCol,
      },
    ],
    activeCell,
  );

  getUIStore(deps)?.getState()?.resetCtrlAState?.();
  return handled();
};

/**
 * Ctrl+A progressive current-region cycle.
 *
 * Excel Parity 2.2:
 * - First press: Select current data region (contiguous cells around active cell)
 * - If active cell is isolated (no adjacent data), skip directly to select all
 * - If active cell is empty but surrounded by data, select the surrounding region
 * - Second press (within 500ms): Select entire sheet
 * - Third press (within 500ms, when all cells selected): Select all floating objects
 */
export const cycleCurrentRegionSelection: AsyncActionHandler = async (deps) => {
  const sheetId = deps.getActiveSheetId();
  const activeCell = deps.accessors.selection.getActiveCell();
  const ranges = deps.accessors.selection.getRanges();

  const uiStore = getUIStore(deps);
  const nextState = uiStore?.getState()?.getNextCtrlAState?.() ?? 'region';

  if (nextState === 'all' && !isAllCellsSelected(ranges)) {
    deps.commands.selection.selectAll();
    uiStore?.getState()?.recordCtrlAPress?.('all');
    return handled();
  }

  const ws = deps.workbook.getSheetById(sheetId);

  if (nextState === 'objects' || (nextState === 'all' && isAllCellsSelected(ranges))) {
    const charts = await ws.charts.list();
    const allObjectIds: string[] = [...charts.map((c) => c.id)];

    if (allObjectIds.length > 0) {
      deps.commands.object?.selectMultiple(allObjectIds);
      uiStore?.getState()?.recordCtrlAPress?.('objects');
    } else {
      uiStore?.getState()?.recordCtrlAPress?.('region');
    }
    return handled();
  }

  // Record before awaiting the kernel so a rapid second Ctrl+A advances state.
  uiStore?.getState()?.recordCtrlAPress?.('region');

  const region = await ws.getCurrentRegion(activeCell.row, activeCell.col);

  const isSingleCell =
    region.startRow === region.endRow &&
    region.startCol === region.endCol &&
    region.startRow === activeCell.row &&
    region.startCol === activeCell.col;

  if (isSingleCell) {
    deps.commands.selection.selectAll();
    uiStore?.getState()?.recordCtrlAPress?.('all');
    return handled();
  }

  deps.commands.selection.setSelection(
    [
      {
        startRow: region.startRow,
        startCol: region.startCol,
        endRow: region.endRow,
        endCol: region.endCol,
      },
    ],
    activeCell,
  );

  return handled();
};
