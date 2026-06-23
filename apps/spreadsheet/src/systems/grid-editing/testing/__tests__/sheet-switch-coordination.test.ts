import { jest } from '@jest/globals';

import { sheetId } from '@mog-sdk/contracts/core';
import {
  setupSheetSwitchCoordination,
  type OnSheetSwitchCallback,
  type SheetSwitchCoordinationConfig,
} from '../../subscriptions/sheet-switch-coordination';

type SheetSwitchListener = Parameters<OnSheetSwitchCallback>[0];
type WorkbookListener = (event?: any) => void;

function createActorStubs(options?: { currentSheetId?: string | null }) {
  const selectionSnapshot = {
    context: {
      activeCell: { row: 0, col: 0 },
      anchor: null,
      anchorCol: null,
      anchorRow: null,
      pendingRange: { startRow: 0, startCol: 0, endRow: 0, endCol: 0 },
      committedRanges: [],
    },
  };
  const editorSnapshot = {
    context: { sheetId: null },
    matches: (state: string) => state === 'inactive',
  };

  return {
    editorActor: {
      getSnapshot: () => editorSnapshot,
      send: jest.fn(),
    },
    clipboardActor: {},
    rendererActor: {
      subscribe: jest.fn(() => ({ unsubscribe: jest.fn() })),
      getSnapshot: () => ({
        context: {
          currentSheetId: options?.currentSheetId ?? 'sheet-1',
        },
      }),
      send: jest.fn(),
    },
    selectionActor: {
      getSnapshot: () => selectionSnapshot,
      send: jest.fn(),
    },
  } as Pick<
    SheetSwitchCoordinationConfig,
    'editorActor' | 'clipboardActor' | 'rendererActor' | 'selectionActor'
  >;
}

function createHarness(options?: {
  durabilityPromise?: Promise<void>;
  topLeftCells?: Array<{ row: number; col: number }>;
}) {
  const setScrollPosition = jest.fn(async () => undefined);
  const workbookListeners = new Map<string, WorkbookListener[]>();
  const workbook = {
    getSheetById: jest.fn(() => ({
      view: { setScrollPosition },
    })),
    on: jest.fn((event: string, handler: WorkbookListener) => {
      const listeners = workbookListeners.get(event) ?? [];
      listeners.push(handler);
      workbookListeners.set(event, listeners);
      return jest.fn(() => {
        const nextListeners = workbookListeners.get(event)?.filter((listener) => listener !== handler);
        if (nextListeners) workbookListeners.set(event, nextListeners);
      });
    }),
  };
  let listener: SheetSwitchListener | null = null;
  const topLeftCells = [...(options?.topLeftCells ?? [{ row: 5, col: 7 }])];
  const saveSheetViewState = jest.fn();
  const refreshLayoutCallbacks = jest.fn();
  const onSheetSwitchComplete = jest.fn();
  const durabilityPromise = options?.durabilityPromise;
  const actors = createActorStubs();
  const cleanup = setupSheetSwitchCoordination({
    ...actors,
    workbook: workbook as unknown as SheetSwitchCoordinationConfig['workbook'],
    importDurability: durabilityPromise
      ? {
          isImportDurabilityPending: true,
          scheduleDeferredHydration: jest.fn(() => durabilityPromise),
          awaitImportDurability: jest.fn(() => durabilityPromise),
        }
      : undefined,
    onSheetSwitch: (callback) => {
      listener = callback;
      return jest.fn();
    },
    getEditingSheetId: () => null,
    saveSheetViewState,
    getScrollPosition: () => ({ x: 100, y: 200 }),
    getTopLeftCell: () => topLeftCells.shift() ?? { row: 0, col: 0 },
    refreshLayoutCallbacks,
    onSheetSwitchComplete,
  });

  if (!listener) throw new Error('sheet switch listener was not registered');

  return {
    cleanup,
    listener,
    emitWorkbookEvent: (event: string, payload?: any) => {
      for (const handler of workbookListeners.get(event) ?? []) {
        handler(payload);
      }
    },
    actors,
    setScrollPosition,
    saveSheetViewState,
    refreshLayoutCallbacks,
    onSheetSwitchComplete,
  };
}

describe('setupSheetSwitchCoordination import durability', () => {
  it('defers Rust scroll-position persistence until import durability resolves', async () => {
    let resolveDurability!: () => void;
    const durabilityPromise = new Promise<void>((resolve) => {
      resolveDurability = resolve;
    });
    const harness = createHarness({ durabilityPromise });

    harness.listener(sheetId('sheet-2'), sheetId('sheet-1'));

    expect(harness.saveSheetViewState).toHaveBeenCalledWith(
      sheetId('sheet-1'),
      expect.objectContaining({ scrollTop: 200, scrollLeft: 100 }),
    );
    expect(harness.setScrollPosition).not.toHaveBeenCalled();

    resolveDurability();
    await durabilityPromise;
    await Promise.resolve();

    expect(harness.setScrollPosition).toHaveBeenCalledTimes(1);
    expect(harness.setScrollPosition).toHaveBeenCalledWith(5, 7);
    harness.cleanup();
  });

  it('coalesces deferred scroll persistence to the latest position per sheet', async () => {
    let resolveDurability!: () => void;
    const durabilityPromise = new Promise<void>((resolve) => {
      resolveDurability = resolve;
    });
    const previousSheet = sheetId('sheet-1');
    const harness = createHarness({
      durabilityPromise,
      topLeftCells: [
        { row: 5, col: 7 },
        { row: 8, col: 9 },
      ],
    });

    harness.listener(sheetId('sheet-2'), previousSheet);
    harness.listener(sheetId('sheet-3'), previousSheet);
    expect(harness.setScrollPosition).not.toHaveBeenCalled();

    resolveDurability();
    await durabilityPromise;
    await Promise.resolve();

    expect(harness.setScrollPosition).toHaveBeenCalledTimes(1);
    expect(harness.setScrollPosition).toHaveBeenCalledWith(8, 9);
    harness.cleanup();
  });

  it('refreshes active-sheet coordination after a same-sheet checkout materializes', () => {
    const harness = createHarness();

    harness.emitWorkbookEvent('workbook:version-checkout-materialized');

    expect(harness.refreshLayoutCallbacks).toHaveBeenCalledTimes(1);
    expect(harness.actors.selectionActor.send).toHaveBeenCalledWith({
      type: 'SET_SELECTION',
      ranges: [{ startRow: 0, startCol: 0, endRow: 0, endCol: 0 }],
      activeCell: { row: 0, col: 0 },
      anchor: null,
      anchorCol: null,
      anchorRow: null,
      source: 'restore',
    });
    expect(harness.onSheetSwitchComplete).toHaveBeenCalledTimes(1);
    expect(harness.actors.rendererActor.send).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'SWITCH_SHEET' }),
    );
    harness.cleanup();
  });
});
