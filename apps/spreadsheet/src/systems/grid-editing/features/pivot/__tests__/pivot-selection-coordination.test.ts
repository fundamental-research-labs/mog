import { jest } from '@jest/globals';
import { setupPivotSelectionCoordination } from '../pivot-selection-coordination';

type SelectionState = {
  matches: (value: string) => boolean;
  context: { activeCell: { row: number; col: number } };
};

function idleState(row: number, col: number): SelectionState {
  return {
    matches: (value: string) => value === 'idle',
    context: { activeCell: { row, col } },
  };
}

function selectingState(row: number, col: number): SelectionState {
  return {
    matches: (value: string) => value === 'selecting',
    context: { activeCell: { row, col } },
  };
}

function createMockSelectionActor(initialState: SelectionState = idleState(0, 0)) {
  const subscribers: Array<(state: SelectionState) => void> = [];
  let currentState = initialState;

  return {
    getSnapshot: () => currentState,
    subscribe: (callback: (state: SelectionState) => void) => {
      subscribers.push(callback);
      return {
        unsubscribe: () => {
          const idx = subscribers.indexOf(callback);
          if (idx >= 0) subscribers.splice(idx, 1);
        },
      };
    },
    emit: (state: SelectionState) => {
      currentState = state;
      for (const subscriber of [...subscribers]) subscriber(state);
    },
  };
}

function createMockUIStore(initialSheetId = 'sheet1') {
  let state = {
    activeSheetId: initialSheetId,
    pivot: {
      selectedPivotId: null as string | null,
      editingPivotId: null as string | null,
    },
    selectPivot: jest.fn((pivotId: string | null) => {
      state = {
        ...state,
        pivot: { ...state.pivot, selectedPivotId: pivotId },
      };
    }),
    startEditingPivot: jest.fn((pivotId: string) => {
      state = {
        ...state,
        pivot: { selectedPivotId: pivotId, editingPivotId: pivotId },
      };
    }),
    stopEditingPivot: jest.fn(() => {
      state = {
        ...state,
        pivot: { ...state.pivot, editingPivotId: null },
      };
    }),
  };
  const subscribers: Array<(state: typeof state, previousState: typeof state) => void> = [];

  return {
    getState: () => state,
    subscribe: (callback: (state: typeof state, previousState: typeof state) => void) => {
      subscribers.push(callback);
      return () => {
        const idx = subscribers.indexOf(callback);
        if (idx >= 0) subscribers.splice(idx, 1);
      };
    },
    setActiveSheetId: (sheetId: string) => {
      const previousState = state;
      state = { ...state, activeSheetId: sheetId };
      for (const subscriber of [...subscribers]) subscriber(state, previousState);
    },
  };
}

function createMockWorkbook(options: {
  editablePivots?: Array<{ id: string; name: string; refRange?: string }>;
  editableThrows?: boolean;
  importedHit?: { id: string } | null | ((row: number, col: number) => { id: string } | null);
}) {
  const getAllPivots = jest.fn(async () => {
    if (options.editableThrows) {
      throw new Error('editable pivot bridge unavailable');
    }
    return options.editablePivots ?? [];
  });
  const getRange = jest.fn(async () => null);
  const findRenderedImportedPivotAt = jest.fn(async (_sheetId: string, row: number, col: number) =>
    typeof options.importedHit === 'function'
      ? options.importedHit(row, col)
      : (options.importedHit ?? null),
  );

  return {
    pivot: { getAllPivots },
    getSheetById: jest.fn(() => ({ pivots: { getRange } })),
    importedPivots: { findRenderedImportedPivotAt },
    getAllPivots,
    getRange,
    findRenderedImportedPivotAt,
  };
}

function createCleanupManager() {
  return {
    register: jest.fn(),
  };
}

async function flushAsyncRefreshes() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('Pivot Selection Coordination', () => {
  it('falls back to imported pivot hit testing when editable pivot lookup fails', async () => {
    const selection = createMockSelectionActor(idleState(0, 0));
    const uiStore = createMockUIStore('sheet1');
    const workbook = createMockWorkbook({
      editableThrows: true,
      importedHit: (row, col) =>
        row === 1 && col === 1 ? { id: 'imported:Pivot:xl/pivotTables/pivotTable1.xml' } : null,
    });

    setupPivotSelectionCoordination(
      {
        actors: { selection } as any,
        uiStoreApi: uiStore as any,
        getActiveSheetId: () => uiStore.getState().activeSheetId,
        workbook: workbook as any,
      },
      createCleanupManager() as any,
    );

    selection.emit(selectingState(1, 1));
    await flushAsyncRefreshes();
    expect(uiStore.getState().startEditingPivot).not.toHaveBeenCalled();

    selection.emit(idleState(1, 1));
    await flushAsyncRefreshes();

    expect(workbook.findRenderedImportedPivotAt).toHaveBeenCalledWith('sheet1', 1, 1);
    expect(uiStore.getState().startEditingPivot).toHaveBeenCalledWith(
      'imported:Pivot:xl/pivotTables/pivotTable1.xml',
    );
    expect(uiStore.getState().pivot).toEqual({
      selectedPivotId: 'imported:Pivot:xl/pivotTables/pivotTable1.xml',
      editingPivotId: 'imported:Pivot:xl/pivotTables/pivotTable1.xml',
    });
  });

  it('prefers editable pivots over imported metadata when both contain the active cell', async () => {
    const selection = createMockSelectionActor(idleState(0, 0));
    const uiStore = createMockUIStore('sheet1');
    const workbook = createMockWorkbook({
      editablePivots: [{ id: 'pivot-1', name: 'PivotTable1', refRange: 'A1:D4' }],
      importedHit: { id: 'imported:Pivot:xl/pivotTables/pivotTable1.xml' },
    });

    setupPivotSelectionCoordination(
      {
        actors: { selection } as any,
        uiStoreApi: uiStore as any,
        getActiveSheetId: () => uiStore.getState().activeSheetId,
        workbook: workbook as any,
      },
      createCleanupManager() as any,
    );

    selection.emit(idleState(1, 1));
    await flushAsyncRefreshes();

    expect(uiStore.getState().startEditingPivot).toHaveBeenCalledWith('pivot-1');
    expect(workbook.findRenderedImportedPivotAt).not.toHaveBeenCalledWith('sheet1', 1, 1);
  });

  it('clears selected and editing pivot state when the active cell leaves all pivots', async () => {
    const selection = createMockSelectionActor(idleState(0, 0));
    const uiStore = createMockUIStore('sheet1');
    uiStore.getState().startEditingPivot('pivot-1');
    const workbook = createMockWorkbook({});

    setupPivotSelectionCoordination(
      {
        actors: { selection } as any,
        uiStoreApi: uiStore as any,
        getActiveSheetId: () => uiStore.getState().activeSheetId,
        workbook: workbook as any,
      },
      createCleanupManager() as any,
    );

    selection.emit(idleState(10, 10));
    await flushAsyncRefreshes();

    expect(uiStore.getState().selectPivot).toHaveBeenCalledWith(null);
    expect(uiStore.getState().stopEditingPivot).toHaveBeenCalled();
    expect(uiStore.getState().pivot).toEqual({
      selectedPivotId: null,
      editingPivotId: null,
    });
  });
});
