/**
 * Selection Operations (Universal)
 *
 * App-agnostic selection management for canvas objects.
 * Only anchor-agnostic functions are included here.
 *
 * Functions that require position resolution (computeSelectionBounds,
 * getSelectionCenter) belong in the spreadsheet/ adapter layer.
 *
 * @module core/selection
 */

import type {
  CanvasObject,
  CanvasObjectGroup,
  IGroupStore,
  IObjectStore,
} from '@mog-sdk/contracts/objects/canvas-object';

// =============================================================================
// TYPES
// =============================================================================

/**
 * Dependencies required for selection operations.
 */
export interface SelectionDeps<
  T extends CanvasObject = CanvasObject,
  TGroup extends CanvasObjectGroup = CanvasObjectGroup,
> {
  store: IObjectStore<T>;
  groupStore?: IGroupStore<TGroup>;
}

/**
 * Result of validating a selection.
 */
export interface SelectionValidationResult {
  /** Whether all selected IDs are valid */
  valid: boolean;
  /** IDs that were found and are valid */
  validIds: string[];
  /** IDs that were not found (invalid) */
  invalidIds: string[];
  /** The container ID if all valid objects are in the same container, undefined otherwise */
  commonContainerId?: string;
}

/**
 * Selection filter options.
 */
export interface SelectionFilterOptions {
  /** Filter to specific object types */
  types?: string[];
  /** Include only locked objects */
  lockedOnly?: boolean;
  /** Include only unlocked objects */
  unlockedOnly?: boolean;
  /** Include only printable objects */
  printableOnly?: boolean;
}

// =============================================================================
// SELECTION STATE HELPERS (pure, no deps)
// =============================================================================

/**
 * Check if an object is currently selected.
 *
 * @param objectId - The object ID to check
 * @param selectedIds - Currently selected object IDs
 * @returns true if the object is selected
 */
export function isObjectSelected(objectId: string, selectedIds: string[]): boolean {
  return selectedIds.includes(objectId);
}

/**
 * Check if the selection is empty.
 *
 * @param selectedIds - Currently selected object IDs
 * @returns true if no objects are selected
 */
export function isSelectionEmpty(selectedIds: string[]): boolean {
  return selectedIds.length === 0;
}

/**
 * Check if multiple objects are selected.
 *
 * @param selectedIds - Currently selected object IDs
 * @returns true if more than one object is selected
 */
export function isMultiSelection(selectedIds: string[]): boolean {
  return selectedIds.length > 1;
}

/**
 * Get the count of selected objects.
 *
 * @param selectedIds - Currently selected object IDs
 * @returns Number of selected objects
 */
export function getSelectionCount(selectedIds: string[]): number {
  return selectedIds.length;
}

/**
 * Remove an object from the selection.
 *
 * Returns a new array with the object removed. Does not modify the original.
 *
 * @param selectedIds - Current selection
 * @param objectId - Object ID to remove
 * @returns New selection array with the object removed
 */
export function removeFromSelection(selectedIds: string[], objectId: string): string[] {
  return selectedIds.filter((id) => id !== objectId);
}

/**
 * Clear the selection.
 *
 * @returns Empty selection array
 */
export function clearSelection(): string[] {
  return [];
}

// =============================================================================
// SELECTION QUERY OPERATIONS (async, require deps)
// =============================================================================

/**
 * Check if an object ID exists in the data store.
 *
 * @param deps - Store dependencies
 * @param objectId - The object ID to check
 * @returns true if the object exists, false otherwise
 */
export async function isObjectIdValid<T extends CanvasObject>(
  deps: SelectionDeps<T>,
  objectId: string,
): Promise<boolean> {
  const result = await deps.store.read(objectId);
  return result.object !== undefined;
}

/**
 * Check if a group ID exists in the data store.
 *
 * @param deps - Store dependencies
 * @param groupId - The group ID to check
 * @returns true if the group exists, false otherwise
 */
