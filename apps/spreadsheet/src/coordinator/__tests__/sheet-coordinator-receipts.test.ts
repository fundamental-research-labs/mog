import { jest } from '@jest/globals';

import type { MutationReceipt } from '@mog-sdk/contracts/api/mutation-receipt';
import type { FloatingObject } from '@mog-sdk/contracts/floating-objects';
import type { ISheetViewObjects } from '@mog-sdk/sheet-view';
import type {
  FloatingObjectBounds,
  FloatingObjectCache,
  FloatingObjectCacheState,
} from '../../cache/floating-object-cache';
import {
  processCoordinatorReceipts,
  type ReceiptProcessingCoordinator,
} from '../receipt-processing';

const bounds = (x: number, y: number) => ({
  x,
  y,
  width: 120,
  height: 80,
  rotation: 0,
});

const shape = (id: string, sheetId = 'sheet-1'): FloatingObject =>
  ({
    id,
    type: 'shape',
    shapeType: 'rect',
    sheetId,
    containerId: sheetId,
    position: { type: 'absolute', x: 0, y: 0, width: 120, height: 80 },
    anchor: { type: 'absolute', x: 0, y: 0, width: 120, height: 80 },
  }) as FloatingObject;

function createReceiptTestCache(): FloatingObjectCache {
  let state: FloatingObjectCacheState;

  const applyBatch = (
    updates: FloatingObject[],
    deleteIds: string[],
    boundsUpdates?: Map<string, FloatingObjectBounds>,
  ): void => {
    const objects = new Map(state.objects);
    const boundsByObject = new Map(state.bounds);

    for (const id of deleteIds) {
      objects.delete(id);
      boundsByObject.delete(id);
    }

    for (const obj of updates) {
      objects.set(obj.id, obj);
    }

    if (boundsUpdates) {
      for (const [id, objectBounds] of boundsUpdates) {
        boundsByObject.set(id, objectBounds);
      }
    }

    state = {
      ...state,
      objects,
      bounds: boundsByObject,
    };
  };

  state = {
    objects: new Map(),
    objectsBySheet: new Map(),
    bounds: new Map(),
    setObject: jest.fn(),
    removeObject: jest.fn(),
    applyBatch,
    setObjectsForSheet: jest.fn(),
    clear: jest.fn(),
  };

  return {
    getState: () => state,
  } as FloatingObjectCache;
}

describe('SheetCoordinator.processReceipts', () => {
  it('applies floating-object receipts to the cache and renderer while ignoring unrelated receipts', () => {
    const floatingObjectCache = createReceiptTestCache();
    const existing = shape('shape-existing');
    const removed = shape('shape-removed');
    const created = shape('shape-created');
    const updated = shape('shape-existing');

    floatingObjectCache.getState().applyBatch(
      [existing, removed],
      [],
      new Map([
        [existing.id, bounds(10, 20)],
        [removed.id, bounds(30, 40)],
      ]),
    );

    const applyPatches = jest.fn();
    const coordinator: ReceiptProcessingCoordinator = {
      floatingObjectCache,
      renderer: {
        getObjects: jest.fn(() => ({ applyPatches }) as unknown as ISheetViewObjects),
      },
    };

    const receipts: MutationReceipt[] = [
      {
        domain: 'floatingObject',
        action: 'create',
        id: created.id,
        object: created,
        bounds: bounds(50, 60),
      },
      {
        kind: 'pivotRefresh',
        pivotId: 'pivot-ignored',
      },
      {
        domain: 'floatingObject',
        action: 'update',
        id: updated.id,
        object: updated,
        bounds: bounds(70, 80),
      },
      {
        domain: 'floatingObject',
        action: 'remove',
        id: removed.id,
      },
    ];

    processCoordinatorReceipts(coordinator, receipts);

    const state = floatingObjectCache.getState();
    expect(state.objects.get(created.id)).toBe(created);
    expect(state.objects.get(updated.id)).toBe(updated);
    expect(state.objects.has(removed.id)).toBe(false);
    expect(state.bounds.get(created.id)).toEqual(bounds(50, 60));
    expect(state.bounds.get(updated.id)).toEqual(bounds(70, 80));
    expect(state.bounds.has(removed.id)).toBe(false);

    expect(applyPatches).toHaveBeenCalledTimes(1);
    expect(applyPatches).toHaveBeenCalledWith([
      {
        objectId: created.id,
        kind: 'created',
        data: created,
        bounds: bounds(50, 60),
      },
      {
        objectId: updated.id,
        kind: 'updated',
        data: updated,
        bounds: bounds(70, 80),
      },
      {
        objectId: removed.id,
        kind: 'remove',
      },
    ]);
  });
});
