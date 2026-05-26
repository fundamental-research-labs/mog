/**
 * Merged Cell Handling
 *
 * Computes merged cell bounds and determines rendering behavior for cells
 * that span multiple rows/columns. Handles the complex case of merges
 * spanning across frozen/scrolling viewport boundaries.
 *
 * Origin-only rendering: only the merge origin cell renders the full merge.
 * Cross-viewport merges: when the origin is in another viewport region,
 * the first visible cell of the merge renders it, clipped to its region.
 *
 * Ported from grid-canvas/src/layers/cells/merged-cell-utils.ts.
 *
 * @module grid-renderer/cells/merged-cells
 */

import type { RenderRegion } from '@mog/canvas-engine';
import type { CellRange } from '@mog-sdk/contracts/core';
import type { CellCoord } from '@mog-sdk/contracts/rendering';
import type { ViewportPositionIndex } from '../coordinates/viewport-position-index';
import { docToRegionXY } from '../shared/cell-bounds';

// =============================================================================
// Types
// =============================================================================

/**
 * Computed bounds of a cell (or merged cell) in region-local UNZOOMED
 * pixels (the coordinate system per-region layers paint in).
 */
export interface CellBounds {
  /** X position in region-local unzoomed pixels */
  x: number;
  /** Y position in region-local unzoomed pixels */
  y: number;
  /** Total width in region-local unzoomed pixels */
  width: number;
  /** Total height in region-local unzoomed pixels */
  height: number;
}

/**
 * Result of getMergedCellRenderInfo indicating how to render a cell.
 */
export interface MergedCellRenderResult {
  /** Whether this cell should be rendered at all */
  shouldRender: boolean;
  /** Whether to render using merged region bounds */
  shouldRenderAsMerge: boolean;
  /** The cell to use for data lookup (may differ from display cell for merges) */
  dataCell: CellCoord;
}

// =============================================================================
// Cell Bounds Computation
// =============================================================================

/**
 * Compute cell bounds, handling merged regions.
 *
 * For merged cells, calculates the total width and height by summing
 * all rows and columns in the merged region. For normal cells, returns
 * the single cell's dimensions.
 *
 * The viewport-relative position is computed via the canonical
 * `docToRegionXY` helper (which composes `docToCanvasXY`), so the
 * `docCoord - viewportOrigin - scrollOffset` formula lives in exactly
 * one place (canvas-engine/coordinate-space.ts).
 *
 * @param dimensionProvider - Provider for row/column dimensions
 * @param region - The render region (carries viewportOrigin + scrollOffset)
 * @param row - Cell row
 * @param col - Cell column
 * @param mergedRegion - Merged region if cell is part of one
 * @returns Cell bounds (x, y, width, height) in region-local UNZOOMED coords
 */
export function computeCellBounds(
  dimensionProvider: ViewportPositionIndex,
  region: RenderRegion,
  row: number,
  col: number,
  mergedRegion: CellRange | null,
): CellBounds {
  if (mergedRegion) {
    let width = 0;
    for (let c = mergedRegion.startCol; c <= mergedRegion.endCol; c++) {
      width += dimensionProvider.getColWidth(c);
    }
    let height = 0;
    for (let r = mergedRegion.startRow; r <= mergedRegion.endRow; r++) {
      height += dimensionProvider.getRowHeight(r);
    }
    const { x, y } = docToRegionXY(
      dimensionProvider.getColLeft(mergedRegion.startCol),
      dimensionProvider.getRowTop(mergedRegion.startRow),
      region,
    );
    return { x, y, width, height };
  }
  const { x, y } = docToRegionXY(
    dimensionProvider.getColLeft(col),
    dimensionProvider.getRowTop(row),
    region,
  );
  return {
    x,
    y,
    width: dimensionProvider.getColWidth(col),
    height: dimensionProvider.getRowHeight(row),
  };
}

// =============================================================================
// Merged Cell Render Info
// =============================================================================

