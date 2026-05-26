/**
 * Positioning Operations (Universal) -- Pure Pixel-Bounds Math
 *
 * App-agnostic positioning operations that work with CanvasObjectPosition only.
 * No cell-anchor logic, no CellAnchor, no cell-grid dependencies.
 *
 * Cell-anchor specific operations (absoluteToAnchorPosition, computeObjectBounds
 * with cell iteration) belong in the spreadsheet/ adapter layer.
 *
 * @module core/positioning
 */

import type { CanvasObjectPosition } from '@mog-sdk/contracts/objects/canvas-object';

// =============================================================================
// PIXEL MOVE
// =============================================================================

/**
 * Move a position by a pixel delta.
 *
 * Returns a new CanvasObjectPosition with x/y shifted by (dx, dy).
 *
 * @param position - Current resolved pixel position
 * @param dx - Horizontal delta in pixels (positive = right)
 * @param dy - Vertical delta in pixels (positive = down)
 * @returns New position with delta applied
 */
export function moveByPixels(
  position: CanvasObjectPosition,
  dx: number,
  dy: number,
): CanvasObjectPosition {
  return {
    ...position,
    x: position.x + dx,
    y: position.y + dy,
  };
}

// =============================================================================
// PIXEL RESIZE
// =============================================================================

/**
 * Minimum dimension for resize operations (pixels).
 */
const MIN_DIMENSION = 10;

/**
 * Resize a position to new pixel dimensions.
 *
 * Enforces minimum dimensions of 10x10 pixels.
 *
 * @param position - Current resolved pixel position
 * @param width - New width in pixels (minimum 10)
 * @param height - New height in pixels (minimum 10)
 * @returns New position with updated dimensions
 */
export function resizePixels(
  position: CanvasObjectPosition,
  width: number,
  height: number,
): CanvasObjectPosition {
  return {
    ...position,
    width: Math.max(MIN_DIMENSION, width),
    height: Math.max(MIN_DIMENSION, height),
  };
}

// =============================================================================
// PIXEL ROTATE
// =============================================================================

/**
 * Set rotation on a position.
 *
 * The angle is normalized to the range [0, 360) degrees.
 *
 * @param position - Current resolved pixel position
 * @param angle - Rotation angle in degrees
 * @returns New position with updated rotation
 */
export function rotatePixels(position: CanvasObjectPosition, angle: number): CanvasObjectPosition {
  // Normalize angle to 0-360
  const normalizedAngle = ((angle % 360) + 360) % 360;
  return {
    ...position,
    rotation: normalizedAngle,
  };
}

// =============================================================================
// GROUP BOUNDS
// =============================================================================

/**
 * Bounding box result from group bounds computation.
 */
export interface GroupBoundsResult {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Compute the combined bounding box from an array of member positions.
 *
 * Returns the minimum bounding rectangle that contains all provided positions.
 * Returns a zero-sized box at origin if no positions are provided.
 *
 * @param positions - Array of resolved pixel positions for group members
 * @returns Combined bounding box
 */
export function computeGroupBoundsFromMembers(
  positions: CanvasObjectPosition[],
): GroupBoundsResult {
  if (positions.length === 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const pos of positions) {
    minX = Math.min(minX, pos.x);
    minY = Math.min(minY, pos.y);
    maxX = Math.max(maxX, pos.x + pos.width);
    maxY = Math.max(maxY, pos.y + pos.height);
  }

  if (minX === Infinity) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

// =============================================================================
// SELECTION BOUNDS (pixel-based, no anchor resolution)
// =============================================================================

/**
 * Bounding box of a multi-object selection.
 */
export interface SelectionBounds {
  /** Minimum X coordinate (left edge) */
  minX: number;
  /** Minimum Y coordinate (top edge) */
  minY: number;
  /** Maximum X coordinate (right edge) */
  maxX: number;
  /** Maximum Y coordinate (bottom edge) */
  maxY: number;
  /** Total width of selection */
  width: number;
  /** Total height of selection */
  height: number;
}

/**
 * Compute the combined selection bounds from an array of resolved positions.
 *
 * This is the pure pixel-math version. It works on already-resolved
 * CanvasObjectPosition values (after anchor resolution has been done
 * by the app-specific layer).
 *
 * @param positions - Array of resolved pixel positions
 * @returns Selection bounds or null if no positions provided
 */
export function computeSelectionBoundsFromPositions(
  positions: CanvasObjectPosition[],
): SelectionBounds | null {
  if (positions.length === 0) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const pos of positions) {
    minX = Math.min(minX, pos.x);
    minY = Math.min(minY, pos.y);
    maxX = Math.max(maxX, pos.x + pos.width);
    maxY = Math.max(maxY, pos.y + pos.height);
  }

  if (minX === Infinity) return null;

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
 * Get the center point of a selection bounds.
 *
 * @param bounds - Selection bounds
 * @returns Center point {x, y}
 */
export function getSelectionCenterFromBounds(bounds: SelectionBounds): { x: number; y: number } {
  return {
    x: bounds.minX + bounds.width / 2,
    y: bounds.minY + bounds.height / 2,
  };
}
