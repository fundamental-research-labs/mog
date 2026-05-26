/**
 * Grouping Operations (Universal)
 *
 * App-agnostic group CRUD for canvas objects.
 * Accepts IGroupStore + IObjectStore via deps -- no spreadsheet imports.
 *
 * computeGroupBounds (which needs position resolution) is NOT included here.
 * It belongs in the spreadsheet/ adapter layer.
 * For pure pixel-bounds group computation, see core/positioning.ts
 * (computeGroupBoundsFromMembers).
 *
 * @module core/grouping
 */

import type {
  CanvasObject,
  CanvasObjectGroup,
  IGroupStore,
  IObjectStore,
} from '@mog-sdk/contracts/objects/canvas-object';

import { FloatingObjectError } from '../../errors/floating-object';

// =============================================================================
// TYPES
// =============================================================================

/**
 * Dependencies required for grouping operations.
 */
export interface GroupingDeps<
  T extends CanvasObject = CanvasObject,
  TGroup extends CanvasObjectGroup = CanvasObjectGroup,
> {
  store: IObjectStore<T>;
  groupStore: IGroupStore<TGroup>;
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Generate a unique object/group ID.
 */
function generateObjectId(): string {
  return `obj-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

// =============================================================================
// PUBLIC API - GROUPING OPERATIONS
// =============================================================================

/**
 * Group multiple objects together.
 *
 * Creates a new CanvasObjectGroup that contains the specified objects.
 * All objects must exist and be in the same document. The group's z-index
 * is set to the maximum z-index of its members.
 *
 * NOTE: This creates a group with default fields only (no position).
 * If the app needs position on the group (e.g., spreadsheets with
 * CellAnchor-based group bounds), it should compute that separately
 * and update the group after creation.
 *
 * @param deps - Grouping dependencies (store + groupStore)
 * @param objectIds - Array of object IDs to group (minimum 2)
 * @returns The created group ID
 * @throws Error if fewer than 2 objects, objects not found, or objects in different documents
 */
export async function groupObjects<T extends CanvasObject, TGroup extends CanvasObjectGroup>(
  deps: GroupingDeps<T, TGroup>,
  objectIds: string[],
): Promise<string> {
  if (objectIds.length < 2) {
    throw new FloatingObjectError(
      'OBJ_GROUP_TOO_FEW',
      'group',
      'Need at least 2 objects to create a group',
    );
  }

  // Verify all objects exist and are in the same document
  const objects: T[] = [];
  for (const id of objectIds) {
    const result = await deps.store.read(id);
    if (!result.object) {
      throw new FloatingObjectError('OBJ_NOT_FOUND', 'object', `Object not found: ${id}`);
    }
    objects.push(result.object);
  }

  const containerId = objects[0].containerId;
  if (!objects.every((o) => o.containerId === containerId)) {
    throw new FloatingObjectError(
      'OBJ_INVALID_CONFIG',
      'group',
      'All objects must be in the same container',
    );
  }

  const groupId = generateObjectId();
  const maxZ = Math.max(...objects.map((o) => o.zIndex));

  const group = {
    id: groupId,
    containerId,
    memberIds: objectIds,
    zIndex: maxZ,
    locked: false,
  } as TGroup;

  await deps.groupStore.create(containerId, group);

  return groupId;
}

/**
 * Ungroup a group.
 *
 * Deletes the group but leaves all member objects intact.
 * The member objects retain their individual positions and z-indices.
 *
 * @param deps - Grouping dependencies (store + groupStore)
 * @param groupId - Group identifier to ungroup
 * @returns Array of member object IDs that were in the group, or empty array if group not found
 */
export async function ungroupObjects<T extends CanvasObject, TGroup extends CanvasObjectGroup>(
  deps: GroupingDeps<T, TGroup>,
  groupId: string,
): Promise<string[]> {
  const group = await deps.groupStore.read(groupId);
  if (!group) return [];

  const memberIds = [...group.memberIds];

  await deps.groupStore.delete(groupId);

  return memberIds;
}

/**
 * Get a group by ID.
 *
 * @param deps - Grouping dependencies
 * @param groupId - Group identifier
 * @returns The group or undefined if not found
 */
export async function getGroup<T extends CanvasObject, TGroup extends CanvasObjectGroup>(
  deps: GroupingDeps<T, TGroup>,
  groupId: string,
): Promise<TGroup | undefined> {
  return deps.groupStore.read(groupId);
}

/**
 * Get all groups in a container.
 *
 * @param deps - Grouping dependencies
 * @param containerId - Container identifier
 * @returns Array of groups in the container
 */
export async function getGroupsInDocument<T extends CanvasObject, TGroup extends CanvasObjectGroup>(
  deps: GroupingDeps<T, TGroup>,
  containerId: string,
): Promise<TGroup[]> {
  return deps.groupStore.readInDocument(containerId);
}