export async function isGroupIdValid<T extends CanvasObject, TGroup extends CanvasObjectGroup>(
  deps: SelectionDeps<T, TGroup>,
  groupId: string,
): Promise<boolean> {
  if (!deps.groupStore) return false;
  const group = await deps.groupStore.read(groupId);
  return group !== undefined;
}

/**
 * Validate a set of selected object IDs.
 *
 * Checks that all IDs correspond to existing objects and determines
 * if they all belong to the same container (required for multi-selection).
 *
 * @param deps - Store dependencies
 * @param selectedIds - Array of selected object IDs
 * @returns Validation result with valid/invalid IDs and common document
 */
export async function validateSelection<T extends CanvasObject, TGroup extends CanvasObjectGroup>(
  deps: SelectionDeps<T, TGroup>,
  selectedIds: string[],
): Promise<SelectionValidationResult> {
  const validIds: string[] = [];
  const invalidIds: string[] = [];
  const containerIds = new Set<string>();

  for (const id of selectedIds) {
    const objResult = await deps.store.read(id);
    if (objResult.object && objResult.containerId) {
      validIds.push(id);
      containerIds.add(objResult.containerId);
    } else if (deps.groupStore) {
      // Check if it's a group
      const group = await deps.groupStore.read(id);
      if (group) {
        validIds.push(id);
        containerIds.add(group.containerId);
      } else {
        invalidIds.push(id);
      }
    } else {
      invalidIds.push(id);
    }
  }

  const valid = invalidIds.length === 0 && validIds.length === selectedIds.length;
  const commonContainerId = containerIds.size === 1 ? Array.from(containerIds)[0] : undefined;

  return {
    valid,
    validIds,
    invalidIds,
    commonContainerId,
  };
}

/**
 * Get the objects for a set of selected IDs.
 *
 * Filters out invalid IDs and returns only existing objects.
 * Does not include groups -- use getSelectedGroups for that.
 *
 * @param deps - Store dependencies
 * @param selectedIds - Array of selected object IDs
 * @returns Array of objects (excludes invalid IDs and groups)
 */
export async function getSelectedObjects<T extends CanvasObject>(
  deps: SelectionDeps<T>,
  selectedIds: string[],
): Promise<T[]> {
  const objects: T[] = [];

  for (const id of selectedIds) {
    const result = await deps.store.read(id);
    if (result.object) {
      objects.push(result.object);
    }
  }

  return objects;
}

/**
 * Get the groups for a set of selected IDs.
 *
 * Filters out invalid IDs and returns only existing groups.
 *
 * @param deps - Store dependencies
 * @param selectedIds - Array of selected IDs (may include both objects and groups)
 * @returns Array of groups
 */
export async function getSelectedGroups<T extends CanvasObject, TGroup extends CanvasObjectGroup>(
  deps: SelectionDeps<T, TGroup>,
  selectedIds: string[],
): Promise<TGroup[]> {
  if (!deps.groupStore) return [];

  const groups: TGroup[] = [];

  for (const id of selectedIds) {
    const group = await deps.groupStore.read(id);
    if (group) {
      groups.push(group);
    }
  }

  return groups;
}

/**
 * Add an object to the selection.
 *
 * Returns a new array with the object added. Does not modify the original.
 * Validates that the object exists before adding.
 *
 * @param deps - Store dependencies
 * @param selectedIds - Current selection
 * @param objectId - Object ID to add
 * @returns New selection array with the object added
 */
export async function addToSelection<T extends CanvasObject, TGroup extends CanvasObjectGroup>(
  deps: SelectionDeps<T, TGroup>,
  selectedIds: string[],
  objectId: string,
): Promise<string[]> {
  // Don't add if already selected
  if (selectedIds.includes(objectId)) {
    return selectedIds;
  }

  // Validate object exists
  const isValid = (await isObjectIdValid(deps, objectId)) || (await isGroupIdValid(deps, objectId));
  if (!isValid) {
    return selectedIds;
  }

  return [...selectedIds, objectId];
}

