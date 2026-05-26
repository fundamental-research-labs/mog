/**
 * Viewport calculations for virtual scrolling
 *
 * Calculates which rows and columns are visible based on:
 * - Scroll position (scrollTop, scrollLeft)
 * - Container dimensions (width, height)
 * - Row heights and column widths (with overrides for resized rows/cols)
 *
 * Only visible cells (+ buffer) are rendered for performance.
 */

import type { SheetId } from '@mog-sdk/contracts/core';
import { MAX_COLS, MAX_ROWS } from '@mog-sdk/contracts/core';
import type { HeaderVisibility } from '@mog-sdk/contracts/rendering';
import {
  BUFFER_COLS,
  BUFFER_ROWS,
  DEFAULT_COL_WIDTH,
  DEFAULT_ROW_HEIGHT,
  getEffectiveHeaderDimensions,
} from '../shared/constants';

// =============================================================================
// Types
// =============================================================================

export interface VisibleRange {
  /** First visible row (0-indexed) */
  startRow: number;
  /** Last visible row (inclusive) */
  endRow: number;
  /** First visible column (0-indexed) */
  startCol: number;
  /** Last visible column (inclusive) */
  endCol: number;
}

export interface ViewportInfo extends VisibleRange {
  /** Pixel offset from top of grid to first visible row */
  offsetY: number;
  /** Pixel offset from left of grid to first visible column */
  offsetX: number;
  /** Total content height (for scrollbar) */
  totalHeight: number;
  /** Total content width (for scrollbar) */
  totalWidth: number;
}

export interface DimensionGetter {
  getRowHeight: (sheetId: SheetId, row: number) => number;
  getColWidth: (sheetId: SheetId, col: number) => number;
}

// =============================================================================
// Viewport Calculator
// =============================================================================

/**
 * Calculate the visible range of rows and columns.
 * Includes buffer rows/cols for smooth scrolling.
 *
 * @param scrollTop - Vertical scroll position
 * @param scrollLeft - Horizontal scroll position
 * @param containerWidth - Container width in pixels
 * @param containerHeight - Container height in pixels
 * @param sheetId - Sheet ID
 * @param dimensions - Dimension getter for row/column sizes
 * @param headerVisibility - Optional header visibility settings (defaults to both visible)
 */
export function calculateViewport(
  scrollTop: number,
  scrollLeft: number,
  containerWidth: number,
  containerHeight: number,
  sheetId: SheetId,
  dimensions: DimensionGetter,
  headerVisibility?: HeaderVisibility,
): ViewportInfo {
  // Get effective header dimensions based on visibility
  const { rowHeaderWidth, colHeaderHeight } = getEffectiveHeaderDimensions(headerVisibility);

  // Available space for cells (excluding headers)
  const gridWidth = containerWidth - rowHeaderWidth;
  const gridHeight = containerHeight - colHeaderHeight;

  // Find first visible row
  let startRow = 0;
  let accumulatedHeight = 0;
  let offsetY = 0;

  while (startRow < MAX_ROWS) {
    const rowHeight = dimensions.getRowHeight(sheetId, startRow);
    if (accumulatedHeight + rowHeight > scrollTop) {
      offsetY = accumulatedHeight - scrollTop;
      break;
    }
    accumulatedHeight += rowHeight;
    startRow++;
  }

  // Apply buffer (go back some rows)
  const bufferedStartRow = Math.max(0, startRow - BUFFER_ROWS);
  if (bufferedStartRow < startRow) {
    // Recalculate offsetY for buffered start
    let recalcHeight = 0;
    for (let r = bufferedStartRow; r < startRow; r++) {
      recalcHeight += dimensions.getRowHeight(sheetId, r);
    }
    offsetY -= recalcHeight;
    startRow = bufferedStartRow;
  }

  // Find last visible row
  let endRow = startRow;
  let heightSum = 0;
  const targetHeight = gridHeight + Math.abs(offsetY) + BUFFER_ROWS * DEFAULT_ROW_HEIGHT;

  while (endRow < MAX_ROWS && heightSum < targetHeight) {
    heightSum += dimensions.getRowHeight(sheetId, endRow);
    endRow++;
  }
  endRow = Math.min(endRow + BUFFER_ROWS, MAX_ROWS - 1);

  // Find first visible column
  let startCol = 0;
  let accumulatedWidth = 0;
  let offsetX = 0;

  while (startCol < MAX_COLS) {
    const colWidth = dimensions.getColWidth(sheetId, startCol);
    if (accumulatedWidth + colWidth > scrollLeft) {
      offsetX = accumulatedWidth - scrollLeft;
      break;
    }
    accumulatedWidth += colWidth;
    startCol++;
  }

  // Apply buffer (go back some cols)
  const bufferedStartCol = Math.max(0, startCol - BUFFER_COLS);
  if (bufferedStartCol < startCol) {
    let recalcWidth = 0;
    for (let c = bufferedStartCol; c < startCol; c++) {
      recalcWidth += dimensions.getColWidth(sheetId, c);
    }
    offsetX -= recalcWidth;
    startCol = bufferedStartCol;
  }

  // Find last visible column
  let endCol = startCol;
  let widthSum = 0;
  const targetWidth = gridWidth + Math.abs(offsetX) + BUFFER_COLS * DEFAULT_COL_WIDTH;

  while (endCol < MAX_COLS && widthSum < targetWidth) {
    widthSum += dimensions.getColWidth(sheetId, endCol);
    endCol++;
  }
  endCol = Math.min(endCol + BUFFER_COLS, MAX_COLS - 1);

  // Calculate total content size (approximate for scrollbar)
  // For performance, we estimate rather than summing all 1M+ rows
  const totalHeight = estimateTotalHeight(sheetId, dimensions);
  const totalWidth = estimateTotalWidth(sheetId, dimensions);

  return {
    startRow,
    endRow,
    startCol,
    endCol,
    offsetX,
    offsetY,
    totalHeight,
    totalWidth,
  };
}

