/**
 * Alignment Operations
 *
 * Pure math for aligning floating objects relative to a selection or reference bounds.
 */

import type { BoundingBox } from '@mog-sdk/contracts/geometry';

// =============================================================================
// TYPES
// =============================================================================

/**
 * Available alignment types.
 */
export type AlignType = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';

// =============================================================================
// ALIGNMENT
// =============================================================================

/**
 * Align objects relative to a reference bounding box (or the selection bounds if not provided).
 *
 * @param objects - Objects to align
 * @param alignment - Alignment type
 * @param reference - Reference bounds (defaults to combined bounds of all objects)
 * @returns Array of { id, newBounds } with updated positions
 */
export function alignObjects(
  objects: { id: string; bounds: BoundingBox }[],
  alignment: AlignType,
  reference?: BoundingBox,
): { id: string; newBounds: BoundingBox }[] {
  if (objects.length === 0) return [];

  // Compute reference bounds if not provided
  const ref = reference ?? computeReferenceBounds(objects.map((o) => o.bounds));

  return objects.map(({ id, bounds }) => {
    const newBounds = { ...bounds };

    switch (alignment) {
      case 'left':
        newBounds.x = ref.x;
        break;
      case 'center':
        newBounds.x = ref.x + (ref.width - bounds.width) / 2;
        break;
      case 'right':
        newBounds.x = ref.x + ref.width - bounds.width;
        break;
      case 'top':
        newBounds.y = ref.y;
        break;
      case 'middle':
        newBounds.y = ref.y + (ref.height - bounds.height) / 2;
        break;
      case 'bottom':
        newBounds.y = ref.y + ref.height - bounds.height;
        break;
    }

    return { id, newBounds };
  });
}

// =============================================================================
// INTERNAL HELPERS
// =============================================================================

/**
 * Compute the combined bounding box of multiple boxes.
 */
function computeReferenceBounds(boxes: BoundingBox[]): BoundingBox {
  if (boxes.length === 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const box of boxes) {
    minX = Math.min(minX, box.x);
    minY = Math.min(minY, box.y);
    maxX = Math.max(maxX, box.x + box.width);
    maxY = Math.max(maxY, box.y + box.height);
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}
