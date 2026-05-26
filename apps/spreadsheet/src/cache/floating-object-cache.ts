/**
 * Floating Object Cache
 *
 * Reactive Zustand cache for floating objects (pictures, shapes, text boxes, charts, etc.).
 * This is a per-document cache that provides fast, synchronous reads for React components.
 *
 * **This is a read cache of Rust ground truth, not an owned store.**
 * Writes go through the kernel (ComputeBridge → Rust), and this cache is kept in sync
 * via event-driven invalidation wired in SheetCoordinator. App code should never
 * write to this cache directly — only the SheetCoordinator's sync flush does that.
 *
 * The cache is populated from SpreadsheetObjectManager and kept in sync via
 * canvasObject:* event subscriptions wired in SheetCoordinator:
 * - created/updated: single-object fetch → setObject()
 * - deleted: removeObject()
 * - initial population: getObjectsInSheet() → setObjectsForSheet()
 *
 * Granular per-object updates preserve structural sharing — only the changed
 * object's Map entry is replaced, keeping all other references stable. This
 * ensures that Zustand selectors for unrelated objects/sheets don't re-render.
 *
 * of floating objects kernel async purification.
 */

import { create, type StoreApi } from 'zustand';

import type { FloatingObject } from '@mog-sdk/contracts/floating-objects';

// =============================================================================
// Cache Types
// =============================================================================

/** Pre-computed pixel bounds from Rust (position + size + rotation). */
export interface FloatingObjectBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}

export interface FloatingObjectCacheState {
  /** All floating objects indexed by objectId */
  objects: Map<string, FloatingObject>;
  /** Index: sheetId -> Set of objectIds in that sheet */
  objectsBySheet: Map<string, Set<string>>;
  /** Pre-computed pixel bounds indexed by objectId (optional, from Rust mutation results) */
  bounds: Map<string, FloatingObjectBounds>;

  /** Upsert a single object into the cache */
  setObject(obj: FloatingObject, objBounds?: FloatingObjectBounds): void;
  /** Remove a single object from the cache */
  removeObject(id: string): void;
  /**
   * Atomic batch update: upsert multiple objects and remove multiple objects
   * in a single state transition. Used by the coalescing flush in
   * SheetCoordinator to apply all pending event updates at once, triggering
   * exactly one Zustand notification instead of N.
   */
  applyBatch(
    updates: FloatingObject[],
    deleteIds: string[],
    boundsUpdates?: Map<string, FloatingObjectBounds>,
  ): void;
  /** Bulk-set all objects and their render bounds for a sheet (used during initial population) */
  setObjectsForSheet(
    sheetId: string,
    objects: FloatingObject[],
    boundsUpdates?: Map<string, FloatingObjectBounds>,
  ): void;
  /** Reset the cache to empty state */
  clear(): void;
}

export type FloatingObjectCache = StoreApi<FloatingObjectCacheState>;

// =============================================================================
// Internal Helpers
// =============================================================================

/**
 * Add or update a single object in mutable state maps.
 * Handles sheet index maintenance (cross-sheet moves, new sheets).
 */
function upsertObject(
  objects: Map<string, FloatingObject>,
  bySheet: Map<string, Set<string>>,
  obj: FloatingObject,
): void {
  const oldObj = objects.get(obj.id);
  objects.set(obj.id, obj);

  // If the object moved sheets, remove from old sheet index
  if (oldObj && oldObj.sheetId !== obj.sheetId) {
    const oldSet = bySheet.get(oldObj.sheetId);
    if (oldSet) {
      const updated = new Set(oldSet);
      updated.delete(obj.id);
      if (updated.size === 0) {
        bySheet.delete(oldObj.sheetId);
      } else {
        bySheet.set(oldObj.sheetId, updated);
      }
    }
  }

  // Add to sheet index
  const existing = bySheet.get(obj.sheetId);
  if (existing) {
    if (!existing.has(obj.id)) {
      const updated = new Set(existing);
      updated.add(obj.id);
      bySheet.set(obj.sheetId, updated);
    }
  } else {
    bySheet.set(obj.sheetId, new Set([obj.id]));
  }
}

/**
 * Remove a single object from mutable state maps.
 * Returns true if the object existed and was removed.
 */
function deleteObject(
  objects: Map<string, FloatingObject>,
  bySheet: Map<string, Set<string>>,
  id: string,
): boolean {
  const obj = objects.get(id);
  if (!obj) return false;

  objects.delete(id);

  const sheetSet = bySheet.get(obj.sheetId);
  if (sheetSet) {
    const updated = new Set(sheetSet);
    updated.delete(id);
    if (updated.size === 0) {
      bySheet.delete(obj.sheetId);
    } else {
      bySheet.set(obj.sheetId, updated);
    }
  }

  return true;
}

