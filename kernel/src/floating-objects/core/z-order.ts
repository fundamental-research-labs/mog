/**
 * Z-Order Operations (Universal)
 *
 * App-agnostic z-order management for canvas objects.
 * All operations accept IObjectStore via deps -- no spreadsheet imports.
 *
 * @module core/z-order
 */

import type { CanvasObject, IObjectStore } from '@mog-sdk/contracts/objects/canvas-object';

// =============================================================================
// TYPES
// =============================================================================

/**
 * Dependencies required for z-order operations.
 */
export interface ZOrderDeps<T extends CanvasObject = CanvasObject> {
  store: IObjectStore<T>;
}

/**
 * Result of a z-order operation.
 */
export interface ZOrderResult {
  /** Whether the operation was successful */
  success: boolean;
  /** IDs of objects whose z-index was modified */
  modifiedIds: string[];
}

// =============================================================================
// QUERY OPERATIONS
// =============================================================================

/**
 * Get all objects in a document, sorted by z-index (lowest first).
 *
 * @param deps - Store dependencies
 * @param containerId - Document to get objects from
 * @returns Array of objects sorted by z-index (ascending)
 */
export async function getObjectsSortedByZIndex<T extends CanvasObject>(
  deps: ZOrderDeps<T>,
  containerId: string,
): Promise<T[]> {
  const objects = await deps.store.readInDocument(containerId);
  return objects.sort((a, b) => a.zIndex - b.zIndex);
}

/**
 * Get the maximum z-index currently in use in a document.
 * Returns 0 if there are no objects.
 *
 * @param deps - Store dependencies
 * @param containerId - Document to check
 * @returns Maximum z-index value, or 0 if no objects exist
 */
export async function getMaxZIndex<T extends CanvasObject>(
  deps: ZOrderDeps<T>,
  containerId: string,
): Promise<number> {
  const objects = await getObjectsSortedByZIndex(deps, containerId);
  if (objects.length === 0) return 0;
  return Math.max(...objects.map((o) => o.zIndex));
}

/**
 * Get the minimum z-index currently in use in a document.
 * Returns 0 if there are no objects.
 *
 * @param deps - Store dependencies
 * @param containerId - Document to check
 * @returns Minimum z-index value, or 0 if no objects exist
 */
export async function getMinZIndex<T extends CanvasObject>(
  deps: ZOrderDeps<T>,
  containerId: string,
): Promise<number> {
  const objects = await getObjectsSortedByZIndex(deps, containerId);
  if (objects.length === 0) return 0;
  return Math.min(...objects.map((o) => o.zIndex));
}

/**
 * Get the next available z-index for a new object in a document.
 * This is one greater than the current maximum.
 *
 * @param deps - Store dependencies
 * @param containerId - Document to get next z-index for
 * @returns Next available z-index value
 */
export async function getNextZIndex<T extends CanvasObject>(
  deps: ZOrderDeps<T>,
  containerId: string,
): Promise<number> {
  return (await getMaxZIndex(deps, containerId)) + 1;
}

// =============================================================================
// MUTATION OPERATIONS
// =============================================================================

/**
 * Move an object to the front (highest z-index) in its document.
 * Does nothing if the object is already at the front.
 *
 * @param deps - Store dependencies
 * @param containerId - Document containing the object
 * @param objectId - ID of the object to move
 * @param _source - Source of the change (defaults to 'user') -- retained for API compat
 * @returns Result indicating success and which objects were modified
 */
export async function bringToFront<T extends CanvasObject>(
  deps: ZOrderDeps<T>,
  containerId: string,
  objectId: string,
  _source: string = 'user',
): Promise<ZOrderResult> {
  const objects = await deps.store.readInDocument(containerId);
  const existing = objects.find((o) => o.id === objectId);
  if (!existing) {
    return { success: false, modifiedIds: [] };
  }

  const maxZ = Math.max(...objects.map((o) => o.zIndex));
  if (existing.zIndex >= maxZ) {
    // Already at front
    return { success: true, modifiedIds: [] };
  }

  await deps.store.update(objectId, { zIndex: maxZ + 1 } as Partial<T>, containerId);

  return { success: true, modifiedIds: [objectId] };
}

/**
 * Move an object to the back (lowest z-index) in its document.
 * Does nothing if the object is already at the back.
 *
 * @param deps - Store dependencies
 * @param containerId - Document containing the object
 * @param objectId - ID of the object to move
 * @param _source - Source of the change (defaults to 'user') -- retained for API compat
 * @returns Result indicating success and which objects were modified
 */
