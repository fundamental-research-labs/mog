import { jest } from '@jest/globals';

import { sheetId } from '@mog-sdk/contracts/core';
import {
  setupSheetSwitchCoordination,
  type OnSheetSwitchCallback,
  type SheetSwitchCoordinationConfig,
} from '../../subscriptions/sheet-switch-coordination';

type SheetSwitchListener = Parameters<OnSheetSwitchCallback>[0];

function createActorStubs() {
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
  const workbook = {
    getSheetById: jest.fn(() => ({
      view: { setScrollPosition },
    })),
    on: jest.fn(() => jest.fn()),
  };
  let listener: SheetSwitchListener | null = null;
  const topLeftCells = [...(options?.topLeftCells ?? [{ row: 5, col: 7 }])];
  const saveSheetViewState = jest.fn();
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
  });

  if (!listener) throw new Error('sheet switch listener was not registered');

  return {
    cleanup,
    listener,
    setScrollPosition,
    saveSheetViewState,
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
});
