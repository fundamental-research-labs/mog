/**
 * Selection Bounds (Spreadsheet-Specific)
 *
 * Functions for computing selection bounds in the cell-grid coordinate system.
 * These use IPositionResolver<CellAnchor> to resolve cell anchors to pixel
 * bounds before computing the combined bounding box.
 *
 * Extracted from operations/selection.ts — the cell-grid-specific parts.
 *
 * @see operations/selection.ts - Generic selection operations (validation, filtering)
 * @see cell-anchor-resolver.ts - Cell-grid position resolution
 */

import type { FloatingObject } from '@mog-sdk/contracts/floating-objects';
import type { IObjectStore } from '@mog-sdk/contracts/objects/canvas-object';

import { computeObjectBounds, type CellAnchorResolverDeps } from './cell-anchor-resolver';

// =============================================================================
// TYPES
// =============================================================================

/**
 * Dependencies for selection bounds computation.
 * Combines store access with cell-anchor resolution capabilities.
 */
export interface SelectionBoundsDeps extends CellAnchorResolverDeps {
  store: IObjectStore<FloatingObject>;
}

/**
 * Bounding box of a multi-object selection.
 */
export interface SelectionBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
}

// =============================================================================
// SELECTION BOUNDS OPERATIONS
// =============================================================================

/**
 * Compute the combined bounding box of all selected objects.
 *
 * Resolves each object's cell-based anchor to pixel bounds via the
 * CellAnchorResolver, then computes the minimum bounding rectangle.
 *
 * @param deps - Dependencies (store + computeBridge)
 * @param selectedIds - Array of selected object IDs
 * @returns SelectionBounds or null if no valid objects
 */
export async function computeSelectionBounds(
  deps: SelectionBoundsDeps,
  selectedIds: string[],
): Promise<SelectionBounds | null> {
  const objects = await getSelectedObjects(deps.store, selectedIds);

  if (objects.length === 0) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let hasValidBounds = false;

  for (const obj of objects) {
    const bounds = await computeObjectBounds(deps, obj);
    if (bounds) {
      hasValidBounds = true;
      minX = Math.min(minX, bounds.x);
      minY = Math.min(minY, bounds.y);
      maxX = Math.max(maxX, bounds.x + bounds.width);
      maxY = Math.max(maxY, bounds.y + bounds.height);
    }
  }

  if (!hasValidBounds) return null;

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

/**
 * Get the center point of the selection.
 *
 * @param deps - Dependencies (store + computeBridge)
 * @param selectedIds - Array of selected object IDs
 * @returns Center point {x, y} or null if no valid bounds
 */
export async function getSelectionCenter(
  deps: SelectionBoundsDeps,
  selectedIds: string[],
): Promise<{ x: number; y: number } | null> {
  const bounds = await computeSelectionBounds(deps, selectedIds);
  if (!bounds) return null;

  return {
    x: bounds.minX + bounds.width / 2,
    y: bounds.minY + bounds.height / 2,
  };
}

// =============================================================================
// HELPER
// =============================================================================

/**
 * Get floating objects for a set of selected IDs.
 */
async function getSelectedObjects(
  store: IObjectStore<FloatingObject>,
  selectedIds: string[],
): Promise<FloatingObject[]> {
  const objects: FloatingObject[] = [];
  for (const id of selectedIds) {
    const result = await store.read(id);
    if (result.object) {
      objects.push(result.object);
    }
  }
  return objects;
}
