import { jest } from '@jest/globals';

import { setupSparklineSelectionCoordination } from '../sparkline-selection-coordination';

type SelectionState = {
  matches: (value: string) => boolean;
  context: { activeCell: { row: number; col: number } };
};

type SparklineLike = { id: string } | undefined;

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

function createMockUIStore(initialSheetId = 'sheet1', initialHasSparkline = false) {
  let state = {
    activeSheetId: initialSheetId,
    contextualTabs: { hasSparklineInActiveCell: initialHasSparkline },
    setHasSparklineInActiveCell: jest.fn((hasSparkline: boolean) => {
      state = {
        ...state,
        contextualTabs: { hasSparklineInActiveCell: hasSparkline },
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

function createMockSparklineManager(
  resolveSparklineAtCell: (sheetId: string, row: number, col: number) => SparklineLike,
) {
  return {
    getSparklineAtCell: jest.fn(resolveSparklineAtCell),
  };
}

function createCleanupManager() {
  return {
    register: jest.fn(),
  };
}

describe('Sparkline Selection Coordination', () => {
  it('evaluates the initial active cell during setup', () => {
    const selection = createMockSelectionActor(idleState(4, 2));
    const uiStore = createMockUIStore('sheet1', false);
    const sparklineManager = createMockSparklineManager((sheetId, row, col) =>
      sheetId === 'sheet1' && row === 4 && col === 2 ? { id: 'sparkline-1' } : undefined,
    );

    setupSparklineSelectionCoordination(
      {
        actors: { selection } as any,
        sparklineManager: sparklineManager as any,
        uiStoreApi: uiStore as any,
        getActiveSheetId: () => uiStore.getState().activeSheetId,
      },
      createCleanupManager() as any,
    );

    expect(uiStore.getState().setHasSparklineInActiveCell).toHaveBeenCalledWith(true);
    expect(uiStore.getState().contextualTabs.hasSparklineInActiveCell).toBe(true);
  });

  it('toggles when active-cell movement settles into and out of sparkline cells', () => {
    const selection = createMockSelectionActor(idleState(0, 0));
    const uiStore = createMockUIStore('sheet1', false);
    const sparklineManager = createMockSparklineManager((_sheetId, row, col) =>
      row === 2 && col === 3 ? { id: 'sparkline-1' } : undefined,
    );

    setupSparklineSelectionCoordination(
      {
        actors: { selection } as any,
        sparklineManager: sparklineManager as any,
        uiStoreApi: uiStore as any,
        getActiveSheetId: () => uiStore.getState().activeSheetId,
      },
      createCleanupManager() as any,
    );

    selection.emit(selectingState(2, 3));
    expect(uiStore.getState().setHasSparklineInActiveCell).not.toHaveBeenCalledWith(true);

    selection.emit(idleState(2, 3));
    expect(uiStore.getState().setHasSparklineInActiveCell).toHaveBeenCalledWith(true);

    selection.emit(idleState(5, 5));
    expect(uiStore.getState().setHasSparklineInActiveCell).toHaveBeenCalledWith(false);
  });

  it('refreshes unchanged active-cell topology changes without selection movement', () => {
    let sparklineAtActiveCell: SparklineLike;
    const selection = createMockSelectionActor(idleState(1, 1));
    const uiStore = createMockUIStore('sheet1', false);
    const sparklineManager = createMockSparklineManager(() => sparklineAtActiveCell);

    const result = setupSparklineSelectionCoordination(
      {
        actors: { selection } as any,
        sparklineManager: sparklineManager as any,
        uiStoreApi: uiStore as any,
        getActiveSheetId: () => uiStore.getState().activeSheetId,
      },
      createCleanupManager() as any,
    );

    expect(uiStore.getState().setHasSparklineInActiveCell).not.toHaveBeenCalled();

    sparklineAtActiveCell = { id: 'sparkline-1' };
    result.refresh();
    expect(uiStore.getState().setHasSparklineInActiveCell).toHaveBeenCalledWith(true);
    expect(uiStore.getState().contextualTabs.hasSparklineInActiveCell).toBe(true);

    sparklineAtActiveCell = undefined;
    result.refresh();
    expect(uiStore.getState().setHasSparklineInActiveCell).toHaveBeenCalledWith(false);
    expect(uiStore.getState().contextualTabs.hasSparklineInActiveCell).toBe(false);
  });

  it('refreshes when the active sheet changes without an active-cell coordinate change', () => {
    const selection = createMockSelectionActor(idleState(0, 0));
    const uiStore = createMockUIStore('sheet1', false);
    const sparklineManager = createMockSparklineManager((sheetId) =>
      sheetId === 'sheet2' ? { id: 'sheet2-sparkline' } : undefined,
    );

    setupSparklineSelectionCoordination(
      {
        actors: { selection } as any,
        sparklineManager: sparklineManager as any,
        uiStoreApi: uiStore as any,
        getActiveSheetId: () => uiStore.getState().activeSheetId,
      },
      createCleanupManager() as any,
    );

    uiStore.setActiveSheetId('sheet2');

    expect(uiStore.getState().setHasSparklineInActiveCell).toHaveBeenCalledWith(true);
  });
});
