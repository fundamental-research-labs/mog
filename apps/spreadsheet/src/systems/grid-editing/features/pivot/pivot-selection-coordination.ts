import type { WorkbookInternal } from '@mog-sdk/contracts/api';
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
  context: { activeCell: { row: number; col: number } };
  matches: (value: string) => boolean;
}

export function setupPivotSelectionCoordination(
  config: PivotSelectionCoordinationConfig,
  cleanups: CleanupManager,
): { cleanup: () => void } {
  const { actors, uiStoreApi, getActiveSheetId, workbook, importDurability } = config;
  let prevActiveCell = actors.selection.getSnapshot().context.activeCell;
  let hasPendingUpdate = false;
  let disposed = false;
  let refreshGeneration = 0;

  const setSelectedPivot = (pivotId: string | null): void => {
    const state = uiStoreApi.getState();
    if (pivotId != null) {
      if (state.pivot.selectedPivotId !== pivotId || state.pivot.editingPivotId !== pivotId) {
        state.startEditingPivot(pivotId);
      }
      return;
    }

    if (state.pivot.selectedPivotId !== null) {
      state.selectPivot(null);
    }
    if (state.pivot.editingPivotId != null) {
      state.stopEditingPivot();
    }
  };

  const refreshSelectedPivotAtActiveCell = (): void => {
    const generation = ++refreshGeneration;
    const activeCell = actors.selection.getSnapshot().context.activeCell;
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
      setSelectedPivot(pivotId);
    })();
  };

  const selectionSub = actors.selection.subscribe((state) => {
    const currActiveCell = state.context.activeCell;
    const activeCellChanged =
      currActiveCell.row !== prevActiveCell.row || currActiveCell.col !== prevActiveCell.col;
    if (activeCellChanged) {
      prevActiveCell = currActiveCell;
      hasPendingUpdate = true;
    }
    if (state.matches('idle') && hasPendingUpdate) {
      hasPendingUpdate = false;
      refreshSelectedPivotAtActiveCell();
    }
  });

  const activeSheetUnsub = uiStoreApi.subscribe((state, previousState) => {
    if (state.activeSheetId !== previousState.activeSheetId) {
      prevActiveCell = actors.selection.getSnapshot().context.activeCell;
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
