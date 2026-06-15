/**
 * Merge Operation Action Handlers
 *
 * Handles cell merge operations:
 * - Merge and center (with toggle unmerge)
 * - Merge across (per-row merges)
 * - Unmerge cells
 * - Merge warning dialog flow (data loss detection)
 *
 * Warning Dialog Flow:
 * 1. User triggers merge on selection with data
 * 2. Handler checks for non-top-left cells with data
 * 3. If data found, opens warning dialog
 * 4. User confirms (CONFIRM_MERGE_WITH_DATA_LOSS) or cancels (CANCEL_MERGE)
 */

import type { ActionHandler, AsyncActionHandler } from '@mog-sdk/contracts/actions';
import type { ViewportReader } from '@mog-sdk/contracts/api';
import type { CellFormat, CellRange, SheetId } from '@mog-sdk/contracts/core';

import { toA1 } from '@mog/spreadsheet-utils/a1';

import type {
  CellCoord,
  MergeOperationType,
} from '../../../ui-store/slices/dialogs/merge-warning-dialog';

import { callUIStoreAction, getSelectionContext, getUIState } from './shared';

/**
 * Format an A1-style description for a merge operation, e.g. "A1:B2" or
 * "A1" for a single-cell selection. Used for undo labels; matches the deleted
 * useMerge hook's wording so undo history stays user-recognizable.
 */
function describeRange(startRow: number, startCol: number, endRow: number, endCol: number): string {
  if (startRow === endRow && startCol === endCol) {
    return toA1(startRow, startCol);
  }
  return `${toA1(startRow, startCol)}:${toA1(endRow, endCol)}`;
}

// =============================================================================
// Internal Helpers
// =============================================================================

/**
 * Check for cells with data in a merge range using viewport reader (sync, viewport-scoped).
 * Falls back gracefully for off-viewport cells -- they won't be detected, which is acceptable
 * since merge operations typically happen on visible selections.
 */
function getCellsWithDataInRange(
  viewport: ViewportReader,
  startRow: number,
  startCol: number,
  endRow: number,
  endCol: number,
): CellCoord[] {
  const cellsWithData: CellCoord[] = [];
  for (let row = startRow; row <= endRow; row++) {
    for (let col = startCol; col <= endCol; col++) {
      // Skip top-left cell (its value is kept)
      if (row === startRow && col === startCol) continue;

      const cellData = viewport.getCellData(row, col);
      if (cellData?.value != null && cellData.value !== '') {
        cellsWithData.push({ row, col });
      }
    }
  }
  return cellsWithData;
}

type ConfirmMergeWithDataLossPayload = {
  pendingRange?: CellRange | null;
  sheetId?: SheetId | null;
  mergeType?: MergeOperationType | null;
};

// =============================================================================
// Merge Operations
// =============================================================================

/**
 * Merge cells across each row separately.
 * Creates separate horizontal merges for each row in the selection.
 * Shows warning dialog if non-first-column cells contain data.
 *
 * Example: Selection A1:C3 creates:
 * - Merge A1:C1
 * - Merge A2:C2
 * - Merge A3:C3
 */
export const MERGE_ACROSS: AsyncActionHandler = async (deps) => {
  const sheetId = deps.getActiveSheetId();
  const ws = deps.workbook.getSheetById(sheetId);
  const { ranges } = getSelectionContext(deps);

  if (ranges.length === 0) {
    return { handled: false, reason: 'wrong_context' };
  }

  // Use the first range
  const range = ranges[0];
  const { startRow, startCol, endRow, endCol } = range;

  // Must span at least 2 columns
  if (startCol >= endCol) {
    return { handled: true }; // Valid action but nothing to do
  }

  // Check for cells with data in non-first-column positions (per row)
  // Uses viewport for sync viewport-scoped reads
  const cellsWithData: CellCoord[] = [];
  const viewport = ws.viewport;
  for (let row = startRow; row <= endRow; row++) {
    for (let col = startCol + 1; col <= endCol; col++) {
      const cellData = viewport.getCellData(row, col);
      if (cellData?.value != null && cellData.value !== '') {
        cellsWithData.push({ row, col });
      }
    }
  }

  // If there are cells with data, show warning dialog
  if (cellsWithData.length > 0) {
    callUIStoreAction(deps, (state) => {
      state.openMergeWarningDialog(sheetId, range, cellsWithData, 'mergeAcross');
    });
    return { handled: true };
  }

  // No data loss - proceed with merge across directly via Worksheet API.
  deps.workbook.setPendingUndoDescription(
    `Merge across ${describeRange(startRow, startCol, endRow, endCol)}`,
  );
  await deps.workbook.undoGroup(async () => {
    for (let row = startRow; row <= endRow; row++) {
      await ws.structure.merge(row, startCol, row, endCol);
    }
  });

  return { handled: true };
};

