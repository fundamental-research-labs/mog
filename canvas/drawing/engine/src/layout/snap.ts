/**
 * Snap Operations
 *
 * Pure math for snapping objects to grids and other objects.
 */

import type { BoundingBox, Point2D } from '@mog-sdk/contracts/geometry';

// =============================================================================
// TYPES
// =============================================================================

/**
 * A visual snap guide line shown to the user.
 */
export interface SnapGuide {
  /** Which axis this guide is on */
  axis: 'horizontal' | 'vertical';
  /** Position of the guide line in pixels */
  position: number;
  /** Type of guide (edge alignment, center alignment, or grid) */
  type: 'edge' | 'center' | 'grid';
}

/**
 * Result of a snap operation.
 */
export interface SnapResult {
  /** Snapped X position */
  x: number;
  /** Snapped Y position */
  y: number;
  /** Whether X was snapped */
  snappedX: boolean;
  /** Whether Y was snapped */
  snappedY: boolean;
  /** Visual guides to display */
  guides: SnapGuide[];
}

// =============================================================================
// GRID SNAPPING
// =============================================================================

/**
 * Snap a position to the nearest grid point.
 *
 * @param position - Current position
 * @param gridSize - Grid cell size in pixels
 * @returns Snapped position with guides
 */
export function snapToGrid(position: Point2D, gridSize: number): SnapResult {
  if (gridSize <= 0) {
    return { x: position.x, y: position.y, snappedX: false, snappedY: false, guides: [] };
  }

  const snappedX = Math.round(position.x / gridSize) * gridSize;
  const snappedY = Math.round(position.y / gridSize) * gridSize;

  const guides: SnapGuide[] = [];

  const didSnapX = snappedX !== position.x;
  const didSnapY = snappedY !== position.y;

  if (didSnapX) {
    guides.push({ axis: 'vertical', position: snappedX, type: 'grid' });
  }
  if (didSnapY) {
    guides.push({ axis: 'horizontal', position: snappedY, type: 'grid' });
  }

  return {
    x: snappedX,
    y: snappedY,
    snappedX: didSnapX,
    snappedY: didSnapY,
    guides,
  };
}

// =============================================================================
// OBJECT SNAPPING
// =============================================================================

/**
 * Snap a moving object to nearby objects (edge and center alignment).
 *
 * Checks for alignment with edges (left, right, top, bottom)
 * and centers (horizontal, vertical) of other objects.
 *
 * @param movingBounds - Bounds of the object being moved
 * @param otherBounds - Bounds of other objects to snap against
 * @param tolerance - Snap tolerance in pixels (how close before snapping)
 * @returns Snapped position with guides
 */
export function snapToObjects(
  movingBounds: BoundingBox,
  otherBounds: BoundingBox[],
  tolerance: number,
): SnapResult {
  let bestDx = Infinity;
  let bestDy = Infinity;
  let snapX = movingBounds.x;
  let snapY = movingBounds.y;
  const guides: SnapGuide[] = [];

  const movingCenterX = movingBounds.x + movingBounds.width / 2;
  const movingCenterY = movingBounds.y + movingBounds.height / 2;
  const movingRight = movingBounds.x + movingBounds.width;
  const movingBottom = movingBounds.y + movingBounds.height;

  for (const other of otherBounds) {
    const otherCenterX = other.x + other.width / 2;
    const otherCenterY = other.y + other.height / 2;
    const otherRight = other.x + other.width;
    const otherBottom = other.y + other.height;

    // --- Vertical alignment (X axis) ---
    const xAlignments: { target: number; movingEdge: number; type: 'edge' | 'center' }[] = [
      // Left edge to left edge
      { target: other.x, movingEdge: movingBounds.x, type: 'edge' },
      // Right edge to right edge
      { target: otherRight, movingEdge: movingRight, type: 'edge' },
      // Left edge to right edge
      { target: other.x, movingEdge: movingRight, type: 'edge' },
      // Right edge to left edge
      { target: otherRight, movingEdge: movingBounds.x, type: 'edge' },
      // Center to center
      { target: otherCenterX, movingEdge: movingCenterX, type: 'center' },
    ];

    for (const align of xAlignments) {
      const dx = Math.abs(align.target - align.movingEdge);
      if (dx <= tolerance && dx < Math.abs(bestDx)) {
        bestDx = align.target - align.movingEdge;
        snapX = movingBounds.x + bestDx;
        // Clear old vertical guides and add new one
        const vertIdx = guides.findIndex((g) => g.axis === 'vertical');
        if (vertIdx >= 0) guides.splice(vertIdx, 1);
        guides.push({ axis: 'vertical', position: align.target, type: align.type });
      }
    }

    // --- Horizontal alignment (Y axis) ---
    const yAlignments: { target: number; movingEdge: number; type: 'edge' | 'center' }[] = [
      // Top edge to top edge
      { target: other.y, movingEdge: movingBounds.y, type: 'edge' },
      // Bottom edge to bottom edge
      { target: otherBottom, movingEdge: movingBottom, type: 'edge' },
      // Top edge to bottom edge
      { target: other.y, movingEdge: movingBottom, type: 'edge' },
      // Bottom edge to top edge
      { target: otherBottom, movingEdge: movingBounds.y, type: 'edge' },
      // Center to center
      { target: otherCenterY, movingEdge: movingCenterY, type: 'center' },
    ];

    for (const align of yAlignments) {
      const dy = Math.abs(align.target - align.movingEdge);
      if (dy <= tolerance && dy < Math.abs(bestDy)) {
        bestDy = align.target - align.movingEdge;
        snapY = movingBounds.y + bestDy;
        // Clear old horizontal guides and add new one
        const horizIdx = guides.findIndex((g) => g.axis === 'horizontal');
        if (horizIdx >= 0) guides.splice(horizIdx, 1);
        guides.push({ axis: 'horizontal', position: align.target, type: align.type });
      }
    }
  }

  return {
    x: snapX,
    y: snapY,
    snappedX: Math.abs(bestDx) <= tolerance && bestDx !== Infinity,
    snappedY: Math.abs(bestDy) <= tolerance && bestDy !== Infinity,
    guides,
  };
}