/**
 * Estimate total grid height for scrollbar.
 * Uses default row height for most rows to avoid O(n) calculation.
 */
function estimateTotalHeight(_sheetId: SheetId, _dimensions: DimensionGetter): number {
  // For MVP, assume all rows use default height
  // Future: Track sum of custom heights and adjust
  return MAX_ROWS * DEFAULT_ROW_HEIGHT;
}

/**
 * Estimate total grid width for scrollbar.
 */
function estimateTotalWidth(_sheetId: SheetId, _dimensions: DimensionGetter): number {
  // For MVP, assume all cols use default width
  return MAX_COLS * DEFAULT_COL_WIDTH;
}

// =============================================================================
// Position Calculations
// =============================================================================

/**
 * Get the pixel position of a row's top edge.
 */
export function getRowTop(sheetId: SheetId, row: number, dimensions: DimensionGetter): number {
  let top = 0;
  for (let r = 0; r < row; r++) {
    top += dimensions.getRowHeight(sheetId, r);
  }
  return top;
}

/**
 * Get the pixel position of a column's left edge.
 */
export function getColLeft(sheetId: SheetId, col: number, dimensions: DimensionGetter): number {
  let left = 0;
  for (let c = 0; c < col; c++) {
    left += dimensions.getColWidth(sheetId, c);
  }
  return left;
}

/**
 * Convert pixel coordinates to row/col indices.
 * Returns null if outside grid bounds.
 *
 * @param x - X coordinate in viewport pixels
 * @param y - Y coordinate in viewport pixels
 * @param scrollTop - Vertical scroll position
 * @param scrollLeft - Horizontal scroll position
 * @param sheetId - Sheet ID
 * @param dimensions - Dimension getter for row/column sizes
 * @param headerVisibility - Optional header visibility settings (defaults to both visible)
 */
export function pixelToCell(
  x: number,
  y: number,
  scrollTop: number,
  scrollLeft: number,
  sheetId: SheetId,
  dimensions: DimensionGetter,
  headerVisibility?: HeaderVisibility,
): { row: number; col: number } | null {
  // Get effective header dimensions based on visibility
  const { rowHeaderWidth, colHeaderHeight } = getEffectiveHeaderDimensions(headerVisibility);

  // Adjust for headers
  const gridX = x - rowHeaderWidth;
  const gridY = y - colHeaderHeight;

  // Check if in header area
  if (gridX < 0 || gridY < 0) {
    return null;
  }

  // Add scroll offset
  const absoluteX = gridX + scrollLeft;
  const absoluteY = gridY + scrollTop;

  // Find row
  let row = 0;
  let accY = 0;
  while (row < MAX_ROWS) {
    const h = dimensions.getRowHeight(sheetId, row);
    if (accY + h > absoluteY) break;
    accY += h;
    row++;
  }

  // Find col
  let col = 0;
  let accX = 0;
  while (col < MAX_COLS) {
    const w = dimensions.getColWidth(sheetId, col);
    if (accX + w > absoluteX) break;
    accX += w;
    col++;
  }

  if (row >= MAX_ROWS || col >= MAX_COLS) {
    return null;
  }

  return { row, col };
}

/**
 * Check if clicking on row header.
 *
 * @param x - X coordinate in viewport pixels
 * @param headerVisibility - Optional header visibility settings (defaults to both visible)
 */
export function isRowHeader(x: number, headerVisibility?: HeaderVisibility): boolean {
  const { rowHeaderWidth } = getEffectiveHeaderDimensions(headerVisibility);
  return x < rowHeaderWidth;
}

