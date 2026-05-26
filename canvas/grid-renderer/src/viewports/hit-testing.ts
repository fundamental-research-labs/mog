/**
 * Viewport Hit Testing
 *
 * Pure functions for hit testing against a ViewportLayout.
 * The coordinator uses these to translate screen coordinates to cell coordinates
 * before dispatching events to viewport-agnostic machines.
 *
 * @module canvas/viewports/hit-testing
 */

import { canvasToDocXY, docToCanvasXY } from '@mog/canvas-engine';
import type {
  Point,
  Rect,
  Viewport,
  ViewportDivider,
  ViewportHitResult,
  ViewportLayout,
} from '@mog-sdk/contracts/viewport';

import type { ViewportMergeIndex } from '../coordinates/viewport-merge-index';
import type { ViewportPositionIndex } from '../coordinates/viewport-position-index';

// =============================================================================
// Hit Test Result Types (internal)
// =============================================================================

/**
 * Result of hitting a divider line.
 */
export interface DividerHitResult {
  readonly type: 'divider';
  readonly divider: ViewportDivider;
  readonly index: number;
}

/**
 * Result of hitting empty space.
 */
export interface EmptyHitResult {
  readonly type: 'empty';
}

/**
 * Full hit test result from layout.
 */
export type LayoutHitResult =
  | ({ readonly type: 'viewport' } & ViewportHitResult)
  | DividerHitResult
  | EmptyHitResult;

// =============================================================================
// Geometry Helpers
// =============================================================================

/**
 * Check if a point is inside a rectangle.
 */
function pointInRect(point: Point, rect: Rect): boolean {
  return (
    point.x >= rect.x &&
    point.x < rect.x + rect.width &&
    point.y >= rect.y &&
    point.y < rect.y + rect.height
  );
}

/**
 * Transform a point from canvas space to viewport-local space.
 */
function canvasToLocal(point: Point, viewport: Viewport): Point {
  return {
    x: point.x - viewport.bounds.x,
    y: point.y - viewport.bounds.y,
  };
}

// =============================================================================
// Core Hit Testing Functions
// =============================================================================

/**
 * Find which viewport contains a canvas point.
 * Tests viewports in reverse z-order (top to bottom) since later viewports
 * are rendered on top and should receive input first.
 *
 * @param layout - The current viewport layout
 * @param point - Point in canvas coordinates (CSS pixels)
 * @returns The viewport containing the point, or null if none
 */
export function getViewportAtPoint(layout: ViewportLayout, point: Point): Viewport | null {
  // Test in reverse z-order: last viewport (top) first
  for (let i = layout.viewports.length - 1; i >= 0; i--) {
    const viewport = layout.viewports[i];
    if (pointInRect(point, viewport.bounds)) {
      return viewport;
    }
  }
  return null;
}

/**
 * Convert a canvas point to a cell coordinate within a specific viewport.
 * The point is assumed to be within the viewport's bounds.
 *
 * The transformation accounts for both viewportOrigin and scrollOffset:
 *   docCoord = localCoord + viewportOrigin + scrollOffset
 *
 * @param viewport - The viewport to convert within
 * @param point - Point in canvas coordinates (CSS pixels)
 * @param positionIndex - Viewport position index for O(1) lookups
 * @param mergeIndex - Viewport merge index for O(1) merge lookups
 * @returns Cell coordinate, or null if point is outside cell grid
 */
export function canvasToCell(
  viewport: Viewport,
  point: Point,
  positionIndex: ViewportPositionIndex,
  mergeIndex: ViewportMergeIndex,
): { row: number; col: number } | null {
  // 1. Transform canvas point to document coordinates via canonical helper.
  //    Viewport structurally satisfies RegionTransform (bounds, viewportOrigin,
  //    scrollOffset, zoom — all readonly), so it threads through directly.
  const { x: docX, y: docY } = canvasToDocXY(point.x, point.y, viewport);

  // 2. Find row by binary search
  const row = findRowAtY(
    docY,
    positionIndex,
    viewport.cellRange.startRow,
    viewport.cellRange.endRow,
  );
  if (row === null) return null;

  // 3. Find column by binary search
  const col = findColAtX(
    docX,
    positionIndex,
    viewport.cellRange.startCol,
    viewport.cellRange.endCol,
  );
  if (col === null) return null;

  // 4. Check for merged regions and return top-left of merge
  const merged = mergeIndex.getMergedRegion(row, col);
  if (merged) {
    return { row: merged.startRow, col: merged.startCol };
  }

  return { row, col };
}

/**
 * Binary search to find the row at a given Y coordinate in document space.
 */
function findRowAtY(
  docY: number,
  pi: ViewportPositionIndex,
  minRow: number,
  maxRow: number,
): number | null {
  if (docY < 0) return null;

  let low = minRow;
  let high = Math.min(maxRow, pi.totalRows - 1);

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const rowTop = pi.getRowTop(mid);
    const rowBottom = rowTop + pi.getRowHeight(mid);

    if (docY < rowTop) {
      high = mid - 1;
    } else if (docY >= rowBottom) {
      low = mid + 1;
    } else {
      // Found it - but skip hidden rows
      if (pi.isRowHidden(mid)) {
        // Find next visible row
        for (let r = mid + 1; r <= maxRow; r++) {
          if (!pi.isRowHidden(r)) return r;
        }
        return null;
      }
      return mid;
    }
  }

  return null;
}

/**
 * Binary search to find the column at a given X coordinate in document space.
 */
