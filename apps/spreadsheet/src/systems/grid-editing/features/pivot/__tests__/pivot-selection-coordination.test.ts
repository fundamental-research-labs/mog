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
  editablePivots?:
    | Array<{ id: string; name: string; refRange?: string }>
    | (() => Array<{ id: string; name: string; refRange?: string }>);
  editableThrows?: boolean;
  importedRecords?: Array<{
    sourceKind: 'unsupportedImport' | 'promotedImport';
    importIdentity?: string;
    config: { id: string; outputLocation: { row: number; col: number }; refRange?: string };
    renderedRange?: { startRow: number; startCol: number; endRow: number; endCol: number };
  }>;
  sidecarPivot?: {
    id: string;
    importIdentity: string;
    range: { startRow: number; startCol: number; endRow: number; endCol: number };
  } | null;
}) {
  const getAll = jest.fn(async () => {
    if (options.editableThrows) {
      throw new Error('editable pivot API unavailable');
    }
    return typeof options.editablePivots === 'function'
      ? options.editablePivots()
      : (options.editablePivots ?? []);
  });
  const get = jest.fn(async () => ({
    getRange: jest.fn(async () => null),
  }));
  const getImportedViewRecords = jest.fn(async () => options.importedRecords ?? []);

  return {
    getSheetById: jest.fn(() => ({ pivots: { getAll, get, getImportedViewRecords } })),
    importedPivots: {
      findRenderedImportedPivotAt: jest.fn(async (_sheetId: string, row: number, col: number) => {
        const sidecarPivot = options.sidecarPivot;
        if (!sidecarPivot) return null;
        return row >= sidecarPivot.range.startRow &&
          row <= sidecarPivot.range.endRow &&
          col >= sidecarPivot.range.startCol &&
          col <= sidecarPivot.range.endCol
          ? sidecarPivot
          : null;
      }),
    },
    pivot: { getImportedPivotViewRecords: getImportedViewRecords },
    getAll,
    get,
    getImportedViewRecords,
  };
}

function createCleanupManager() {
  return {
    register: jest.fn(),
  };
}

async function flushAsyncRefreshes() {
  for (let i = 0; i < 50; i++) {
    await Promise.resolve();
  }
  await new Promise((resolve) => setTimeout(resolve, 0));
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
}

describe('Pivot Selection Coordination', () => {
  it('falls back to imported pivot hit testing when editable pivot lookup fails', async () => {
    const selection = createMockSelectionActor(idleState(0, 0));
    const uiStore = createMockUIStore('sheet1');
    const workbook = createMockWorkbook({
      editableThrows: true,
      importedRecords: [
        {
          sourceKind: 'unsupportedImport',
          importIdentity: 'identity-1',
          config: {
            id: 'imported:Pivot:xl/pivotTables/pivotTable1.xml',
            outputLocation: { row: 1, col: 1 },
          },
          renderedRange: { startRow: 1, startCol: 1, endRow: 1, endCol: 1 },
        },
      ],
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

    expect(workbook.getImportedViewRecords).toHaveBeenCalled();
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
      importedRecords: [
        {
          sourceKind: 'unsupportedImport',
          importIdentity: 'identity-1',
          config: {
            id: 'imported:Pivot:xl/pivotTables/pivotTable1.xml',
            outputLocation: { row: 1, col: 1 },
          },
          renderedRange: { startRow: 1, startCol: 1, endRow: 1, endCol: 1 },
        },
      ],
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
    expect(workbook.getImportedViewRecords).not.toHaveBeenCalled();
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

  it('does not let stale raw sidecar metadata steal selection from persisted imports', async () => {
    const selection = createMockSelectionActor(idleState(0, 0));
    const uiStore = createMockUIStore('sheet1');
    const workbook = createMockWorkbook({
      importedRecords: [
        {
          sourceKind: 'unsupportedImport',
          importIdentity: 'identity-1',
          config: {
            id: 'imported:persisted',
            outputLocation: { row: 1, col: 1 },
          },
          renderedRange: { startRow: 1, startCol: 1, endRow: 1, endCol: 1 },
        },
      ],
      sidecarPivot: {
        id: 'imported:stale-sidecar',
        importIdentity: 'identity-1',
        range: { startRow: 5, startCol: 5, endRow: 5, endCol: 5 },
      },
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

    selection.emit(idleState(5, 5));
    await flushAsyncRefreshes();

    expect(uiStore.getState().startEditingPivot).not.toHaveBeenCalled();
    expect(uiStore.getState().pivot).toEqual({
      selectedPivotId: null,
      editingPivotId: null,
    });
  });

  it('materializes deferred imported pivots before selecting a raw sidecar id', async () => {
    const selection = createMockSelectionActor(idleState(0, 0));
    const uiStore = createMockUIStore('sheet1');
    let materialized = false;
    const workbook = createMockWorkbook({
      editablePivots: () =>
        materialized
          ? [{ id: 'pivot-imported-native', name: 'PivotTable1', refRange: 'B2:D4' }]
          : [],
      sidecarPivot: {
        id: 'imported:Pivot:xl/pivotTables/pivotTable1.xml',
        importIdentity: 'identity-1',
        range: { startRow: 1, startCol: 1, endRow: 3, endCol: 3 },
      },
    });
    const importDurability = {
      get isImportDurabilityPending() {
        return !materialized;
      },
      awaitImportDurability: jest.fn(async () => {
        materialized = true;
      }),
    };

    setupPivotSelectionCoordination(
      {
        actors: { selection } as any,
        uiStoreApi: uiStore as any,
        getActiveSheetId: () => uiStore.getState().activeSheetId,
        workbook: workbook as any,
        importDurability,
      },
      createCleanupManager() as any,
    );

    selection.emit(idleState(1, 1));
    await flushAsyncRefreshes();

    expect(importDurability.awaitImportDurability).toHaveBeenCalledTimes(1);
    expect(uiStore.getState().startEditingPivot).toHaveBeenCalledWith('pivot-imported-native');
    expect(uiStore.getState().pivot).toEqual({
      selectedPivotId: 'pivot-imported-native',
      editingPivotId: 'pivot-imported-native',
    });
  });
});