/**
 * Check if clicking on column header.
 *
 * @param y - Y coordinate in viewport pixels
 * @param headerVisibility - Optional header visibility settings (defaults to both visible)
 */
export function isColHeader(y: number, headerVisibility?: HeaderVisibility): boolean {
  const { colHeaderHeight } = getEffectiveHeaderDimensions(headerVisibility);
  return y < colHeaderHeight;
}

/**
 * Get row index from y position in row header.
 *
 * @param y - Y coordinate in viewport pixels
 * @param scrollTop - Vertical scroll position
 * @param sheetId - Sheet ID
 * @param dimensions - Dimension getter for row sizes
 * @param headerVisibility - Optional header visibility settings (defaults to both visible)
 */
export function getRowFromHeaderY(
  y: number,
  scrollTop: number,
  sheetId: SheetId,
  dimensions: DimensionGetter,
  headerVisibility?: HeaderVisibility,
): number | null {
  const { colHeaderHeight } = getEffectiveHeaderDimensions(headerVisibility);
  const gridY = y - colHeaderHeight;
  if (gridY < 0) return null;

  const absoluteY = gridY + scrollTop;
  let row = 0;
  let accY = 0;

  while (row < MAX_ROWS) {
    const h = dimensions.getRowHeight(sheetId, row);
    if (accY + h > absoluteY) return row;
    accY += h;
    row++;
  }

  return null;
}

/**
 * Get column index from x position in column header.
 *
 * @param x - X coordinate in viewport pixels
 * @param scrollLeft - Horizontal scroll position
 * @param sheetId - Sheet ID
 * @param dimensions - Dimension getter for column sizes
 * @param headerVisibility - Optional header visibility settings (defaults to both visible)
 */
export function getColFromHeaderX(
  x: number,
  scrollLeft: number,
  sheetId: SheetId,
  dimensions: DimensionGetter,
  headerVisibility?: HeaderVisibility,
): number | null {
  const { rowHeaderWidth } = getEffectiveHeaderDimensions(headerVisibility);
  const gridX = x - rowHeaderWidth;
  if (gridX < 0) return null;

  const absoluteX = gridX + scrollLeft;
  let col = 0;
  let accX = 0;

  while (col < MAX_COLS) {
    const w = dimensions.getColWidth(sheetId, col);
    if (accX + w > absoluteX) return col;
    accX += w;
    col++;
  }

  return null;
}

// =============================================================================
// Resize Handle Detection
// =============================================================================

const RESIZE_HANDLE_SIZE = 5; // pixels

export interface ResizeHandle {
  type: 'row' | 'col';
  index: number;
}

/**
 * Check if mouse is over a resize handle in headers.
 *
 * @param x - X coordinate in viewport pixels
 * @param y - Y coordinate in viewport pixels
 * @param scrollTop - Vertical scroll position
 * @param scrollLeft - Horizontal scroll position
 * @param sheetId - Sheet ID
 * @param dimensions - Dimension getter for row/column sizes
 * @param headerVisibility - Optional header visibility settings (defaults to both visible)
 */
export function getResizeHandle(
  x: number,
  y: number,
  scrollTop: number,
  scrollLeft: number,
  sheetId: SheetId,
  dimensions: DimensionGetter,
  headerVisibility?: HeaderVisibility,
): ResizeHandle | null {
  const { rowHeaderWidth, colHeaderHeight } = getEffectiveHeaderDimensions(headerVisibility);

  // Row resize handle (bottom edge of row header)
  if (x < rowHeaderWidth && y > colHeaderHeight) {
    const absoluteY = y - colHeaderHeight + scrollTop;
    let accY = 0;
    let row = 0;

    while (row < MAX_ROWS) {
      const h = dimensions.getRowHeight(sheetId, row);
      accY += h;
      const edgeY = accY - scrollTop + colHeaderHeight;

      if (Math.abs(y - edgeY) <= RESIZE_HANDLE_SIZE) {
        return { type: 'row', index: row };
      }

      if (accY > absoluteY + RESIZE_HANDLE_SIZE) break;
      row++;
    }
  }

  // Column resize handle (right edge of column header)
  if (y < colHeaderHeight && x > rowHeaderWidth) {
    const absoluteX = x - rowHeaderWidth + scrollLeft;
    let accX = 0;
    let col = 0;

    while (col < MAX_COLS) {
      const w = dimensions.getColWidth(sheetId, col);
      accX += w;
      const edgeX = accX - scrollLeft + rowHeaderWidth;

      if (Math.abs(x - edgeX) <= RESIZE_HANDLE_SIZE) {
        return { type: 'col', index: col };
      }

      if (accX > absoluteX + RESIZE_HANDLE_SIZE) break;
      col++;
    }
  }

  return null;
}
