import type { WorkbookInternal } from '@mog-sdk/contracts/api';
import type { SelectionState } from '@mog-sdk/contracts/actors/selection';
import { sheetId as toSheetId } from '@mog-sdk/contracts/core';
import type { CellRange, SheetId } from '@mog-sdk/contracts/core';
import type { CellCoord } from '@mog-sdk/contracts/rendering';
import { cellRangeToA1, parseA1, parseA1Range, toA1 } from '@mog/spreadsheet-utils/a1';

import { selectionSelectors } from '../../selectors';
import type {
  SpreadsheetEmbedActiveSheetSnapshot,
  SpreadsheetEmbedAppBridge,
  SpreadsheetEmbedSelectionSnapshot,
} from '../context/embed-runtime-context';

type SelectionActor = {
  getSnapshot(): SelectionState;
  send(event: {
    type: 'SET_SELECTION';
    ranges: CellRange[];
    activeCell: CellCoord;
    source: 'agent';
  }): void;
  subscribe(handler: () => void): { unsubscribe(): void };
};

type EmbedCoordinator = {
  grid: {
    startEditing(cell: CellCoord, sheetId: SheetId, value?: string): void;
    access: {
      actors: {
        selection: SelectionActor;
      };
      commands: {
        editor: {
          commit(mode: 'none'): void;
          cancel(): void;
        };
      };
    };
  };
  renderer: {
    access: {
      commands: {
        renderer?: {
          scrollToActiveCell(cell: CellCoord): void;
        };
      };
    };
  };
};

type UIStoreState = {
  activeSheetId: SheetId;
  setActiveSheet(sheetId: SheetId): void;
};

type UIStore = {
  getState(): UIStoreState;
  subscribe(handler: (state: UIStoreState, previousState: UIStoreState) => void): () => void;
};

interface CreateSpreadsheetEmbedAppBridgeOptions {
  readonly documentId: string;
  readonly workbook: WorkbookInternal;
  readonly uiStore: UIStore;
  readonly coordinator: EmbedCoordinator;
}

export function createSpreadsheetEmbedAppBridge({
  documentId,
  workbook,
  uiStore,
  coordinator,
}: CreateSpreadsheetEmbedAppBridgeOptions): SpreadsheetEmbedAppBridge {
  const selectionActor = coordinator.grid.access.actors.selection;

  const getActiveSheetId = () => uiStore.getState().activeSheetId;

  const getSelection = (): SpreadsheetEmbedSelectionSnapshot => {
    const sheetId = getActiveSheetId();
    const selectionSnapshot = selectionActor.getSnapshot();
    const activeCell = selectionSelectors.activeCell(selectionSnapshot);
    return {
      activeSheetId: sheetId,
      selectedRanges: selectionSelectors.ranges(selectionSnapshot).map(cellRangeToA1),
      activeCell: activeCell
        ? {
            sheetId,
            row: activeCell.row,
            col: activeCell.col,
            address: toA1(activeCell.row, activeCell.col),
          }
        : null,
    };
  };

  const getActiveSheet = (): SpreadsheetEmbedActiveSheetSnapshot => {
    const sheetId = getActiveSheetId();
    let sheetName: string | undefined;
    try {
      sheetName = workbook.getSheetById(sheetId).name;
    } catch {
      sheetName = undefined;
    }
    return { sheetId, sheetName };
  };

  const resolveSheetId = async (sheetIdOrName?: string) => {
    if (!sheetIdOrName) return getActiveSheetId();
    const found = await workbook.findSheet(sheetIdOrName);
    return found ? found.getSheetId() : toSheetId(sheetIdOrName);
  };

  const setActiveSheet = async (sheetIdOrName: string) => {
    const sheetId = await resolveSheetId(sheetIdOrName);
    uiStore.getState().setActiveSheet(sheetId);
  };

  const selectRange = async (input: { readonly sheet?: string; readonly range: string }) => {
    if (input.sheet) {
      await setActiveSheet(input.sheet);
    }
    const range = parseA1Range(input.range);
    const activeCell = { row: range.startRow, col: range.startCol };
    selectionActor.send({
      type: 'SET_SELECTION',
      ranges: [range],
      activeCell,
      source: 'agent',
    });
  };

  const scrollTo = async (input: {
    readonly sheet?: string;
    readonly range?: string;
    readonly row?: number;
    readonly col?: number;
  }) => {
    if (input.sheet) {
      await setActiveSheet(input.sheet);
    }
    const cell = input.range
      ? parseA1Range(input.range)
      : input.row !== undefined && input.col !== undefined
        ? { startRow: input.row, startCol: input.col, endRow: input.row, endCol: input.col }
        : null;
    if (!cell) return;
    coordinator.renderer.access.commands.renderer?.scrollToActiveCell({
      row: cell.startRow,
      col: cell.startCol,
    });
  };

  return {
    documentId,
    getSelection,
    getActiveSheet,
    setActiveSheet,
    select: selectRange,
    scrollTo,
    startEdit: async (input: {
      readonly sheet?: string;
      readonly address: string;
      readonly value?: string;
    }) => {
      if (input.sheet) {
        await setActiveSheet(input.sheet);
      }
      const cell = parseA1(input.address);
      coordinator.grid.startEditing(cell, getActiveSheetId(), input.value);
    },
    commitEdit: async () => {
      coordinator.grid.access.commands.editor.commit('none');
    },
    cancelEdit: async () => {
      coordinator.grid.access.commands.editor.cancel();
    },
    onSelectionChange: (handler: (snapshot: SpreadsheetEmbedSelectionSnapshot) => void) => {
      const subscription = selectionActor.subscribe(() => handler(getSelection()));
      return () => subscription.unsubscribe();
    },
    onActiveSheetChange: (handler: (snapshot: SpreadsheetEmbedActiveSheetSnapshot) => void) => {
      return uiStore.subscribe((state, previousState) => {
        if (state.activeSheetId !== previousState.activeSheetId) {
          handler(getActiveSheet());
        }
      });
    },
  };
}
