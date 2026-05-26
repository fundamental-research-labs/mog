/**
 * Group Bounds (Spreadsheet-Specific)
 *
 * Functions for computing group bounds in the cell-grid coordinate system.
 * Uses the CellAnchorResolver to resolve cell anchors to pixel bounds
 * before computing combined bounding boxes for groups.
 *
 * Extracted from operations/grouping.ts — the cell-grid-specific parts.
 *
 * computeGroupBounds is now async due to ComputeBridge migration.
 *
 * @see operations/grouping.ts - Generic grouping operations (CRUD)
 * @see cell-anchor-resolver.ts - Cell-grid position resolution
 */

import type { FloatingObject, ObjectPosition } from '@mog-sdk/contracts/floating-objects';

import type { ObjectBounds } from '../types';
import {
  absoluteToAnchorPosition,
  computeObjectBounds,
  type CellAnchorResolverDeps,
} from './cell-anchor-resolver';

// =============================================================================
// GROUP BOUNDS COMPUTATION
// =============================================================================

/**
 * Compute the bounding box for a group of objects.
 *
 * Calculates the minimum bounding rectangle that contains all member objects.
 * Returns both the ObjectPosition (for storage, with cell anchor) and
 * ObjectBounds (for rendering, in pixels).
 *
 * Cell Identity Model:
 * - Uses CellAnchorResolver to resolve CellIds to pixel positions
 * - Converts the computed bounds back to an anchor-based ObjectPosition
 *
 * Async — uses ComputeBridge for dimension queries.
 *
 * @param deps - CellAnchorResolver dependencies (computeBridge)
 * @param objects - Array of floating objects in the group
 * @returns Object containing position (for storage) and bounds (for rendering)
 */
export async function computeGroupBounds(
  deps: CellAnchorResolverDeps,
  objects: FloatingObject[],
): Promise<{
  position: ObjectPosition;
  bounds: ObjectBounds;
}> {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const obj of objects) {
    const bounds = await computeObjectBounds(deps, obj);
    if (!bounds) continue;

    minX = Math.min(minX, bounds.x);
    minY = Math.min(minY, bounds.y);
    maxX = Math.max(maxX, bounds.x + bounds.width);
    maxY = Math.max(maxY, bounds.y + bounds.height);
  }

  // If no objects had computable bounds, return a zero-sized default
  if (minX === Infinity) {
    minX = 0;
    minY = 0;
    maxX = 0;
    maxY = 0;
  }

  const width = maxX - minX;
  const height = maxY - minY;

  // Use the first object's sheetId as the containerId for the anchor position
  const containerId = objects[0].sheetId;

  return {
    position: await absoluteToAnchorPosition(deps, containerId, minX, minY, width, height),
    bounds: { x: minX, y: minY, width, height, rotation: 0 },
  };
}
