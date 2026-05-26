/**
 * Mutation Operations (Universal)
 *
 * App-agnostic CRUD mutations for canvas objects.
 * Accepts IObjectStore via deps -- no spreadsheet imports.
 *
 * Event emission is NOT handled here. All store writes go through the compute
 * bridge, which returns floatingObjectChanges in the MutationResult.
 * MutationResultHandler emits floatingObject:updated/deleted automatically.
 *
 * @module core/mutations
 */

import type {
  CanvasObject,
  CanvasObjectType,
  IObjectStore,
} from '@mog-sdk/contracts/objects/canvas-object';

// =============================================================================
// TYPES
// =============================================================================

/**
 * Dependencies required for mutation operations.
 */
export interface MutationDeps<T extends CanvasObject = CanvasObject> {
  store: IObjectStore<T>;
}

/**
 * Result of a delete operation.
 */
export interface DeleteResult {
  /** Whether the deletion was successful */
  success: boolean;
  /** Container ID of the deleted object (if found) */
  containerId?: string;
  /** Type of the deleted object (if found) */
  objectType?: CanvasObjectType;
}

/**
 * Result of a batch delete operation.
 */
export interface BatchDeleteResult {
  /** Number of objects successfully deleted */
  deletedCount: number;
  /** Objects that were deleted, grouped by container */
  deletedByContainer: Map<string, Array<{ id: string; type: CanvasObjectType }>>;
}

// =============================================================================
// UPDATE OPERATIONS
// =============================================================================

/**
 * Update a canvas object with partial properties.
 *
 * This performs a shallow merge of the updates with the existing object.
 * The updatedAt timestamp is automatically set to the current time.
 *
 * @param deps - Dependencies (store)
 * @param objectId - The ID of the object to update
 * @param updates - Partial properties to merge into the object
 * @returns true if the object was updated, false if object not found
 */
export async function updateObject<T extends CanvasObject>(
  deps: MutationDeps<T>,
  objectId: string,
  updates: Partial<T>,
): Promise<boolean> {
  const found = await deps.store.read(objectId);
  if (!found.object || !found.containerId) return false;

  const result = await deps.store.update(objectId, updates, found.containerId);
  return result.success;
}

// =============================================================================
// DELETE OPERATIONS
// =============================================================================

/**
 * Delete a single canvas object.
 *
 * @param deps - Dependencies (store)
 * @param objectId - The ID of the object to delete
 * @returns DeleteResult with success status and object info
 */
export async function deleteObject<T extends CanvasObject>(
  deps: MutationDeps<T>,
  objectId: string,
): Promise<DeleteResult> {
  // Read first to get type info for the result
  const found = await deps.store.read(objectId);
  if (!found.object || !found.containerId) {
    return { success: false };
  }

  const result = await deps.store.delete(objectId);
  if (!result.success) {
    return { success: false };
  }

  return {
    success: true,
    containerId: found.containerId,
    objectType: found.object.type,
  };
}

/**
 * Delete multiple canvas objects in a batch.
 *
 * @param deps - Dependencies (store)
 * @param objectIds - Array of object IDs to delete
 * @returns BatchDeleteResult with deletion count and details
 */
export async function deleteObjects<T extends CanvasObject>(
  deps: MutationDeps<T>,
  objectIds: string[],
): Promise<BatchDeleteResult> {
  if (objectIds.length === 0) {
    return { deletedCount: 0, deletedByContainer: new Map() };
  }

  // Gather object info before deletion
  const byContainer = new Map<string, Array<{ id: string; type: CanvasObjectType }>>();
  for (const objectId of objectIds) {
    const found = await deps.store.read(objectId);
    if (found.object && found.containerId) {
      const list = byContainer.get(found.containerId) ?? [];
      list.push({ id: objectId, type: found.object.type });
      byContainer.set(found.containerId, list);
    }
  }

  // Perform the batch deletion via the store
  const deletedCount = await deps.store.deleteBatch(objectIds);

  return {
    deletedCount,
    deletedByContainer: byContainer,
  };
}
