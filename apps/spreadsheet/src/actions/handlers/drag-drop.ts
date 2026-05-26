/**
 * Drag-Drop Action Handlers
 *
 * Pure handler functions for drag-drop overwrite dialog actions.
 * These handlers are called by the unified action dispatcher.
 *
 * ARCHITECTURE:
 * - Handlers are pure functions: (deps, payload?) => ActionResult
 * - They access UIStore through deps.uiStore
 * - They do NOT store references to deps
 *
 * This file handles:
 * - SHOW_DRAG_DROP_OVERWRITE_DIALOG - Opens dialog when dropping on occupied cells
 * - CONFIRM_DRAG_DROP_OVERWRITE - User confirms overwrite, execute pending drop
 * - CANCEL_DRAG_DROP_OVERWRITE - User cancels, clear pending drop info
 *
 */

import type {
  ActionDependencies,
  ActionHandler,
  AsyncActionHandler,
} from '@mog-sdk/contracts/actions';
import type { CellRange, SheetId } from '@mog-sdk/contracts/core';

import { guardBridgeMutation } from './bridge-error-guard';
import { getUIStore, handled, notHandled } from './handler-utils';

// =============================================================================
// Payload Types
// =============================================================================

/**
 * Payload for SHOW_DRAG_DROP_OVERWRITE_DIALOG action.
 */
export interface ShowDragDropOverwriteDialogPayload {
  sourceRange: CellRange;
  targetCell: { row: number; col: number };
  mode: 'move' | 'copy';
  sheetId: SheetId;
}

// =============================================================================
// Internal Helpers
// =============================================================================

/**
 * Execute a MOVE operation using ws.relocateCells.
 * Preserves CellIds so formulas automatically follow.
 */
async function executeMove(
  deps: ActionDependencies,
  sheetId: SheetId,
  sourceRange: CellRange,
  targetCell: { row: number; col: number },
): Promise<boolean> {
  const ws = deps.workbook.getSheetById(sheetId);
  try {
    return await guardBridgeMutation(() =>
      ws._internal.relocateCells(sourceRange, targetCell.row, targetCell.col),
    );
  } catch (err) {
    console.warn(
      '[DragDropHandlers] Move failed:',
      err instanceof Error ? err.message : String(err),
    );
    return false;
  }
}

/**
 * Execute a COPY operation by creating new cells.
 * Creates new CellIds - source cells are unchanged.
 *
 * Uses deps.workbook Worksheet API for reads (ws.getRange)
 * and writes (ws.setCells).
 */
async function executeCopy(
  deps: ActionDependencies,
  sheetId: SheetId,
  sourceRange: CellRange,
  targetCell: { row: number; col: number },
): Promise<boolean> {
  // Read source cells via Worksheet.getRange (returns CellData[][])
  const ws = deps.workbook.getSheetById(sheetId);
  let rangeData;
  try {
    rangeData = await ws.getRange(
      sourceRange.startRow,
      sourceRange.startCol,
      sourceRange.endRow,
      sourceRange.endCol,
    );
  } catch (err) {
    console.warn('[DragDropHandlers] Copy failed: getRange error', err);
    return false;
  }

  const rowDelta = targetCell.row - sourceRange.startRow;
  const colDelta = targetCell.col - sourceRange.startCol;

  // Collect all writes, then send a single batch IPC call
  const updates: Array<{ row: number; col: number; value: any }> = [];

  for (let r = 0; r < rangeData.length; r++) {
    const row = rangeData[r];
    for (let c = 0; c < row.length; c++) {
      const cell = row[c];

      // Skip empty cells (null value and no formula)
      const hasValue = cell.value !== null && cell.value !== undefined;
      const hasFormula = cell.formula != null && cell.formula.length > 0;
      if (!hasValue && !hasFormula) continue;

      const targetRow = sourceRange.startRow + r + rowDelta;
      const targetCol = sourceRange.startCol + c + colDelta;

      // For formulas, write the formula string; for values, write the value directly
      updates.push({
        row: targetRow,
        col: targetCol,
        value: hasFormula ? cell.formula : cell.value,
      });
    }
  }

  if (updates.length > 0) {
    const ok = await guardBridgeMutation(async () => {
      await ws.setCells(updates);
    });
    if (!ok) return false;
  }

  return true;
}

