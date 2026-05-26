/**
 * Anchor Resolver
 *
 * Pure math functions for resolving anchors to pixel positions.
 * No CellId resolution here - the bridge handles that.
 */

import type { BoundingBox, Point2D } from '@mog-sdk/contracts/geometry';

import type { Anchor, AnchorPoint, CellDimensionLookup, TwoCellAnchor } from './anchor-types';

// =============================================================================
// RESOLVE OPERATIONS
// =============================================================================

/**
 * Resolve an anchor point to a pixel position.
 *
 * @param anchor - Anchor point with pre-resolved row/col
 * @param dims - Cell dimension lookup
 * @returns Pixel position
 */
export function resolveAnchorPoint(anchor: AnchorPoint, dims: CellDimensionLookup): Point2D {
  return {
    x: dims.getColLeft(anchor.col) + anchor.xOffset,
    y: dims.getRowTop(anchor.row) + anchor.yOffset,
  };
}

/**
 * Resolve a full anchor to a bounding box in pixel coordinates.
 *
 * @param anchor - Anchor (twoCell, oneCell, or absolute)
 * @param dims - Cell dimension lookup
 * @returns Bounding box in pixels
 */
export function resolveAnchor(anchor: Anchor, dims: CellDimensionLookup): BoundingBox {
  switch (anchor.type) {
    case 'absolute':
      return {
        x: anchor.x,
        y: anchor.y,
        width: anchor.width,
        height: anchor.height,
      };

    case 'oneCell': {
      const from = resolveAnchorPoint(anchor.from, dims);
      return {
        x: from.x,
        y: from.y,
        width: anchor.width,
        height: anchor.height,
      };
    }

    case 'twoCell': {
      const fromPos = resolveAnchorPoint(anchor.from, dims);
      const toPos = resolveAnchorPoint(anchor.to, dims);
      const rawWidth = toPos.x - fromPos.x;
      const rawHeight = toPos.y - fromPos.y;
      const x = Math.min(fromPos.x, toPos.x);
      const y = Math.min(fromPos.y, toPos.y);
      const width = Math.abs(rawWidth);
      const height = Math.abs(rawHeight);
      return { x, y, width, height };
    }
  }
}

// =============================================================================
// REVERSE RESOLUTION
// =============================================================================

/**
 * Convert a pixel position to an anchor point.
 * Finds which cell contains the position and computes offsets.
 *
 * @param position - Pixel position
 * @param dims - Cell dimension lookup
 * @returns Anchor point with row/col and offsets
 */
export function positionToAnchor(position: Point2D, dims: CellDimensionLookup): AnchorPoint {
  // Clamp input positions to non-negative to avoid negative anchor offsets
  const clampedX = Math.max(0, position.x);
  const clampedY = Math.max(0, position.y);

  // Find column using binary search: O(log n) instead of O(n) linear scan
  let lo = 0,
    hi = 16384;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (dims.getColLeft(mid) + dims.getColWidth(mid) <= clampedX) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  const col = lo;
  const xOffset = clampedX - dims.getColLeft(col);

  // Find row using binary search: O(log n) instead of O(n) linear scan
  lo = 0;
  hi = 1048576;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (dims.getRowTop(mid) + dims.getRowHeight(mid) <= clampedY) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  const row = lo;
  const yOffset = clampedY - dims.getRowTop(row);

  return { row, col, xOffset, yOffset };
}

/**
 * Create a twoCell anchor from a bounding box.
 *
 * @param bounds - Bounding box in pixels
 * @param dims - Cell dimension lookup
 * @returns TwoCellAnchor
 */
export function boundsToTwoCellAnchor(
  bounds: BoundingBox,
  dims: CellDimensionLookup,
): TwoCellAnchor {
  const from = positionToAnchor({ x: bounds.x, y: bounds.y }, dims);
  const to = positionToAnchor({ x: bounds.x + bounds.width, y: bounds.y + bounds.height }, dims);

  return {
    type: 'twoCell',
    from,
    to,
  };
}