function findColAtX(
  docX: number,
  pi: ViewportPositionIndex,
  minCol: number,
  maxCol: number,
): number | null {
  if (docX < 0) return null;

  let low = minCol;
  let high = Math.min(maxCol, pi.totalCols - 1);

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const colLeft = pi.getColLeft(mid);
    const colRight = colLeft + pi.getColWidth(mid);

    if (docX < colLeft) {
      high = mid - 1;
    } else if (docX >= colRight) {
      low = mid + 1;
    } else {
      // Found it - but skip hidden columns
      if (pi.isColHidden(mid)) {
        // Find next visible column
        for (let c = mid + 1; c <= maxCol; c++) {
          if (!pi.isColHidden(c)) return c;
        }
        return null;
      }
      return mid;
    }
  }

  return null;
}

// =============================================================================
// Full Layout Hit Testing
// =============================================================================

/**
 * Tolerance in pixels for hitting divider lines.
 */
const DIVIDER_HIT_TOLERANCE = 4;

/**
 * Hit test a point against the complete viewport layout.
 * Checks dividers first (they're on top), then viewports.
 *
 * @param layout - The current viewport layout
 * @param point - Point in canvas coordinates
 * @param positionIndex - Viewport position index for O(1) lookups
 * @param mergeIndex - Viewport merge index for O(1) merge lookups
 * @returns Hit test result indicating what was hit
 */
export function hitTestLayout(
  layout: ViewportLayout,
  point: Point,
  positionIndex: ViewportPositionIndex,
  mergeIndex: ViewportMergeIndex,
): LayoutHitResult {
  // 1. Check dividers first (they're interactive elements on top)
  const dividerHit = hitTestDividers(layout.dividers, point);
  if (dividerHit) {
    return dividerHit;
  }

  // 2. Check viewports in reverse z-order
  const viewport = getViewportAtPoint(layout, point);
  if (!viewport) {
    return { type: 'empty' };
  }

  // 3. Convert to cell coordinate
  const cell = canvasToCell(viewport, point, positionIndex, mergeIndex);
  if (!cell) {
    return { type: 'empty' };
  }

  // 4. Calculate local point for additional hit testing (e.g., resize handles)
  const localPoint = canvasToLocal(point, viewport);

  return {
    type: 'viewport',
    viewport,
    cell,
    localPoint,
  };
}

/**
 * Hit test dividers.
 */
function hitTestDividers(
  dividers: readonly ViewportDivider[],
  point: Point,
): DividerHitResult | null {
  for (let i = dividers.length - 1; i >= 0; i--) {
    const divider = dividers[i];

    if (divider.orientation === 'horizontal') {
      // Horizontal divider: check Y tolerance
      if (Math.abs(point.y - divider.position) <= DIVIDER_HIT_TOLERANCE) {
        return { type: 'divider', divider, index: i };
      }
    } else {
      // Vertical divider: check X tolerance
      if (Math.abs(point.x - divider.position) <= DIVIDER_HIT_TOLERANCE) {
        return { type: 'divider', divider, index: i };
      }
    }
  }
  return null;
}

// =============================================================================
// Cell Position Within Viewport
// =============================================================================

/**
 * Get the bounds of a cell within a viewport (viewport-local coordinates).
 * Returns null if the cell is not visible in this viewport.
 *
 * The transformation accounts for both viewportOrigin and scrollOffset:
 *   localCoord = (docCoord - viewportOrigin - scrollOffset) * zoom
 *
 * @param viewport - The viewport
 * @param row - Cell row
 * @param col - Cell column
 * @param positionIndex - Viewport position index for O(1) lookups
 * @returns Rect in viewport-local coordinates, or null
 */
export function getCellBoundsInViewport(
  viewport: Viewport,
  row: number,
  col: number,
  positionIndex: ViewportPositionIndex,
): Rect | null {
  // Check if cell is within viewport's cell range
  const range = viewport.cellRange;
  if (row < range.startRow || row > range.endRow || col < range.startCol || col > range.endCol) {
    return null;
  }

  // Get cell position in document space
  const pi = positionIndex;
  const cellLeft = pi.getColLeft(col);
  const cellTop = pi.getRowTop(row);
  const cellWidth = pi.getColWidth(col);
  const cellHeight = pi.getRowHeight(row);

  // Transform doc-space cell origin to canvas-absolute via canonical helper,
  // then translate to viewport-local (canvas-relative-zoomed) by subtracting
  // the viewport's bounds origin. Width/height scale by zoom directly.
  const canvasOrigin = docToCanvasXY(cellLeft, cellTop, viewport);
  const localX = canvasOrigin.x - viewport.bounds.x;
  const localY = canvasOrigin.y - viewport.bounds.y;
  const width = cellWidth * viewport.zoom;
  const height = cellHeight * viewport.zoom;

  // Check if visible within viewport bounds
  if (
    localX + width < 0 ||
    localX > viewport.bounds.width ||
    localY + height < 0 ||
    localY > viewport.bounds.height
  ) {
    return null;
  }

  return { x: localX, y: localY, width, height };
}

/**
 * Get the canvas-space bounds of a cell within a viewport.
 * Returns null if the cell is not visible.
 */
export function getCellCanvasBounds(
  viewport: Viewport,
  row: number,
  col: number,
  positionIndex: ViewportPositionIndex,
): Rect | null {
  const local = getCellBoundsInViewport(viewport, row, col, positionIndex);
  if (!local) return null;

  // Add viewport position to get canvas coordinates
  return {
    x: local.x + viewport.bounds.x,
    y: local.y + viewport.bounds.y,
    width: local.width,
    height: local.height,
  };
}
