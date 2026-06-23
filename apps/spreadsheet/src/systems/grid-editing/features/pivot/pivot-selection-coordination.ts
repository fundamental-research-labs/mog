import type { WorkbookInternal } from '@mog-sdk/contracts/api';
import type { CellRange } from '@mog-sdk/contracts/core';
import { sheetId as toSheetId } from '@mog-sdk/contracts/core';

import type { CleanupManager } from '../../../shared/cleanup-manager';
import type { ReadableStoreApi } from '../../../shared/types';
import type { GridEditingUIStore } from '../../types';
import { findPivotAtCell } from '../../../../pivot/pivot-view-records';

export interface PivotSelectionCoordinationConfig {
  actors: {
    selection: {
      getSnapshot: () => PivotSelectionSnapshot;
      subscribe: (listener: (state: PivotSelectionSnapshot) => void) => { unsubscribe: () => void };
    };
  };
  uiStoreApi: ReadableStoreApi<GridEditingUIStore>;
  getActiveSheetId: () => string;
  workbook: WorkbookInternal;
  importDurability?: {
    readonly isImportDurabilityPending: boolean;
    awaitImportDurability(): Promise<void>;
  };
}

interface PivotSelectionSnapshot {
  context: { activeCell: { row: number; col: number }; pendingRange?: CellRange };
  matches: (value: string) => boolean;
}

function selectionSignature(snapshot: PivotSelectionSnapshot): string {
  const { activeCell, pendingRange } = snapshot.context;
  return pendingRange
    ? `${activeCell.row}:${activeCell.col}:${pendingRange.startRow}:${pendingRange.startCol}:${pendingRange.endRow}:${pendingRange.endCol}`
    : `${activeCell.row}:${activeCell.col}`;
}

function isSingleCellSelection(snapshot: PivotSelectionSnapshot): boolean {
  const { activeCell, pendingRange } = snapshot.context;
  if (!pendingRange) return true;
  return (
    pendingRange.startRow === activeCell.row &&
    pendingRange.endRow === activeCell.row &&
    pendingRange.startCol === activeCell.col &&
    pendingRange.endCol === activeCell.col
  );
}

export function setupPivotSelectionCoordination(
  config: PivotSelectionCoordinationConfig,
  cleanups: CleanupManager,
): { cleanup: () => void } {
  const { actors, uiStoreApi, getActiveSheetId, workbook, importDurability } = config;
  let prevActiveCell = actors.selection.getSnapshot().context.activeCell;
  let prevSelectionSignature = selectionSignature(actors.selection.getSnapshot());
  let hasPendingUpdate = false;
  let disposed = false;
  let refreshGeneration = 0;

  const setSelectedPivot = (
    pivotId: string | null,
    selectionSnapshot: PivotSelectionSnapshot,
  ): void => {
    const state = uiStoreApi.getState();
    if (pivotId != null) {
      const suppressFieldPanel =
        state.pivot.fieldPanelSuppressedPivotId === pivotId &&
        state.pivot.selectedPivotId === pivotId &&
        state.pivot.editingPivotId == null &&
        state.pivot.openTransientOverlay == null &&
        isSingleCellSelection(selectionSnapshot);
      if (suppressFieldPanel) return;
      if (
        state.pivot.selectedPivotId !== pivotId ||
        state.pivot.editingPivotId !== pivotId ||
        state.pivot.openTransientOverlay != null
      ) {
        state.startEditingPivot(pivotId);
      }
      return;
    }

    if (state.pivot.selectedPivotId !== null || state.pivot.editingPivotId !== null) {
      state.selectPivot(null);
    }
  };

  const refreshSelectedPivotAtActiveCell = (): void => {
    const generation = ++refreshGeneration;
    const selectionSnapshot = actors.selection.getSnapshot();
    const activeCell = selectionSnapshot.context.activeCell;
    const sheetId = toSheetId(getActiveSheetId());

    void (async () => {
      let pivotId = await findPivotAtCell(workbook, sheetId, activeCell.row, activeCell.col);
      if (pivotId?.startsWith('imported:') && importDurability) {
        const fallbackImportedPivotId = pivotId;
        try {
          await importDurability.awaitImportDurability();
          pivotId =
            (await findPivotAtCell(workbook, sheetId, activeCell.row, activeCell.col)) ??
            fallbackImportedPivotId;
        } catch (error) {
          console.warn('[PivotSelectionCoordination] Failed to materialize imported pivot', error);
          pivotId = fallbackImportedPivotId;
        }
      }
      if (disposed || generation !== refreshGeneration) return;
      setSelectedPivot(pivotId, selectionSnapshot);
    })();
  };

  const selectionSub = actors.selection.subscribe((state) => {
    const currActiveCell = state.context.activeCell;
    const currSelectionSignature = selectionSignature(state);
    const activeCellChanged =
      currActiveCell.row !== prevActiveCell.row || currActiveCell.col !== prevActiveCell.col;
    const selectionChanged = currSelectionSignature !== prevSelectionSignature;
    if (selectionChanged) {
      prevSelectionSignature = currSelectionSignature;
    }
    if (activeCellChanged) {
      prevActiveCell = currActiveCell;
    }
    if (activeCellChanged || selectionChanged) {
      hasPendingUpdate = true;
    }
    if (state.matches('idle') && hasPendingUpdate) {
      hasPendingUpdate = false;
      refreshSelectedPivotAtActiveCell();
    }
  });

  const activeSheetUnsub = uiStoreApi.subscribe((state, previousState) => {
    if (state.activeSheetId !== previousState.activeSheetId) {
      const selectionSnapshot = actors.selection.getSnapshot();
      prevActiveCell = selectionSnapshot.context.activeCell;
      prevSelectionSignature = selectionSignature(selectionSnapshot);
      hasPendingUpdate = false;
      refreshSelectedPivotAtActiveCell();
    }
  });

  refreshSelectedPivotAtActiveCell();

  const cleanup = () => {
    disposed = true;
    refreshGeneration++;
    selectionSub.unsubscribe();
    activeSheetUnsub();
  };

  cleanups.register('pivotSelectionCoordination', cleanup);
  return { cleanup };
}