// =============================================================================
// Cache Factory
// =============================================================================

/**
 * Create a new floating object cache instance.
 *
 * NOT a singleton -- each document gets its own cache instance.
 * The cache is created in SheetCoordinator and exposed for hooks to consume.
 */
export function createFloatingObjectCache(): FloatingObjectCache {
  return create<FloatingObjectCacheState>((set) => ({
    objects: new Map(),
    objectsBySheet: new Map(),
    bounds: new Map(),

    setObject: (obj: FloatingObject, objBounds?: FloatingObjectBounds) =>
      set((state) => {
        const newObjects = new Map(state.objects);
        const newBySheet = new Map(state.objectsBySheet);
        upsertObject(newObjects, newBySheet, obj);

        let newBounds = state.bounds;
        if (objBounds) {
          newBounds = new Map(state.bounds);
          newBounds.set(obj.id, objBounds);
        }

        return { objects: newObjects, objectsBySheet: newBySheet, bounds: newBounds };
      }),

    removeObject: (id: string) =>
      set((state) => {
        const newObjects = new Map(state.objects);
        const newBySheet = new Map(state.objectsBySheet);
        const removed = deleteObject(newObjects, newBySheet, id);
        if (!removed) return state;

        let newBounds = state.bounds;
        if (newBounds.has(id)) {
          newBounds = new Map(state.bounds);
          newBounds.delete(id);
        }

        return { objects: newObjects, objectsBySheet: newBySheet, bounds: newBounds };
      }),

    applyBatch: (
      updates: FloatingObject[],
      deleteIds: string[],
      boundsUpdates?: Map<string, FloatingObjectBounds>,
    ) =>
      set((state) => {
        const hasBoundsUpdates = boundsUpdates != null && boundsUpdates.size > 0;
        if (updates.length === 0 && deleteIds.length === 0 && !hasBoundsUpdates) return state;

        // Bounds-only fast path: skip cloning objects/objectsBySheet when unchanged
        const hasDataChanges = updates.length > 0 || deleteIds.length > 0;

        let newObjects = state.objects;
        let newBySheet = state.objectsBySheet;

        if (hasDataChanges) {
          newObjects = new Map(state.objects);
          newBySheet = new Map(state.objectsBySheet);

          for (const id of deleteIds) {
            deleteObject(newObjects, newBySheet, id);
          }
          for (const obj of updates) {
            upsertObject(newObjects, newBySheet, obj);
          }
        }

        // Update bounds: remove deleted, add/update from boundsUpdates
        let newBounds = state.bounds;
        const hasBoundsDeletes = deleteIds.some((id) => state.bounds.has(id));
        if (hasBoundsDeletes || hasBoundsUpdates) {
          newBounds = new Map(state.bounds);
          for (const id of deleteIds) {
            newBounds.delete(id);
          }
          if (boundsUpdates) {
            for (const [id, b] of boundsUpdates) {
              newBounds.set(id, b);
            }
          }
        }

        return { objects: newObjects, objectsBySheet: newBySheet, bounds: newBounds };
      }),

    setObjectsForSheet: (
      sheetId: string,
      objects: FloatingObject[],
      boundsUpdates?: Map<string, FloatingObjectBounds>,
    ) =>
      set((state) => {
        const newObjects = new Map(state.objects);
        const newBySheet = new Map(state.objectsBySheet);

        // Remove old objects for this sheet (and their bounds)
        const oldIds = newBySheet.get(sheetId);
        let newBounds = state.bounds;
        if (oldIds) {
          const hasBounds = [...oldIds].some((id) => state.bounds.has(id));
          if (hasBounds) {
            newBounds = new Map(state.bounds);
            for (const id of oldIds) {
              newObjects.delete(id);
              newBounds.delete(id);
            }
          } else {
            for (const id of oldIds) {
              newObjects.delete(id);
            }
          }
        }

        // Add new objects
        const newIds = new Set<string>();
        for (const obj of objects) {
          newObjects.set(obj.id, obj);
          newIds.add(obj.id);
        }

        if (boundsUpdates && boundsUpdates.size > 0) {
          if (newBounds === state.bounds) newBounds = new Map(state.bounds);
          for (const [id, bounds] of boundsUpdates) {
            newBounds.set(id, bounds);
          }
        }

        if (newIds.size > 0) {
          newBySheet.set(sheetId, newIds);
        } else {
          newBySheet.delete(sheetId);
        }

        return { objects: newObjects, objectsBySheet: newBySheet, bounds: newBounds };
      }),

    clear: () =>
      set({
        objects: new Map(),
        objectsBySheet: new Map(),
        bounds: new Map(),
      }),
  }));
}
