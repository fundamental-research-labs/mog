/**
 * Distribution Operations
 *
 * Pure math for distributing floating objects evenly along an axis.
 */

import type { BoundingBox } from '@mog-sdk/contracts/geometry';

// =============================================================================
// TYPES
// =============================================================================

/**
 * Distribution direction.
 */
export type DistributeType = 'horizontal' | 'vertical';

// =============================================================================
// DISTRIBUTION
// =============================================================================

/**
 * Distribute objects evenly along an axis.
 *
 * Objects are distributed so that the spacing between them is equal.
 * The first and last objects (by position) stay in place; interior objects move.
 *
 * Requires at least 3 objects to have any effect.
 *
 * @param objects - Objects to distribute
 * @param direction - 'horizontal' or 'vertical'
 * @returns Array of { id, newBounds } with updated positions
 */
export function distributeObjects(
  objects: { id: string; bounds: BoundingBox }[],
  direction: DistributeType,
): { id: string; newBounds: BoundingBox }[] {
  if (objects.length < 3) {
    // Nothing to distribute with fewer than 3 objects
    return objects.map(({ id, bounds }) => ({ id, newBounds: { ...bounds } }));
  }

  // Sort by position along the distribution axis
  const sorted = [...objects].sort((a, b) => {
    if (direction === 'horizontal') {
      return a.bounds.x - b.bounds.x;
    }
    return a.bounds.y - b.bounds.y;
  });

  const first = sorted[0];
  const last = sorted[sorted.length - 1];

  if (direction === 'horizontal') {
    // Calculate total available space and total object width
    const totalSpan = last.bounds.x + last.bounds.width - first.bounds.x;
    const totalObjectWidth = sorted.reduce((sum, o) => sum + o.bounds.width, 0);
    const totalGap = totalSpan - totalObjectWidth;
    const gapBetween = totalGap / (sorted.length - 1);

    // Place objects: first stays, then gap, then object, etc.
    let currentX = first.bounds.x + first.bounds.width + gapBetween;

    const result = new Map<string, BoundingBox>();
    result.set(first.id, { ...first.bounds });

    for (let i = 1; i < sorted.length - 1; i++) {
      result.set(sorted[i].id, {
        ...sorted[i].bounds,
        x: currentX,
      });
      currentX += sorted[i].bounds.width + gapBetween;
    }

    result.set(last.id, { ...last.bounds });

    return objects.map(({ id, bounds }) => ({
      id,
      newBounds: result.get(id) ?? { ...bounds },
    }));
  } else {
    // Vertical distribution
    const totalSpan = last.bounds.y + last.bounds.height - first.bounds.y;
    const totalObjectHeight = sorted.reduce((sum, o) => sum + o.bounds.height, 0);
    const totalGap = totalSpan - totalObjectHeight;
    const gapBetween = totalGap / (sorted.length - 1);

    let currentY = first.bounds.y + first.bounds.height + gapBetween;

    const result = new Map<string, BoundingBox>();
    result.set(first.id, { ...first.bounds });

    for (let i = 1; i < sorted.length - 1; i++) {
      result.set(sorted[i].id, {
        ...sorted[i].bounds,
        y: currentY,
      });
      currentY += sorted[i].bounds.height + gapBetween;
    }

    result.set(last.id, { ...last.bounds });

    return objects.map(({ id, bounds }) => ({
      id,
      newBounds: result.get(id) ?? { ...bounds },
    }));
  }
}