/**
 * Determine if a cell should be rendered as a merge in this viewport.
 * Handles the complex case of merges that span frozen and scrollable regions.
 *
 * Freeze Pane Handling:
 * When a merged cell spans across freeze pane boundaries, the merge origin
 * may be in a different viewport region than the current cell. In this case,
 * we need to:
 * 1. Skip non-origin cells if the origin is in the same viewport
 * 2. Render the first visible cell of the merge if the origin is outside
 * 3. Use the merge origin's data for display but render at the visible position
 *
 * @param cell - Current cell position
 * @param mergedRegion - Merged region the cell belongs to (null if not merged)
 * @param cellRange - Visible cell range in the viewport
 * @returns Object with rendering info
 */
export function getMergedCellRenderInfo(
  cell: CellCoord,
  mergedRegion: CellRange | null,
  cellRange: CellRange,
): MergedCellRenderResult {
  const { row, col } = cell;

  // Not in a merge - always render normally
  if (mergedRegion === null) {
    return {
      shouldRender: true,
      shouldRenderAsMerge: false,
      dataCell: cell,
    };
  }

  const isMergeOrigin = row === mergedRegion.startRow && col === mergedRegion.startCol;

  // Check if the merge origin is within the current viewport's cell range
  const mergeOriginInThisViewport =
    mergedRegion.startRow >= cellRange.startRow &&
    mergedRegion.startRow <= cellRange.endRow &&
    mergedRegion.startCol >= cellRange.startCol &&
    mergedRegion.startCol <= cellRange.endCol;

  // If this is the merge origin, always render it as a merge
  if (isMergeOrigin) {
    return {
      shouldRender: true,
      shouldRenderAsMerge: true,
      dataCell: cell,
    };
  }

  // This is a non-origin cell in a merged region
  // Skip if the origin is in this viewport (it will render the whole merge)
  if (mergeOriginInThisViewport) {
    return {
      shouldRender: false,
      shouldRenderAsMerge: false,
      dataCell: cell,
    };
  }

  // Origin is outside this viewport (freeze pane case)
  // Only render if this is the first merge cell visible in this viewport
  const isFirstMergeCellInViewport =
    row === Math.max(mergedRegion.startRow, cellRange.startRow) &&
    col === Math.max(mergedRegion.startCol, cellRange.startCol);

  if (!isFirstMergeCellInViewport) {
    return {
      shouldRender: false,
      shouldRenderAsMerge: false,
      dataCell: cell,
    };
  }

  // This is the first visible cell of a merge whose origin is outside viewport
  // Render it as a merge but use the origin's data
  return {
    shouldRender: true,
    shouldRenderAsMerge: true,
    dataCell: { row: mergedRegion.startRow, col: mergedRegion.startCol },
  };
}

// =============================================================================
// Merge Deduplication Tracker
// =============================================================================

/**
 * Tracks which merge regions have already been rendered in the current frame.
 * Prevents double-rendering when iterating across multiple viewport regions.
 *
 * Usage:
 *   const tracker = createMergeTracker();
 *   // For each region:
 *   //   For each cell in region:
 *   //     if cell is in merge and tracker.shouldRender(mergeId) ...
 *   tracker.clear(); // at start of each frame
 */
export interface MergeTracker {
  /**
   * Check if a merge should be rendered (has not been rendered yet this frame).
   * If returning true, marks the merge as rendered.
   *
   * @param mergeKey - Unique key for the merge (e.g., "startRow,startCol")
   * @returns true if this merge has NOT been rendered yet (caller should render it)
   */
  shouldRender(mergeKey: string): boolean;

  /** Clear all tracked merges (call at start of each frame) */
  clear(): void;
}

/**
 * Create a merge deduplication tracker.
 *
 * @returns A new MergeTracker instance
 */
export function createMergeTracker(): MergeTracker {
  const rendered = new Set<string>();

  return {
    shouldRender(mergeKey: string): boolean {
      if (rendered.has(mergeKey)) {
        return false;
      }
      rendered.add(mergeKey);
      return true;
    },

    clear(): void {
      rendered.clear();
    },
  };
}

/**
 * Create a merge key from a CellRange (the merge region).
 * Uses the origin cell as the unique identifier.
 */
export function mergeKey(region: CellRange): string {
  return `${region.startRow},${region.startCol}`;
}
