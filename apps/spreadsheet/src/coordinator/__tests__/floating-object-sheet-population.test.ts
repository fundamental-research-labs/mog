import { jest } from '@jest/globals';

import type { FloatingObject } from '@mog-sdk/contracts/floating-objects';

import { setupFloatingObjectSheetPopulation } from '../floating-object-sheet-population';
import type { FloatingObjectSheetPopulationConfig } from '../floating-object-sheet-population';

type SheetSwitchListener = (
  state: { activeSheetId: string },
  prevState: { activeSheetId: string },
) => void;

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function makeObject(id: string, sheetId: string): FloatingObject {
  return {
    id,
    type: 'shape',
    shapeType: 'rect',
    sheetId,
    containerId: sheetId,
    zIndex: 0,
  } as FloatingObject;
}

function createHarness(options?: { activeSheetId?: string; durabilityPromise?: Promise<void> }) {
  let listener: SheetSwitchListener | null = null;
  let activeSheetId = options?.activeSheetId ?? 'sheet-1';

  const uiStore = {
    subscribe: jest.fn((callback: SheetSwitchListener) => {
      listener = callback;
      return jest.fn();
    }),
  };
  const objects = [makeObject('shape-1', 'sheet-2')];
  const bounds = new Map([['shape-1', { x: 1, y: 2, width: 3, height: 4, rotation: 0 }]]);
  const floatingObjects = {
    getObjectsInSheet: jest.fn(async () => objects),
    computeAllObjectBounds: jest.fn(async () => bounds),
  };
  const setObjectsForSheet = jest.fn();
  const floatingObjectCache = {
    getState: () => ({ setObjectsForSheet }),
  };
  const resyncScene = jest.fn();
  const awaitImportDurability = jest.fn(() => options?.durabilityPromise ?? Promise.resolve());
  const scheduleDeferredHydration = jest.fn(() => options?.durabilityPromise ?? Promise.resolve());

  const cleanup = setupFloatingObjectSheetPopulation({
    uiStore,
    floatingObjects,
    floatingObjectCache,
    getRendererObjects: () => ({ resyncScene }),
    getActiveSheetId: () => activeSheetId,
    importDurability: {
      isImportDurabilityPending: !!options?.durabilityPromise,
      scheduleDeferredHydration,
      awaitImportDurability,
    },
    isDisposed: () => false,
    getGeneration: () => 0,
    scheduleSceneResync: (callback) => callback(),
  } as unknown as FloatingObjectSheetPopulationConfig);

  if (!listener) throw new Error('sheet population listener was not registered');

  return {
    cleanup,
    listener,
    setActiveSheetId: (sheetId: string) => {
      activeSheetId = sheetId;
    },
    awaitImportDurability,
    scheduleDeferredHydration,
    floatingObjects,
    setObjectsForSheet,
    resyncScene,
    objects,
    bounds,
  };
}

describe('setupFloatingObjectSheetPopulation', () => {
  it('waits for scheduled import hydration before populating a switched sheet', async () => {
    const gate = deferred();
    const harness = createHarness({ activeSheetId: 'sheet-2', durabilityPromise: gate.promise });

    harness.listener({ activeSheetId: 'sheet-2' }, { activeSheetId: 'sheet-1' });
    await Promise.resolve();

    expect(harness.scheduleDeferredHydration).toHaveBeenCalledTimes(1);
    expect(harness.awaitImportDurability).not.toHaveBeenCalled();
    expect(harness.floatingObjects.getObjectsInSheet).not.toHaveBeenCalled();
    expect(harness.setObjectsForSheet).not.toHaveBeenCalled();
    expect(harness.resyncScene).not.toHaveBeenCalled();

    gate.resolve();
    await gate.promise;
    await Promise.resolve();
    await Promise.resolve();

    expect(harness.floatingObjects.getObjectsInSheet).toHaveBeenCalledWith('sheet-2');
    expect(harness.floatingObjects.computeAllObjectBounds).toHaveBeenCalledWith('sheet-2');
    expect(harness.setObjectsForSheet).toHaveBeenCalledWith(
      'sheet-2',
      harness.objects,
      harness.bounds,
    );
    expect(harness.resyncScene).toHaveBeenCalledWith({ force: true, sheetId: 'sheet-2' });

    harness.cleanup();
  });

  it('drops stale population when the active sheet changes while awaiting durability', async () => {
    const gate = deferred();
    const harness = createHarness({ activeSheetId: 'sheet-2', durabilityPromise: gate.promise });

    harness.listener({ activeSheetId: 'sheet-2' }, { activeSheetId: 'sheet-1' });
    harness.setActiveSheetId('sheet-3');

    gate.resolve();
    await gate.promise;
    await Promise.resolve();
    await Promise.resolve();

    expect(harness.floatingObjects.getObjectsInSheet).not.toHaveBeenCalled();
    expect(harness.setObjectsForSheet).not.toHaveBeenCalled();
    expect(harness.resyncScene).not.toHaveBeenCalled();

    harness.cleanup();
  });
});
