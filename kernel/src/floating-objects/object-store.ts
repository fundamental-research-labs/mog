/**
 * Canvas Object Store
 *
 * IObjectStore<FloatingObject> implementation backed by ComputeBridge (Rust/Yrs).
 * This wraps ComputeBridge internally while exposing the universal IObjectStore
 * interface that uses `containerId` in its public API.
 *
 * Internally, ComputeBridge still uses `sheetId` -- that's fine, it's an
 * implementation detail. The public interface is app-agnostic.
 *
 * Responsibilities:
 * - Create: Insert new floating objects via ComputeBridge
 * - Read: Retrieve floating objects by ID, by document, or by type
 * - Update: Merge partial updates into existing objects
 * - Delete: Remove objects and clean up group memberships
 *
 * Non-responsibilities (handled by other modules):
 * - Shape computation -> @mog/shape-engine
 * - Anchor resolution -> IPositionResolver
 * - Hit testing -> core/spatial-index
 * - Ink operations -> @mog/ink-engine
 * - Event emission -> object-events.ts
 *
 * @see ./canvas-object-manager.ts    -- Universal manager that uses this store
 * @see ./object-events.ts            -- Event emission layer
 * @see ../bridges/compute-bridge.ts  -- Engine delegation bridge
 */

import { type SheetId, sheetId as toSheetId } from '@mog-sdk/contracts/core';
import type { FloatingObject } from '@mog-sdk/contracts/floating-objects';
import type {
  CanvasObjectGroup,
  CanvasObjectType,
  IGroupStore,
  IObjectStore,
} from '@mog-sdk/contracts/objects/canvas-object';

import type { ComputeBridge } from '../bridges/compute/compute-bridge';
import type { SerializedFloatingObjectGroup } from '../bridges/compute/compute-types.gen';
import {
  toFloatingObject,
  toFloatingObjectGroup,
} from '../bridges/compute/floating-object-mapper';

// =============================================================================
// ComputeBridgeObjectStore — IObjectStore<FloatingObject>
// =============================================================================

/**
 * IObjectStore implementation backed by ComputeBridge (Rust/Yrs).
 *
 * Maps the universal `containerId` parameter to `sheetId` internally,
 * since ComputeBridge uses `sheetId` as its storage key.
 */
export class ComputeBridgeObjectStore implements IObjectStore<FloatingObject> {
  constructor(private computeBridge: ComputeBridge) {}

  async create(
    containerId: string,
    object: FloatingObject,
  ): Promise<{ success: boolean; object?: FloatingObject }> {
    const sheet = toSheetId(containerId);
    try {
      await this.computeBridge.setFloatingObject(sheet, object.id, object);
      return { success: true, object };
    } catch {
      return { success: false };
    }
  }

  async read(objectId: string): Promise<{ object?: FloatingObject; containerId?: string }> {
    const sheetIds = await this.computeBridge.getAllSheetIds();

    // Parallel per-sheet lookups using typed method
    // getAllSheetIds() returns raw strings from the bridge — brand at the seam.
    const results = await Promise.all(
      sheetIds.map((id) => {
        const sheet = toSheetId(id);
        return this.computeBridge
          .getFloatingObjectTyped(sheet, objectId)
          .then((obj) => ({ sheet, obj }));
      }),
    );

    for (const { sheet, obj } of results) {
      if (obj) {
        return { object: toFloatingObject(obj), containerId: sheet };
      }
    }

    return { object: undefined, containerId: undefined };
  }

  async readInDocument(containerId: string): Promise<FloatingObject[]> {
    const sheet = toSheetId(containerId);
    const objects = await this.computeBridge.getAllFloatingObjectsTyped(sheet);
    return objects.map((obj) => toFloatingObject(obj));
  }

  async readByType(containerId: string, type: CanvasObjectType): Promise<FloatingObject[]> {
    const all = await this.readInDocument(containerId);
    return all.filter((obj) => obj.type === type);
  }

  async update(
    objectId: string,
    updates: Partial<FloatingObject>,
    containerId?: string,
  ): Promise<{ success: boolean; object?: FloatingObject }> {
    // Resolve the container holding the object
    let resolvedContainerId = containerId;
    let existing: FloatingObject | undefined;

    if (resolvedContainerId) {
      const sheet = toSheetId(resolvedContainerId);
      const typed = await this.computeBridge.getFloatingObjectTyped(sheet, objectId);
      if (typed) {
        existing = toFloatingObject(typed);
      }
    }

    if (!existing) {
      const found = await this.read(objectId);
      if (!found.object || !found.containerId) {
        return { success: false };
      }
      resolvedContainerId = found.containerId;
      existing = found.object;
    }

    // Use the typed partial-update method — Rust handles the merge
    // Pass updates with immutable-field guards. `sheetId` is immutable by
    // construction (branded field, ignored by the bridge on update), so we
    // don't need to overwrite it to `undefined` here — doing so would now
    // fail type-check since FloatingObject.sheetId: SheetId can't be undefined.
    const safeUpdates = {
      ...updates,
      id: undefined, // prevent ID mutation
      type: undefined, // prevent type mutation
      updatedAt: Date.now(),
    };

    const resolvedSheet = toSheetId(resolvedContainerId!);
    await this.computeBridge.updateFloatingObject(resolvedSheet, objectId, safeUpdates);

    // Return the merged object for callers that need it
    const updatedObject = Object.assign({}, existing, updates, {
      id: existing.id,
      type: existing.type,
      sheetId: existing.sheetId,
      updatedAt: safeUpdates.updatedAt,
    }) as FloatingObject;

    return { success: true, object: updatedObject };
  }

