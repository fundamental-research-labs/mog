/**
 * Chart Position Utilities
 *
 * Pure functions for calculating chart pixel positions from cell-based positions.
 * Used by ChartLayer for CSS transform positioning.
 *
 * @module canvas/chart-position
 */

import type { SheetId } from '@mog-sdk/contracts/core';
import type { HeaderVisibility } from '@mog-sdk/contracts/rendering';
import { getEffectiveHeaderDimensions } from '../shared/constants';
import type { DimensionGetter } from '../viewports';
import { getColLeft, getRowTop } from '../viewports';

// =============================================================================
// Types
// =============================================================================

/**
 * Chart position anchored to cells
 */
export interface ChartPosition {
  /** Anchor row (top-left cell) */
  anchorRow: number;
  /** Anchor column (top-left cell) */
  anchorCol: number;
  /** Width in cells */
  widthCells: number;
  /** Height in cells */
  heightCells: number;
  /** Optional pixel offset within anchor cell */
  offsetX?: number;
  /** Optional pixel offset within anchor cell */
  offsetY?: number;
}

/**
 * Computed pixel position for chart
 */
export interface ChartPixelPosition {
  /** Left position in pixels (relative to grid container) */
  left: number;
  /** Top position in pixels (relative to grid container) */
  top: number;
  /** Width in pixels */
  width: number;
  /** Height in pixels */
  height: number;
  /** Whether chart is visible in viewport */
  visible: boolean;
}

// =============================================================================
// Position Calculation
// =============================================================================

/**
 * Calculate pixel position from cell-based chart position.
 *
 * @param position - Cell-based chart position
 * @param scroll - Current scroll offset
 * @param viewport - Container dimensions
 * @param dimensions - Dimension getter for row/col sizes
 * @param sheetId - Current sheet ID
 * @param headerVisibility - Optional header visibility settings (defaults to both visible)
 * @returns Pixel position with visibility flag
 */
export function calculateChartPixelPosition(
  position: ChartPosition,
  scroll: { top: number; left: number },
  viewport: { width: number; height: number },
  dimensions: DimensionGetter,
  sheetId: SheetId,
  headerVisibility?: HeaderVisibility,
): ChartPixelPosition {
  const { anchorRow, anchorCol, widthCells, heightCells, offsetX = 0, offsetY = 0 } = position;

  // Get effective header dimensions based on visibility
  const { rowHeaderWidth, colHeaderHeight } = getEffectiveHeaderDimensions(headerVisibility);

  // Get absolute pixel position of anchor cell
  const cellTop = getRowTop(sheetId, anchorRow, dimensions);
  const cellLeft = getColLeft(sheetId, anchorCol, dimensions);

  // Calculate width spanning multiple cells
  let width = 0;
  for (let c = 0; c < widthCells; c++) {
    width += dimensions.getColWidth(sheetId, anchorCol + c);
  }

  // Calculate height spanning multiple cells
  let height = 0;
  for (let r = 0; r < heightCells; r++) {
    height += dimensions.getRowHeight(sheetId, anchorRow + r);
  }

  // Adjust for scroll and headers
  const left = cellLeft - scroll.left + rowHeaderWidth + offsetX;
  const top = cellTop - scroll.top + colHeaderHeight + offsetY;

  // Determine visibility (with some buffer for partially visible charts)
  const buffer = 50;
  const visible =
    left + width > rowHeaderWidth - buffer &&
    top + height > colHeaderHeight - buffer &&
    left < viewport.width + buffer &&
    top < viewport.height + buffer;

  return { left, top, width, height, visible };
}