export async function sendToBack<T extends CanvasObject>(
  deps: ZOrderDeps<T>,
  containerId: string,
  objectId: string,
  _source: string = 'user',
): Promise<ZOrderResult> {
  const objects = await deps.store.readInDocument(containerId);
  const existing = objects.find((o) => o.id === objectId);
  if (!existing) {
    return { success: false, modifiedIds: [] };
  }

  const minZ = Math.min(...objects.map((o) => o.zIndex));
  if (existing.zIndex <= minZ) {
    // Already at back
    return { success: true, modifiedIds: [] };
  }

  await deps.store.update(objectId, { zIndex: minZ - 1 } as Partial<T>, containerId);

  return { success: true, modifiedIds: [objectId] };
}

/**
 * Move an object one step forward in z-order (swap with the object above it).
 * Does nothing if the object is already at the front.
 *
 * @param deps - Store dependencies
 * @param containerId - Document containing the object
 * @param objectId - ID of the object to move
 * @param _source - Source of the change (defaults to 'user') -- retained for API compat
 * @returns Result indicating success and which objects were modified
 */
export async function bringForward<T extends CanvasObject>(
  deps: ZOrderDeps<T>,
  containerId: string,
  objectId: string,
  _source: string = 'user',
): Promise<ZOrderResult> {
  const objects = await getObjectsSortedByZIndex(deps, containerId);
  const obj = objects.find((o) => o.id === objectId);
  if (!obj) {
    return { success: false, modifiedIds: [] };
  }

  // Find the object with the next higher z-index
  const nextObj = objects.find((o) => o.zIndex > obj.zIndex);
  if (!nextObj) {
    // Already at front
    return { success: true, modifiedIds: [] };
  }

  // Swap z-indices
  await deps.store.update(objectId, { zIndex: nextObj.zIndex } as Partial<T>, containerId);
  await deps.store.update(nextObj.id, { zIndex: obj.zIndex } as Partial<T>, containerId);

  return { success: true, modifiedIds: [objectId, nextObj.id] };
}

/**
 * Move an object one step backward in z-order (swap with the object below it).
 * Does nothing if the object is already at the back.
 *
 * @param deps - Store dependencies
 * @param containerId - Document containing the object
 * @param objectId - ID of the object to move
 * @param _source - Source of the change (defaults to 'user') -- retained for API compat
 * @returns Result indicating success and which objects were modified
 */
export async function sendBackward<T extends CanvasObject>(
  deps: ZOrderDeps<T>,
  containerId: string,
  objectId: string,
  _source: string = 'user',
): Promise<ZOrderResult> {
  const objects = await getObjectsSortedByZIndex(deps, containerId);
  const obj = objects.find((o) => o.id === objectId);
  if (!obj) {
    return { success: false, modifiedIds: [] };
  }

  // Find the object with the next lower z-index
  const prevObj = [...objects].reverse().find((o) => o.zIndex < obj.zIndex);
  if (!prevObj) {
    // Already at back
    return { success: true, modifiedIds: [] };
  }

  // Swap z-indices
  await deps.store.update(objectId, { zIndex: prevObj.zIndex } as Partial<T>, containerId);
  await deps.store.update(prevObj.id, { zIndex: obj.zIndex } as Partial<T>, containerId);

  return { success: true, modifiedIds: [objectId, prevObj.id] };
}

// =============================================================================
// BATCH OPERATIONS
// =============================================================================

/**
 * Normalize z-indices in a document to be contiguous starting from 0.
 * Useful after deleting objects to avoid z-index gaps.
 *
 * @param deps - Store dependencies
 * @param containerId - Document to normalize
 * @param _source - Source of the change (defaults to 'user') -- retained for API compat
 * @returns Result indicating success and which objects were modified
 */
export async function normalizeZIndices<T extends CanvasObject>(
  deps: ZOrderDeps<T>,
  containerId: string,
  _source: string = 'user',
): Promise<ZOrderResult> {
  const objects = await getObjectsSortedByZIndex(deps, containerId);
  if (objects.length === 0) {
    return { success: true, modifiedIds: [] };
  }

  // Check if normalization is needed
  const needsNormalization = objects.some((obj, index) => obj.zIndex !== index);
  if (!needsNormalization) {
    return { success: true, modifiedIds: [] };
  }

  const modifiedIds: string[] = [];

  for (let index = 0; index < objects.length; index++) {
    const obj = objects[index];
    if (obj.zIndex !== index) {
      await deps.store.update(obj.id, { zIndex: index } as Partial<T>, containerId);
      modifiedIds.push(obj.id);
    }
  }

  return { success: true, modifiedIds };
}