/**
 * Toggle an object's selection state.
 *
 * Adds the object if not selected, removes it if selected.
 *
 * @param deps - Store dependencies
 * @param selectedIds - Current selection
 * @param objectId - Object ID to toggle
 * @returns New selection array with the object toggled
 */
export async function toggleSelection<T extends CanvasObject, TGroup extends CanvasObjectGroup>(
  deps: SelectionDeps<T, TGroup>,
  selectedIds: string[],
  objectId: string,
): Promise<string[]> {
  if (selectedIds.includes(objectId)) {
    return removeFromSelection(selectedIds, objectId);
  } else {
    return addToSelection(deps, selectedIds, objectId);
  }
}

/**
 * Replace the selection with a single object.
 *
 * Returns a new array containing only the specified object.
 * Validates that the object exists before setting.
 *
 * @param deps - Store dependencies
 * @param objectId - Object ID to select
 * @returns New selection array with only the specified object
 */
export async function setSelection<T extends CanvasObject, TGroup extends CanvasObjectGroup>(
  deps: SelectionDeps<T, TGroup>,
  objectId: string,
): Promise<string[]> {
  const isValid = (await isObjectIdValid(deps, objectId)) || (await isGroupIdValid(deps, objectId));
  if (!isValid) {
    return [];
  }

  return [objectId];
}

/**
 * Select all objects in a container.
 *
 * Returns an array of all selectable object IDs in the container.
 *
 * @param deps - Store dependencies
 * @param containerId - Container to select all objects in
 * @returns Array of all object IDs in the container
 */
export async function selectAllInDocument<T extends CanvasObject>(
  deps: SelectionDeps<T>,
  containerId: string,
): Promise<string[]> {
  const objects = await getSelectableObjectsInDocument(deps, containerId);
  return objects.map((obj) => obj.id);
}

/**
 * Filter selected objects by criteria.
 *
 * @param deps - Store dependencies
 * @param selectedIds - Array of selected object IDs
 * @param options - Filter options
 * @returns Array of object IDs that match the filter criteria
 */
export async function filterSelection<T extends CanvasObject>(
  deps: SelectionDeps<T>,
  selectedIds: string[],
  options: SelectionFilterOptions,
): Promise<string[]> {
  const objects = await getSelectedObjects(deps, selectedIds);
  const filtered: string[] = [];

  for (const obj of objects) {
    // Type filter
    if (options.types && !options.types.includes(obj.type)) {
      continue;
    }

    // Locked filter
    if (options.lockedOnly && !obj.locked) {
      continue;
    }
    if (options.unlockedOnly && obj.locked) {
      continue;
    }

    // Printable filter
    if (options.printableOnly && !obj.printable) {
      continue;
    }

    filtered.push(obj.id);
  }

  return filtered;
}

/**
 * Get all selectable objects in a container.
 *
 * Returns objects sorted by z-index (highest first for selection priority).
 *
 * @param deps - Store dependencies
 * @param containerId - Container to get objects from
 * @returns Array of selectable objects, sorted by z-index descending
 */
export async function getSelectableObjectsInDocument<T extends CanvasObject>(
  deps: SelectionDeps<T>,
  containerId: string,
): Promise<T[]> {
  const objects = await deps.store.readInDocument(containerId);
  // Sort by z-index descending (topmost first for selection)
  return objects.sort((a, b) => b.zIndex - a.zIndex);
}

/**
 * Get all objects in a container that are not in the current selection.
 *
 * Useful for UI operations like "select all" or "invert selection".
 *
 * @param deps - Store dependencies
 * @param containerId - Container to get objects from
 * @param selectedIds - Currently selected object IDs
 * @returns Array of object IDs not in the selection
 */
export async function getUnselectedObjectsInDocument<T extends CanvasObject>(
  deps: SelectionDeps<T>,
  containerId: string,
  selectedIds: string[],
): Promise<string[]> {
  const selectableObjects = await getSelectableObjectsInDocument(deps, containerId);
  const selectedSet = new Set(selectedIds);

  return selectableObjects.filter((obj) => !selectedSet.has(obj.id)).map((obj) => obj.id);
}
