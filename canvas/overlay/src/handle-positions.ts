/**
 * Handle Position Calculation
 *
 * Pure functions to compute resize and rotation handle positions
 * from ScreenBounds. All coordinates are in screen-space CSS pixels.
 *
 * @module @mog/canvas-overlay/handle-positions
 */

import type { HandlePosition, ScreenBounds } from './types';

// =============================================================================
// Resize Handle Positions
// =============================================================================

/**
 * Compute the 8 resize handle positions for a given bounding box.
 *
 * Positions are at the four corners (NW, NE, SE, SW) and four edge
 * midpoints (N, E, S, W) of the unrotated bounding rectangle.
 * Rotation is NOT applied here -- the caller is responsible for
 * rotating the canvas context before drawing at these positions.
 *
 * @param bounds - Screen-space bounds with rotation
 * @returns Array of 8 HandlePosition objects (NW, N, NE, E, SE, S, SW, W)
 */
export function getResizeHandlePositions(bounds: ScreenBounds): HandlePosition[] {
  const { x, y, width, height } = bounds;

  return [
    { x: x, y: y, region: 'resize-nw' },
    { x: x + width / 2, y: y, region: 'resize-n' },
    { x: x + width, y: y, region: 'resize-ne' },
    { x: x + width, y: y + height / 2, region: 'resize-e' },
    { x: x + width, y: y + height, region: 'resize-se' },
    { x: x + width / 2, y: y + height, region: 'resize-s' },
    { x: x, y: y + height, region: 'resize-sw' },
    { x: x, y: y + height / 2, region: 'resize-w' },
  ];
}

// =============================================================================
// Rotation Handle Position
// =============================================================================

/**
 * Compute the rotation handle position above the top-center of the bounds.
 *
 * The handle is placed `offset` CSS pixels above the top edge, centered
 * horizontally. Like resize handles, rotation is not applied here --
 * the caller rotates the canvas context.
 *
 * @param bounds - Screen-space bounds with rotation
 * @param offset - Distance above the top edge in CSS pixels
 * @returns HandlePosition for the rotation handle
 */
export function getRotationHandlePosition(bounds: ScreenBounds, offset: number): HandlePosition {
  return {
    x: bounds.x + bounds.width / 2,
    y: bounds.y - offset,
    region: 'rotation',
  };
}

// =============================================================================
// Corner-Only Handle Positions
// =============================================================================

/**
 * Compute only the 4 corner handle positions.
 *
 * Used for small objects where showing all 8 handles would be too
 * crowded. Only NW, NE, SE, SW are returned.
 *
 * @param bounds - Screen-space bounds with rotation
 * @returns Array of 4 HandlePosition objects (NW, NE, SE, SW)
 */
export function getCornerHandlePositions(bounds: ScreenBounds): HandlePosition[] {
  const { x, y, width, height } = bounds;

  return [
    { x: x, y: y, region: 'resize-nw' },
    { x: x + width, y: y, region: 'resize-ne' },
    { x: x + width, y: y + height, region: 'resize-se' },
    { x: x, y: y + height, region: 'resize-sw' },
  ];
}
