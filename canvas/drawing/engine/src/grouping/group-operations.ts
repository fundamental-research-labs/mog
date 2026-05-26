/**
 * Group Operations
 *
 * Higher-level operations on groups: selection resolution and bounds computation.
 */

import type { BoundingBox } from '@mog-sdk/contracts/geometry';

import type { GroupHierarchy } from './group-manager';
import { getTopLevelGroup } from './group-manager';

// =============================================================================
// SELECTION RESOLUTION
// =============================================================================

/**
 * Resolve which object should be selected when the user clicks.
 *
 * - Single click on an object in a group -> select the whole top-level group
 * - Double click on an object in a group -> select the individual object (drill-in)
 * - Click on ungrouped object -> select that object
 *
 * @param hierarchy - Current group hierarchy
 * @param clickedId - ID of the object that was clicked
 * @param isDoubleClick - Whether this was a double-click
 * @returns The ID that should be selected
 */
export function resolveSelectionTarget(
  hierarchy: GroupHierarchy,
  clickedId: string,
  isDoubleClick: boolean,
): string {
  if (isDoubleClick) {
    // Double-click drills into the group, select the individual object
    return clickedId;
  }

  // Single click: select the top-level group if the object is in one
  const topLevelGroup = getTopLevelGroup(hierarchy, clickedId);
  return topLevelGroup ?? clickedId;
}

// =============================================================================
// BOUNDS COMPUTATION
// =============================================================================

/**
 * Compute the bounding box of a group from its member bounds.
 *
 * @param memberBounds - Array of { id, bounds } for each member
 * @returns Combined bounding box containing all members
 */
export function computeGroupBounds(
  memberBounds: { id: string; bounds: BoundingBox }[],
): BoundingBox {
  if (memberBounds.length === 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const { bounds } of memberBounds) {
    minX = Math.min(minX, bounds.x);
    minY = Math.min(minY, bounds.y);
    maxX = Math.max(maxX, bounds.x + bounds.width);
    maxY = Math.max(maxY, bounds.y + bounds.height);
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}
