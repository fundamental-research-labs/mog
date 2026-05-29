import type { WorkbookInternal } from '@mog-sdk/contracts/api';
import { sheetId as toSheetId, type SheetId } from '@mog-sdk/contracts/core';

import type { CleanupManager } from '../../../shared/cleanup-manager';
import type { ReadableStoreApi } from '../../../shared/types';
import type { GridEditingUIStore } from '../../types';
import type { WorkbookWithImportedPivots } from '../../../../pivot/imported-pivot-runtime';

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
}

interface PivotSelectionSnapshot {
  context: { activeCell: { row: number; col: number } };
  matches: (value: string) => boolean;
}

interface Bounds {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
}

function parseA1Range(ref: string): Bounds | null {
  const [startRef, endRef = startRef] = ref.replace(/\$/g, '').split(':');
  const start = /^([A-Z]+)([0-9]+)$/i.exec(startRef);
  const end = /^([A-Z]+)([0-9]+)$/i.exec(endRef);
  if (!start || !end) return null;
  const colToIndex = (letters: string): number =>
    letters
      .toUpperCase()
      .split('')
      .reduce((acc, ch) => acc * 26 + ch.charCodeAt(0) - 64, 0) - 1;
  return {
    startRow: Number(start[2]) - 1,
    startCol: colToIndex(start[1]),
    endRow: Number(end[2]) - 1,
    endCol: colToIndex(end[1]),
  };
}

function contains(bounds: Bounds, row: number, col: number): boolean {
  return (
    row >= bounds.startRow && row <= bounds.endRow && col >= bounds.startCol && col <= bounds.endCol
  );
}

async function findEditablePivotAtActiveCell(
  workbook: WorkbookInternal,
  sheetId: SheetId,
  row: number,
  col: number,
): Promise<string | null> {
  try {
    const editablePivots = await workbook.pivot.getAllPivots(sheetId);
    const worksheet = workbook.getSheetById(sheetId);
    for (const pivot of editablePivots) {
      const range = await worksheet.pivots.getRange(pivot.name).catch(() => null);
      const bounds = range ?? (pivot.refRange ? parseA1Range(pivot.refRange) : null);
      if (bounds && contains(bounds, row, col)) {
        return pivot.id;
      }
    }
  } catch {
    return null;
  }
  return null;
}

async function findImportedPivotAtActiveCell(
  workbook: WorkbookInternal,
  sheetId: SheetId,
  row: number,
  col: number,
): Promise<string | null> {
  try {
    const importedPivot = await (
      workbook as WorkbookWithImportedPivots
    ).importedPivots?.findRenderedImportedPivotAt(sheetId, row, col);
    return importedPivot?.id ?? null;
  } catch {
    return null;
  }
}

export function setupPivotSelectionCoordination(
  config: PivotSelectionCoordinationConfig,
  cleanups: CleanupManager,
): { cleanup: () => void } {
  const { actors, uiStoreApi, getActiveSheetId, workbook } = config;
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
      const editablePivotId = await findEditablePivotAtActiveCell(
        workbook,
        sheetId,
        activeCell.row,
        activeCell.col,
      );
      if (disposed || generation !== refreshGeneration) return;
      if (editablePivotId != null) {
        setSelectedPivot(editablePivotId);
        return;
      }

      const importedPivotId = await findImportedPivotAtActiveCell(
        workbook,
        sheetId,
        activeCell.row,
        activeCell.col,
      );
      if (disposed || generation !== refreshGeneration) return;
      setSelectedPivot(importedPivotId);
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