/**
 * Merge and center selected cells.
 * Combines all cells into one merge and centers the content.
 * Shows warning dialog if non-top-left cells contain data.
 */
export const MERGE_AND_CENTER: AsyncActionHandler = async (deps) => {
  const sheetId = deps.getActiveSheetId();
  const ws = deps.workbook.getSheetById(sheetId);
  const { ranges } = getSelectionContext(deps);

  if (ranges.length === 0) {
    return { handled: false, reason: 'wrong_context' };
  }

  // Use the first range
  const range = ranges[0];
  const { startRow, startCol, endRow, endCol } = range;

  // Must span at least 2 cells
  if (startRow === endRow && startCol === endCol) {
    return { handled: true }; // Valid action but nothing to do
  }

  // Check if already merged - if so, unmerge (using viewport sync merges)
  const viewportMerges = ws.viewport.getMerges();
  const existingMerge = viewportMerges.find(
    (m) =>
      startRow >= m.start_row &&
      startRow <= m.end_row &&
      startCol >= m.start_col &&
      startCol <= m.end_col,
  );
  if (
    existingMerge &&
    existingMerge.start_row === startRow &&
    existingMerge.start_col === startCol &&
    existingMerge.end_row === endRow &&
    existingMerge.end_col === endCol
  ) {
    // Already merged with same dimensions - unmerge
    deps.workbook.setPendingUndoDescription(
      `Unmerge ${describeRange(startRow, startCol, endRow, endCol)}`,
    );
    await ws.structure.unmerge(startRow, startCol, endRow, endCol);
    return { handled: true };
  }

  // Check for cells with data (non-top-left)
  const cellsWithData = getCellsWithDataInRange(ws.viewport, startRow, startCol, endRow, endCol);

  // If there are cells with data, show warning dialog
  if (cellsWithData.length > 0) {
    callUIStoreAction(deps, (state) => {
      state.openMergeWarningDialog(sheetId, range, cellsWithData, 'mergeAndCenter');
    });
    return { handled: true };
  }

  // No data loss - proceed with merge directly via Worksheet API.
  // Undo description matches the deleted useMerge hook's wording.
  deps.workbook.setPendingUndoDescription(
    `Merge ${describeRange(startRow, startCol, endRow, endCol)} and center`,
  );

  // Unmerge any existing merges in the range first
  await deps.workbook.undoGroup(async () => {
    await ws.structure.unmerge(startRow, startCol, endRow, endCol);

    // Create the new merge
    await ws.structure.merge(startRow, startCol, endRow, endCol);

    // Apply center alignment to the merged cell
    await ws.formats.set(startRow, startCol, {
      horizontalAlign: 'center',
      verticalAlign: 'middle',
    } as CellFormat);
  });

  return { handled: true };
};

/**
 * Unmerge all merged cells in the selection.
 */
export const UNMERGE_CELLS: AsyncActionHandler = async (deps) => {
  const sheetId = deps.getActiveSheetId();
  const { ranges } = getSelectionContext(deps);

  if (ranges.length === 0) {
    return { handled: false, reason: 'wrong_context' };
  }

  // Unmerge all ranges via Worksheet API
  const ws = deps.workbook.getSheetById(sheetId);
  // Use the first range's bounds for the undo description (matches the
  // deleted useMerge hook). Multi-range unmerge inherits this label too —
  // a future cleanup can compose a multi-range description if needed.
  const first = ranges[0];
  deps.workbook.setPendingUndoDescription(
    `Unmerge ${describeRange(first.startRow, first.startCol, first.endRow, first.endCol)}`,
  );
  await deps.workbook.undoGroup(async () => {
    for (const range of ranges) {
      await ws.structure.unmerge(range.startRow, range.startCol, range.endRow, range.endCol);
    }
  });

  return { handled: true };
};

/**
 * Toggle merge for selected cells.
 * TODO: Implement merge toggle logic.
 */
export const TOGGLE_MERGE: ActionHandler = (_deps) => {
  // TODO: Implement merge toggle
  // This requires checking if selection is already merged:
  // - If merged: unmerge
  // - If not merged: merge
  return { handled: false, reason: 'not_implemented' };
};

// =============================================================================
// Merge Warning Dialog Handlers
// =============================================================================

