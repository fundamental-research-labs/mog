/**
 * Transform Math — Pure Geometry Functions
 *
 * Provides resize-bounds and rotation-delta calculations with zero domain
 * dependencies. Extracted from production code at
 * apps/spreadsheet/src/systems/objects/coordination/operation-calculations.ts
 * so that both the canvas-engine overlay and the spreadsheet app can share
 * the same math.
 *
 * All functions are PURE — no side effects, no mutation, easily testable.
 *
 * @module @mog/canvas-engine/geometry/transform-math
 */

import type { Point, Rect } from '../core/types';

// =============================================================================
// Types
// =============================================================================

/** Resize handle direction (8-way compass). */
export type ResizeHandle = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

/** Optional constraints applied during resize. */
export interface ResizeConstraints {
  /** Minimum width in pixels (default: 1). */
  readonly minWidth?: number;
  /** Minimum height in pixels (default: 1). */
  readonly minHeight?: number;
  /** Width/height ratio for aspect-locked resize. */
  readonly aspectRatio?: number;
}

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_MIN_WIDTH = 1;
const DEFAULT_MIN_HEIGHT = 1;

// =============================================================================
// Public API
// =============================================================================

/**
 * Calculate new bounds after a resize operation.
 *
 * Applies the mouse delta to the appropriate edges based on which handle is
 * being dragged, then enforces optional aspect-ratio and minimum-size
 * constraints.
 *
 * @param original  - The bounds before the resize started.
 * @param handle    - Which resize handle is being dragged.
 * @param deltaX    - Horizontal mouse movement since drag start.
 * @param deltaY    - Vertical mouse movement since drag start.
 * @param constraints - Optional min-size and aspect-ratio constraints.
 * @returns New bounds reflecting the resize.
 */
export function calculateResizeBounds(
  original: Rect,
  handle: ResizeHandle,
  deltaX: number,
  deltaY: number,
  constraints?: ResizeConstraints,
): Rect {
  let { x, y, width, height } = original;

  // Horizontal changes
  if (handle.includes('e')) {
    width += deltaX;
  } else if (handle.includes('w')) {
    x += deltaX;
    width -= deltaX;
  }

  // Vertical changes
  if (handle.includes('s')) {
    height += deltaY;
  } else if (handle.includes('n')) {
    y += deltaY;
    height -= deltaY;
  }

  let result: Rect = { x, y, width, height };

  // Aspect-ratio constraint
  if (constraints?.aspectRatio !== undefined) {
    result = applyAspectRatio(result, original, handle, constraints.aspectRatio);
  }

  // Minimum-size constraint
  const minW = constraints?.minWidth ?? DEFAULT_MIN_WIDTH;
  const minH = constraints?.minHeight ?? DEFAULT_MIN_HEIGHT;

  return {
    x: result.x,
    y: result.y,
    width: Math.max(result.width, minW),
    height: Math.max(result.height, minH),
  };
}

/**
 * Apply aspect-ratio constraint to bounds.
 *
 * For corner handles, the resize is scaled proportionally along the dominant
 * axis. For edge handles, the opposite dimension is adjusted to maintain the
 * ratio.
 *
 * @param newBounds   - Calculated bounds without aspect-ratio constraint.
 * @param original    - Original bounds (used for scale computation).
 * @param handle      - Which resize handle is being dragged.
 * @param aspectRatio - Width / height ratio to preserve.
 * @returns Bounds with the aspect ratio preserved.
 */
export function applyAspectRatio(
  newBounds: Rect,
  original: Rect,
  handle: ResizeHandle,
  aspectRatio: number,
): Rect {
  const isCornerHandle = handle === 'ne' || handle === 'nw' || handle === 'se' || handle === 'sw';

  if (isCornerHandle) {
    const scaleX = newBounds.width / original.width;
    const scaleY = newBounds.height / original.height;
    const scale = Math.abs(scaleX) > Math.abs(scaleY) ? scaleX : scaleY;

    const newWidth = original.width * scale;
    const newHeight = original.height * scale;

    let { x, y } = newBounds;
    if (handle.includes('w')) {
      x = original.x + original.width - newWidth;
    }
    if (handle.includes('n')) {
      y = original.y + original.height - newHeight;
    }

    return {
      x,
      y,
      width: Math.abs(newWidth),
      height: Math.abs(newHeight),
    };
  }

  // Edge handles: adjust the opposite dimension
  if (handle === 'e' || handle === 'w') {
    return {
      x: newBounds.x,
      y: newBounds.y,
      width: newBounds.width,
      height: newBounds.width / aspectRatio,
    };
  }

  // handle === 'n' || handle === 's'
  return {
    x: newBounds.x,
    y: newBounds.y,
    width: newBounds.height * aspectRatio,
    height: newBounds.height,
  };
}

/**
 * Calculate the rotation delta (in degrees) between two pointer positions
 * relative to a center point.
 *
 * @param center          - Center of rotation.
 * @param startPosition   - Pointer position at drag start.
 * @param currentPosition - Current pointer position.
 * @returns Rotation delta in degrees (positive = clockwise).
 */
export function calculateRotationDelta(
  center: Point,
  startPosition: Point,
  currentPosition: Point,
): number {
  const startAngle = Math.atan2(startPosition.y - center.y, startPosition.x - center.x);
  const currentAngle = Math.atan2(currentPosition.y - center.y, currentPosition.x - center.x);

  return ((currentAngle - startAngle) * 180) / Math.PI;
}
