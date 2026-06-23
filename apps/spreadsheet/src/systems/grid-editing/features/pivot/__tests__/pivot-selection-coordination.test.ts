import { jest } from '@jest/globals';
import { setupPivotSelectionCoordination } from '../pivot-selection-coordination';

type SelectionState = {
  matches: (value: string) => boolean;
  context: {
    activeCell: { row: number; col: number };
    pendingRange?: { startRow: number; startCol: number; endRow: number; endCol: number };
  };
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

function idleRangeState(
  row: number,
  col: number,
  pendingRange: { startRow: number; startCol: number; endRow: number; endCol: number },
): SelectionState {
  return {
    matches: (value: string) => value === 'idle',
    context: { activeCell: { row, col }, pendingRange },
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
      openTransientOverlay: null as unknown,
    },
    selectPivot: jest.fn((pivotId: string | null) => {
      state = {
        ...state,
        pivot: {
          ...state.pivot,
          selectedPivotId: pivotId,
          editingPivotId:
            pivotId == null ||
            (state.pivot.editingPivotId != null && state.pivot.editingPivotId !== pivotId)
              ? null
              : state.pivot.editingPivotId,
          openTransientOverlay: null,
        },
      };
    }),
    startEditingPivot: jest.fn((pivotId: string) => {
      state = {
        ...state,
        pivot: {
          selectedPivotId: pivotId,
          editingPivotId: pivotId,
          ...(state.pivot.fieldPanelSuppressedPivotId !== undefined
            ? { fieldPanelSuppressedPivotId: null }
            : {}),
          openTransientOverlay: null,
        },
      };
    }),
    stopEditingPivot: jest.fn(() => {
      state = {
        ...state,
        pivot: {
          ...state.pivot,
          editingPivotId: null,
          fieldPanelSuppressedPivotId: state.pivot.editingPivotId ?? state.pivot.selectedPivotId,
        },
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
      openTransientOverlay: null,
    });
  });

  it('opens editable pivot fields over imported metadata when both contain the active cell', async () => {
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
    expect(uiStore.getState().selectPivot).not.toHaveBeenCalled();
    expect(workbook.getImportedViewRecords).not.toHaveBeenCalled();
    expect(uiStore.getState().pivot).toEqual({
      selectedPivotId: 'pivot-1',
      editingPivotId: 'pivot-1',
      openTransientOverlay: null,
    });
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
    expect(uiStore.getState().stopEditingPivot).not.toHaveBeenCalled();
    expect(uiStore.getState().pivot).toEqual({
      selectedPivotId: null,
      editingPivotId: null,
      openTransientOverlay: null,
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
      openTransientOverlay: null,
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
    expect(uiStore.getState().selectPivot).not.toHaveBeenCalled();
    expect(uiStore.getState().pivot).toEqual({
      selectedPivotId: 'pivot-imported-native',
      editingPivotId: 'pivot-imported-native',
      openTransientOverlay: null,
    });
  });

  it('reopens the field panel when selection remains inside a selected pivot', async () => {
    const selection = createMockSelectionActor(idleState(1, 1));
    const uiStore = createMockUIStore('sheet1');
    uiStore.getState().selectPivot('pivot-1');
    const workbook = createMockWorkbook({
      editablePivots: [{ id: 'pivot-1', name: 'PivotTable1', refRange: 'A1:D4' }],
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

    selection.emit(idleState(2, 2));
    await flushAsyncRefreshes();

    expect(uiStore.getState().selectPivot).toHaveBeenCalledWith('pivot-1');
    expect(uiStore.getState().selectPivot).toHaveBeenCalledTimes(1);
    expect(uiStore.getState().startEditingPivot).toHaveBeenCalledWith('pivot-1');
    expect(uiStore.getState().pivot).toEqual({
      selectedPivotId: 'pivot-1',
      editingPivotId: 'pivot-1',
      openTransientOverlay: null,
    });
  });

  it('preserves editing when passive selection remains inside the edited pivot', async () => {
    const selection = createMockSelectionActor(idleState(1, 1));
    const uiStore = createMockUIStore('sheet1');
    uiStore.getState().startEditingPivot('pivot-1');
    const workbook = createMockWorkbook({
      editablePivots: [{ id: 'pivot-1', name: 'PivotTable1', refRange: 'A1:D4' }],
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

    selection.emit(idleState(2, 2));
    await flushAsyncRefreshes();

    expect(uiStore.getState().startEditingPivot).toHaveBeenCalledTimes(1);
    expect(uiStore.getState().pivot).toEqual({
      selectedPivotId: 'pivot-1',
      editingPivotId: 'pivot-1',
      openTransientOverlay: null,
    });
  });

  it('opens the field panel when selection moves from edited pivot A to pivot B', async () => {
    const selection = createMockSelectionActor(idleState(1, 1));
    const uiStore = createMockUIStore('sheet1');
    uiStore.getState().startEditingPivot('pivot-a');
    const workbook = createMockWorkbook({
      editablePivots: [
        { id: 'pivot-a', name: 'PivotTableA', refRange: 'A1:D4' },
        { id: 'pivot-b', name: 'PivotTableB', refRange: 'F1:H4' },
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

    selection.emit(idleState(1, 6));
    await flushAsyncRefreshes();

    expect(uiStore.getState().startEditingPivot).toHaveBeenCalledWith('pivot-b');
    expect(uiStore.getState().pivot).toEqual({
      selectedPivotId: 'pivot-b',
      editingPivotId: 'pivot-b',
      openTransientOverlay: null,
    });
  });

  it('keeps the field panel closed after explicit close and passive same-pivot click', async () => {
    const selection = createMockSelectionActor(idleState(1, 1));
    const uiStore = createMockUIStore('sheet1');
    uiStore.getState().startEditingPivot('pivot-1');
    uiStore.getState().stopEditingPivot();
    uiStore.getState().startEditingPivot.mockClear();
    const workbook = createMockWorkbook({
      editablePivots: [{ id: 'pivot-1', name: 'PivotTable1', refRange: 'A1:D4' }],
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

    selection.emit(idleState(2, 2));
    await flushAsyncRefreshes();

    expect(uiStore.getState().startEditingPivot).not.toHaveBeenCalled();
    expect(uiStore.getState().pivot).toEqual({
      selectedPivotId: 'pivot-1',
      editingPivotId: null,
      fieldPanelSuppressedPivotId: 'pivot-1',
      openTransientOverlay: null,
    });
  });

  it('reopens a suppressed field panel for range selection inside the same pivot', async () => {
    const selection = createMockSelectionActor(idleState(1, 1));
    const uiStore = createMockUIStore('sheet1');
    uiStore.getState().startEditingPivot('pivot-1');
    uiStore.getState().stopEditingPivot();
    uiStore.getState().startEditingPivot.mockClear();
    const workbook = createMockWorkbook({
      editablePivots: [{ id: 'pivot-1', name: 'PivotTable1', refRange: 'A1:D4' }],
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

    selection.emit(idleRangeState(1, 1, { startRow: 1, startCol: 1, endRow: 3, endCol: 1 }));
    await flushAsyncRefreshes();

    expect(uiStore.getState().startEditingPivot).toHaveBeenCalledWith('pivot-1');
    expect(uiStore.getState().pivot).toEqual({
      selectedPivotId: 'pivot-1',
      editingPivotId: 'pivot-1',
      fieldPanelSuppressedPivotId: null,
      openTransientOverlay: null,
    });
  });
});