/**
 * Plain "Merge Cells" — symmetric with Excel's Home > Merge & Center >
 * Merge Cells command. Combines the selection into a single merge but does
 * NOT apply center alignment (that's MERGE_AND_CENTER's job).
 *
 * Like MERGE_ACROSS / MERGE_AND_CENTER, this opens a warning dialog if
 * non-top-left cells contain data; the user can confirm via
 * CONFIRM_MERGE_WITH_DATA_LOSS (mergeType='merge') or cancel.
 */
export const MERGE_CELLS: AsyncActionHandler = async (deps) => {
  const sheetId = deps.getActiveSheetId();
  const ws = deps.workbook.getSheetById(sheetId);
  const { ranges } = getSelectionContext(deps);

  if (ranges.length === 0) {
    return { handled: false, reason: 'wrong_context' };
  }

  // Use the first range
  const range = ranges[0];
  const { startRow, startCol, endRow, endCol } = range;

  // Single cell - nothing to merge
  if (startRow === endRow && startCol === endCol) {
    return { handled: true };
  }

  // Check for cells with data (non-top-left)
  const cellsWithData = getCellsWithDataInRange(ws.viewport, startRow, startCol, endRow, endCol);

  // If there are cells with data, show warning dialog. Tag as 'merge' so the
  // confirm path goes through the no-center branch in
  // CONFIRM_MERGE_WITH_DATA_LOSS.
  if (cellsWithData.length > 0) {
    callUIStoreAction(deps, (state) => {
      state.openMergeWarningDialog(sheetId, range, cellsWithData, 'merge');
    });
    return { handled: true };
  }

  // No data loss - proceed with merge directly via Worksheet API.
  // No center alignment applied (that's MERGE_AND_CENTER).
  deps.workbook.setPendingUndoDescription(
    `Merge ${describeRange(startRow, startCol, endRow, endCol)}`,
  );
  await deps.workbook.undoGroup(async () => {
    await ws.structure.unmerge(startRow, startCol, endRow, endCol);
    await ws.structure.merge(startRow, startCol, endRow, endCol);
  });

  return { handled: true };
};

/**
 * Confirm merge with data loss - user clicked OK in warning dialog.
 * Proceeds with merge, clearing data from non-top-left cells.
 * Handles different merge types: merge, mergeAcross, mergeAndCenter.
 */
export const CONFIRM_MERGE_WITH_DATA_LOSS: AsyncActionHandler = async (
  deps,
  payload?: ConfirmMergeWithDataLossPayload,
) => {
  const uiState = getUIState(deps);
  const dialogState = payload ?? uiState.mergeWarningDialog;
  const { pendingRange, sheetId, mergeType } = dialogState;

  if (!pendingRange || !sheetId) {
    // Close dialog and return
    callUIStoreAction(deps, (state) => state.closeMergeWarningDialog());
    return { handled: false, reason: 'wrong_context' };
  }

  const { startRow, startCol, endRow, endCol } = pendingRange;
  const ws = deps.workbook.getSheetById(sheetId);

  const description =
    mergeType === 'mergeAcross'
      ? `Merge across ${describeRange(startRow, startCol, endRow, endCol)}`
      : mergeType === 'merge'
        ? `Merge ${describeRange(startRow, startCol, endRow, endCol)}`
        : `Merge ${describeRange(startRow, startCol, endRow, endCol)} and center`;
  deps.workbook.setPendingUndoDescription(description);

  // Perform the merge based on merge type
  await deps.workbook.undoGroup(async () => {
    switch (mergeType) {
      case 'mergeAcross':
        for (let row = startRow; row <= endRow; row++) {
          await ws.structure.merge(row, startCol, row, endCol);
        }
        break;
      case 'merge':
        await ws.structure.unmerge(startRow, startCol, endRow, endCol);
        await ws.structure.merge(startRow, startCol, endRow, endCol);
        break;
      case 'mergeAndCenter':
      default: {
        // Default to merge and center via Worksheet API
        await ws.structure.unmerge(startRow, startCol, endRow, endCol);
        await ws.structure.merge(startRow, startCol, endRow, endCol);
        // Apply center alignment to the merged cell
        await ws.formats.set(startRow, startCol, {
          horizontalAlign: 'center',
          verticalAlign: 'middle',
        } as CellFormat);
        break;
      }
    }
  });

  // Close the dialog
  callUIStoreAction(deps, (state) => state.closeMergeWarningDialog());
  return { handled: true };
};

/**
 * Cancel merge - user clicked Cancel in warning dialog.
 * Just closes the dialog without merging.
 */
export const CANCEL_MERGE: ActionHandler = (deps) => {
  callUIStoreAction(deps, (state) => state.closeMergeWarningDialog());
  return { handled: true };
};
