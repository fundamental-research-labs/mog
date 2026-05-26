/**
 * Selection State Management
 *
 * Pure functions for managing which objects are selected.
 * Selection state is immutable - all operations return new state.
 */

import type { BoundingBox } from '@mog-sdk/contracts/geometry';

// =============================================================================
// TYPES
// =============================================================================

/**
 * Immutable selection state.
 */
export interface SelectionState {
  /** Set of selected object IDs */
  selectedIds: Set<string>;
  /** The first selected object (anchor for shift-select, etc.) */
  anchorId: string | null;
}

// =============================================================================
// FACTORY
// =============================================================================

/**
 * Create an empty selection.
 */
export function createEmptySelection(): SelectionState {
  return {
    selectedIds: new Set(),
    anchorId: null,
  };
}

// =============================================================================
// OPERATIONS
// =============================================================================

/**
 * Add objects to the selection.
 * Does not add duplicates. Sets anchor to first added if no anchor exists.
 */
export function addToSelection(state: SelectionState, ids: string[]): SelectionState {
  if (ids.length === 0) return state;

  const newIds = new Set(state.selectedIds);
  for (const id of ids) {
    newIds.add(id);
  }

  return {
    selectedIds: newIds,
    anchorId: state.anchorId ?? ids[0],
  };
}

/**
 * Remove objects from the selection.
 * If the anchor is removed, the anchor becomes the first remaining item.
 */
export function removeFromSelection(state: SelectionState, ids: string[]): SelectionState {
  const toRemove = new Set(ids);
  const newIds = new Set<string>();

  for (const id of state.selectedIds) {
    if (!toRemove.has(id)) {
      newIds.add(id);
    }
  }

  let anchorId = state.anchorId;
  if (anchorId && toRemove.has(anchorId)) {
    // Pick new anchor from remaining
    const remaining = Array.from(newIds);
    anchorId = remaining.length > 0 ? remaining[0] : null;
  }

  return { selectedIds: newIds, anchorId };
}

/**
 * Toggle an object in the selection.
 * If selected, deselect; if not selected, add.
 */
export function toggleSelection(state: SelectionState, id: string): SelectionState {
  if (state.selectedIds.has(id)) {
    return removeFromSelection(state, [id]);
  }
  return addToSelection(state, [id]);
}

/**
 * Replace the entire selection with the given IDs.
 */
export function setSelection(ids: string[]): SelectionState {
  return {
    selectedIds: new Set(ids),
    anchorId: ids.length > 0 ? ids[0] : null,
  };
}

/**
 * Get the bounding box of the current selection.
 *
 * @param selectedIds - Currently selected object IDs
 * @param objectBounds - Map of objectId -> BoundingBox for all objects
 * @returns Combined bounding box of selected objects, or null if empty
 */
export function getSelectionBounds(
  selectedIds: Set<string>,
  objectBounds: Map<string, BoundingBox>,
): BoundingBox | null {
  if (selectedIds.size === 0) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let hasValidBounds = false;

  for (const id of selectedIds) {
    const bounds = objectBounds.get(id);
    if (!bounds) continue;

    hasValidBounds = true;
    minX = Math.min(minX, bounds.x);
    minY = Math.min(minY, bounds.y);
    maxX = Math.max(maxX, bounds.x + bounds.width);
    maxY = Math.max(maxY, bounds.y + bounds.height);
  }

  if (!hasValidBounds) return null;

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}
