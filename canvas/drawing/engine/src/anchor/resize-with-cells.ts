/**
 * Resize-With-Cells Computation
 *
 * Pure math for recomputing object bounds when cells resize.
 * Different anchor types behave differently:
 * - twoCell: object moves AND resizes with the cells
 * - oneCell: object moves but does NOT resize
 * - absolute: object doesn't move or resize
 */

import type { BoundingBox } from '@mog-sdk/contracts/geometry';

import { resolveAnchorPoint } from './anchor-resolver';
import type {
  AbsoluteAnchor,
  CellDimensionLookup,
  OneCellAnchor,
  TwoCellAnchor,
} from './anchor-types';

// =============================================================================
// RESIZE COMPUTATION
// =============================================================================

/**
 * Recompute object bounds when cells resize for a twoCell anchor.
 * Both the position and the size change based on anchor cell positions.
 *
 * @param anchor - TwoCell anchor
 * @param _oldDims - Old cell dimensions (unused in twoCell; new dims determine everything)
 * @param newDims - New cell dimensions after resize
 * @returns New bounding box
 */
export function recomputeBoundsOnCellResize(
  anchor: TwoCellAnchor,
  _oldDims: CellDimensionLookup,
  newDims: CellDimensionLookup,
): BoundingBox {
  const fromPos = resolveAnchorPoint(anchor.from, newDims);
  const toPos = resolveAnchorPoint(anchor.to, newDims);
  const rawWidth = toPos.x - fromPos.x;
  const rawHeight = toPos.y - fromPos.y;
  const x = Math.min(fromPos.x, toPos.x);
  const y = Math.min(fromPos.y, toPos.y);
  const width = Math.abs(rawWidth);
  const height = Math.abs(rawHeight);
  return { x, y, width, height };
}

/**
 * Recompute bounds for an absolute anchor (no change).
 * Absolute anchors are not affected by cell resizing.
 *
 * @param anchor - Absolute anchor
 * @returns Same bounding box (unchanged)
 */
export function recomputeAbsoluteBounds(anchor: AbsoluteAnchor): BoundingBox {
  return {
    x: anchor.x,
    y: anchor.y,
    width: anchor.width,
    height: anchor.height,
  };
}

/**
 * Recompute bounds for a oneCell anchor.
 * The object moves with the anchor cell, but its size remains the same.
 *
 * @param anchor - OneCell anchor
 * @param dims - Current cell dimensions
 * @returns New bounding box (position may change, size stays the same)
 */
export function recomputeOneCellBounds(
  anchor: OneCellAnchor,
  dims: CellDimensionLookup,
): BoundingBox {
  const from = resolveAnchorPoint(anchor.from, dims);

  return {
    x: from.x,
    y: from.y,
    width: anchor.width,
    height: anchor.height,
  };
}