// =============================================================================
// Drag-Drop Overwrite Dialog Handlers
// =============================================================================

/**
 * Show the drag-drop overwrite warning dialog.
 *
 * Called by DragDropCoordinator when user drops cells onto a range
 * that already contains data. Shows a confirmation dialog before
 * proceeding with the overwrite, unless the user has previously
 * selected "Don't ask again".
 *
 * If "Don't ask again" is enabled, this handler automatically confirms
 * the overwrite without showing the dialog.
 *
 * @param deps - Action dependencies
 * @param payload - { sourceRange, targetCell, mode, sheetId }
 */
export const SHOW_DRAG_DROP_OVERWRITE_DIALOG: AsyncActionHandler = async (deps, payload) => {
  const data = payload as ShowDragDropOverwriteDialogPayload | undefined;

  if (!data?.sourceRange || !data?.targetCell || !data?.mode || !data?.sheetId) {
    return notHandled('disabled');
  }

  const uiStore = getUIStore(deps);
  const state = uiStore.getState();

  // Check if user has opted out of the warning dialog
  if (state.shouldShowDragDropOverwriteDialog && !state.shouldShowDragDropOverwriteDialog()) {
    // User said "Don't ask again" - store pending data and auto-confirm
    state.openDragDropOverwriteDialog({
      sourceRange: data.sourceRange,
      targetCell: data.targetCell,
      mode: data.mode,
      sheetId: data.sheetId,
    });
    // Immediately execute the confirm logic (execute drop without showing dialog)
    // Note: We call the confirm handler directly to avoid circular dependency
    // with the action dispatcher
    await CONFIRM_DRAG_DROP_OVERWRITE(deps);
    return handled();
  }

  // Show the dialog normally
  state.openDragDropOverwriteDialog({
    sourceRange: data.sourceRange,
    targetCell: data.targetCell,
    mode: data.mode,
    sheetId: data.sheetId,
  });

  return handled();
};

/**
 * Confirm drag-drop overwrite.
 *
 * Called when user clicks "OK" or "Replace" in the overwrite dialog.
 * Retrieves pending drop data from UIStore and executes the drop operation.
 *
 * @param deps - Action dependencies
 */
export const CONFIRM_DRAG_DROP_OVERWRITE: AsyncActionHandler = async (deps) => {
  const uiStore = getUIStore(deps);
  const state = uiStore.getState();

  // Check if dialog is open and has pending data
  if (!state.dragDropOverwriteDialog.isOpen || !state.dragDropOverwriteDialog.pendingDropData) {
    return notHandled('disabled');
  }

  // Get pending drop data before closing dialog
  const { sourceRange, targetCell, mode, sheetId } = state.dragDropOverwriteDialog.pendingDropData;

  // Execute the drop based on mode
  let success = false;
  if (mode === 'move') {
    success = await executeMove(deps, sheetId, sourceRange, targetCell);
  } else {
    // executeCopy uses deps.workbook Worksheet API
    success = await executeCopy(deps, sheetId, sourceRange, targetCell);
  }

  if (success) {
    // Update selection to new location via commands
    const rangeWidth = sourceRange.endCol - sourceRange.startCol;
    const rangeHeight = sourceRange.endRow - sourceRange.startRow;
    const newRange: CellRange = {
      sheetId,
      startRow: targetCell.row,
      startCol: targetCell.col,
      endRow: targetCell.row + rangeHeight,
      endCol: targetCell.col + rangeWidth,
    };

    deps.commands.selection.setSelection([newRange], targetCell);
  }

  // Close the dialog and clear pending data
  state.closeDragDropOverwriteDialog();

  return handled();
};

/**
 * Cancel drag-drop overwrite.
 *
 * Called when user clicks "Cancel" in the overwrite dialog or presses Escape.
 * Clears the pending drop data and closes the dialog without executing the drop.
 *
 * @param deps - Action dependencies
 */
export const CANCEL_DRAG_DROP_OVERWRITE: ActionHandler = (deps) => {
  const uiStore = getUIStore(deps);

  // Close the dialog and clear pending data
  uiStore.getState().closeDragDropOverwriteDialog();

  return handled();
};
