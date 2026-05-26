import {
  isFloatingObjectMutationReceipt,
  isFloatingObjectRemoveReceipt,
  type MutationReceipt,
} from '@mog-sdk/contracts/api/mutation-receipt';
import type { FloatingObject } from '@mog-sdk/contracts/floating-objects';
import type { FloatingObjectPatch } from '@mog-sdk/contracts/rendering';
import type { ISheetViewObjects } from '@mog-sdk/sheet-view';

import type { FloatingObjectCache } from '../cache/floating-object-cache';

export interface ReceiptProcessingCoordinator {
  readonly floatingObjectCache: FloatingObjectCache | null;
  readonly renderer: {
    getObjects(): ISheetViewObjects | null;
  };
}

export function processCoordinatorReceipts(
  coordinator: ReceiptProcessingCoordinator,
  receipts: MutationReceipt[],
): void {
  const store = coordinator.floatingObjectCache;
  if (!store) return;

  const patches: FloatingObjectPatch[] = [];
  const objectsToSet: FloatingObject[] = [];
  const idsToDelete: string[] = [];
  const boundsMap = new Map<
    string,
    { x: number; y: number; width: number; height: number; rotation: number }
  >();

  for (const receipt of receipts) {
    if (isFloatingObjectRemoveReceipt(receipt)) {
      idsToDelete.push(receipt.id);
      patches.push({ objectId: receipt.id, kind: 'remove' });
      continue;
    }

    if (!isFloatingObjectMutationReceipt(receipt)) {
      continue;
    }

    const existingObjects = store.getState().objects;
    const kind = existingObjects.has(receipt.id) ? 'updated' : 'created';
    objectsToSet.push(receipt.object);
    boundsMap.set(receipt.id, receipt.bounds);
    patches.push({
      objectId: receipt.id,
      kind,
      data: receipt.object,
      bounds: receipt.bounds,
    });
  }

  if (objectsToSet.length > 0 || idsToDelete.length > 0) {
    store
      .getState()
      .applyBatch(objectsToSet, idsToDelete, boundsMap.size > 0 ? boundsMap : undefined);
  }

  if (patches.length > 0) {
    coordinator.renderer.getObjects()?.applyPatches(patches);
  }
}