  async delete(objectId: string): Promise<{ success: boolean; containerId?: string }> {
    const found = await this.read(objectId);
    if (!found.object || !found.containerId) {
      return { success: false };
    }

    const sheet = toSheetId(found.containerId);
    await this.computeBridge.deleteFloatingObject(sheet, objectId);

    // Clean up group memberships
    await this.cleanupGroupMembership(sheet, [objectId]);

    return { success: true, containerId: found.containerId };
  }

  async deleteBatch(objectIds: string[]): Promise<number> {
    if (objectIds.length === 0) return 0;

    let deletedCount = 0;
    const sheetIds = await this.computeBridge.getAllSheetIds();

    // Parallel per-sheet scan using typed method.
    // getAllSheetIds() returns raw strings from the bridge — brand at the seam.
    const sheetEntries = await Promise.all(
      sheetIds.map((id) => {
        const sheet = toSheetId(id);
        return this.computeBridge
          .getAllFloatingObjectsTyped(sheet)
          .then((objects) => ({ sheet, objects }));
      }),
    );

    // Group deletions by container for efficient cleanup
    for (const { sheet, objects } of sheetEntries) {
      const objectIdsInSheet = new Set(objects.map((obj) => obj.id));
      const idsToDelete = objectIds.filter((id) => objectIdsInSheet.has(id));

      if (idsToDelete.length === 0) continue;

      // Parallel deletes within this container
      await Promise.all(
        idsToDelete.map((id) => this.computeBridge.deleteFloatingObject(sheet, id)),
      );

      // Clean up group memberships
      await this.cleanupGroupMembership(sheet, idsToDelete);

      deletedCount += idsToDelete.length;
    }

    return deletedCount;
  }

  async count(containerId: string): Promise<number> {
    const sheet = toSheetId(containerId);
    const objects = await this.computeBridge.getAllFloatingObjectsTyped(sheet);
    return objects.length;
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  /**
   * Clean up group memberships after objects are deleted.
   *
   * Removes the specified object IDs from all groups in the given container,
   * and deletes any groups that become empty or single-member.
   */
  private async cleanupGroupMembership(sheet: SheetId, deletedIds: string[]): Promise<void> {
    const deletedSet = new Set(deletedIds);

    const groups = await this.computeBridge.getAllFloatingObjectGroupsTyped(sheet);

    await Promise.all(
      groups.map(async (group: SerializedFloatingObjectGroup) => {
        const memberIds = group.children;
        const hasDeletedMembers = memberIds.some((id: string) => deletedSet.has(id));
        if (!hasDeletedMembers) return;

        const remainingMembers = memberIds.filter((id: string) => !deletedSet.has(id));
        if (remainingMembers.length <= 1) {
          await this.computeBridge.deleteFloatingObjectGroup(sheet, group.id);
        } else if (remainingMembers.length !== memberIds.length) {
          await this.computeBridge.updateFloatingObjectGroup(sheet, group.id, {
            children: remainingMembers,
          });
        }
      }),
    );
  }
}

// =============================================================================
// ComputeBridgeGroupStore — IGroupStore<FloatingObjectGroup>
// =============================================================================

/**
 * IGroupStore implementation backed by ComputeBridge (Rust/Yrs).
 */
export class ComputeBridgeGroupStore implements IGroupStore<CanvasObjectGroup> {
  constructor(private computeBridge: ComputeBridge) {}

  async create(containerId: string, group: CanvasObjectGroup): Promise<boolean> {
    const sheet = toSheetId(containerId);
    try {
      await this.computeBridge.setFloatingObjectGroup(sheet, group.id, {
        id: group.id,
        sheetId: sheet,
        children: group.memberIds,
        zIndex: group.zIndex,
        name: group.name,
        locked: group.locked,
      });
      return true;
    } catch {
      return false;
    }
  }

  async read(groupId: string): Promise<CanvasObjectGroup | undefined> {
    const sheetIds = await this.computeBridge.getAllSheetIds();

    // getAllSheetIds() returns raw strings from the bridge — brand at the seam.
    const results = await Promise.all(
      sheetIds.map((id) => this.computeBridge.getFloatingObjectGroupTyped(toSheetId(id), groupId)),
    );

    for (const group of results) {
      if (group) {
        return toFloatingObjectGroup(group);
      }
    }

    return undefined;
  }

  async readInDocument(containerId: string): Promise<CanvasObjectGroup[]> {
    const sheet = toSheetId(containerId);
    const groups = await this.computeBridge.getAllFloatingObjectGroupsTyped(sheet);
    return groups.map(toFloatingObjectGroup);
  }

  async delete(groupId: string): Promise<boolean> {
    const sheetIds = await this.computeBridge.getAllSheetIds();

    // getAllSheetIds() returns raw strings from the bridge — brand at the seam.
    const results = await Promise.all(
      sheetIds.map((id) => {
        const sheet = toSheetId(id);
        return this.computeBridge
          .getFloatingObjectGroupTyped(sheet, groupId)
          .then((group) => ({ sheet, group }));
      }),
    );

    for (const { sheet, group } of results) {
      if (group) {
        await this.computeBridge.deleteFloatingObjectGroup(sheet, groupId);
        return true;
      }
    }

    return false;
  }
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Create an IObjectStore<FloatingObject> backed by ComputeBridge.
 */
export function createObjectStore(computeBridge: ComputeBridge): ComputeBridgeObjectStore {
  return new ComputeBridgeObjectStore(computeBridge);
}

/**
 * Create an IGroupStore backed by ComputeBridge.
 */
export function createGroupStore(computeBridge: ComputeBridge): ComputeBridgeGroupStore {
  return new ComputeBridgeGroupStore(computeBridge);
}
