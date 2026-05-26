import { jest } from '@jest/globals';
import { setupTableSelectionCoordination } from '../table-selection-coordination';

type SelectionState = {
  matches: (value: string) => boolean;
  context: { activeCell: { row: number; col: number } };
};

type TableInfoLike = { name: string } | null;

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

function createMockUIStore(
  initialSheetId = 'sheet1',
  initialSelectedTableId: string | null = null,
) {
  let state = {
    activeSheetId: initialSheetId,
    tableDesign: { selectedTableId: initialSelectedTableId },
    setSelectedTable: jest.fn((tableId: string | null) => {
      state = {
        ...state,
        tableDesign: { selectedTableId: tableId },
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

function createMockWorkbook(resolveTableAtCell: (row: number, col: number) => TableInfoLike) {
  const handlers = new Map<string, Array<(event: unknown) => void>>();
  const getAtCell = jest.fn(async (row: number, col: number) => resolveTableAtCell(row, col));

  return {
    getSheetById: jest.fn(() => ({ tables: { getAtCell } })),
    on: jest.fn((eventName: string, handler: (event: unknown) => void) => {
      const eventHandlers = handlers.get(eventName) ?? [];
      eventHandlers.push(handler);
      handlers.set(eventName, eventHandlers);

      const unsubscribe = (() => {
        const current = handlers.get(eventName) ?? [];
        const idx = current.indexOf(handler);
        if (idx >= 0) current.splice(idx, 1);
      }) as (() => void) & { dispose: () => void; [Symbol.dispose]: () => void };
      unsubscribe.dispose = unsubscribe;
      unsubscribe[Symbol.dispose] = unsubscribe;
      return unsubscribe;
    }),
    emit: (event: { type: string; sheetId?: string }) => {
      for (const handler of handlers.get(event.type) ?? []) handler(event);
    },
    getAtCell,
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
}

describe('Table Selection Coordination', () => {
  it('refreshes selectedTableId when a table is created around the unchanged active cell', async () => {
    let tableAtActiveCell: TableInfoLike = null;
    const selection = createMockSelectionActor(idleState(0, 0));
    const uiStore = createMockUIStore('sheet1', null);
    const workbook = createMockWorkbook(() => tableAtActiveCell);

    setupTableSelectionCoordination(
      {
        actors: { selection } as any,
        uiStoreApi: uiStore as any,
        getActiveSheetId: () => uiStore.getState().activeSheetId,
        workbook: workbook as any,
      },
      createCleanupManager() as any,
    );

    await flushAsyncRefreshes();
    expect(uiStore.getState().setSelectedTable).not.toHaveBeenCalled();

    tableAtActiveCell = { name: 'Table1' };
    workbook.emit({ type: 'table:created', sheetId: 'sheet1' });
    await flushAsyncRefreshes();

    expect(uiStore.getState().setSelectedTable).toHaveBeenCalledWith('Table1');
    expect(uiStore.getState().tableDesign.selectedTableId).toBe('Table1');
  });

  it('clears selectedTableId when the active table is deleted without moving selection', async () => {
    let tableAtActiveCell: TableInfoLike = { name: 'Table1' };
    const selection = createMockSelectionActor(idleState(0, 0));
    const uiStore = createMockUIStore('sheet1', 'Table1');
    const workbook = createMockWorkbook(() => tableAtActiveCell);

    setupTableSelectionCoordination(
      {
        actors: { selection } as any,
        uiStoreApi: uiStore as any,
        getActiveSheetId: () => uiStore.getState().activeSheetId,
        workbook: workbook as any,
      },
      createCleanupManager() as any,
    );

    await flushAsyncRefreshes();
    expect(uiStore.getState().setSelectedTable).not.toHaveBeenCalled();

    tableAtActiveCell = null;
    workbook.emit({ type: 'table:deleted', sheetId: 'sheet1' });
    await flushAsyncRefreshes();

    expect(uiStore.getState().setSelectedTable).toHaveBeenCalledWith(null);
    expect(uiStore.getState().tableDesign.selectedTableId).toBeNull();
  });

  it('ignores table topology events for inactive sheets', async () => {
    let tableAtActiveCell: TableInfoLike = null;
    const selection = createMockSelectionActor(idleState(0, 0));
    const uiStore = createMockUIStore('sheet1', null);
    const workbook = createMockWorkbook(() => tableAtActiveCell);

    setupTableSelectionCoordination(
      {
        actors: { selection } as any,
        uiStoreApi: uiStore as any,
        getActiveSheetId: () => uiStore.getState().activeSheetId,
        workbook: workbook as any,
      },
      createCleanupManager() as any,
    );

    await flushAsyncRefreshes();
    tableAtActiveCell = { name: 'TableOnSheet1' };
    workbook.emit({ type: 'table:created', sheetId: 'sheet2' });
    await flushAsyncRefreshes();

    expect(uiStore.getState().setSelectedTable).not.toHaveBeenCalled();
    expect(uiStore.getState().tableDesign.selectedTableId).toBeNull();
  });

  it('still refreshes only when active-cell movement settles to idle', async () => {
    const selection = createMockSelectionActor(idleState(0, 0));
    const uiStore = createMockUIStore('sheet1', null);
    const workbook = createMockWorkbook((row, col) =>
      row === 2 && col === 3 ? { name: 'Table2' } : null,
    );

    setupTableSelectionCoordination(
      {
        actors: { selection } as any,
        uiStoreApi: uiStore as any,
        getActiveSheetId: () => uiStore.getState().activeSheetId,
        workbook: workbook as any,
      },
      createCleanupManager() as any,
    );

    await flushAsyncRefreshes();
    selection.emit(selectingState(2, 3));
    await flushAsyncRefreshes();
    expect(uiStore.getState().setSelectedTable).not.toHaveBeenCalled();

    selection.emit(idleState(2, 3));
    await flushAsyncRefreshes();
    expect(uiStore.getState().setSelectedTable).toHaveBeenCalledWith('Table2');
  });

  it('refreshes when the active sheet changes without an active-cell coordinate change', async () => {
    const selection = createMockSelectionActor(idleState(0, 0));
    const uiStore = createMockUIStore('sheet1', null);
    const workbook = createMockWorkbook(() =>
      uiStore.getState().activeSheetId === 'sheet2' ? { name: 'Sheet2Table' } : null,
    );

    setupTableSelectionCoordination(
      {
        actors: { selection } as any,
        uiStoreApi: uiStore as any,
        getActiveSheetId: () => uiStore.getState().activeSheetId,
        workbook: workbook as any,
      },
      createCleanupManager() as any,
    );

    await flushAsyncRefreshes();
    uiStore.setActiveSheetId('sheet2');
    await flushAsyncRefreshes();

    expect(uiStore.getState().setSelectedTable).toHaveBeenCalledWith('Sheet2Table');
  });
});
