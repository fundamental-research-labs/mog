/**
 * Coordinate Conversion Utilities
 *
 * Converts between pixel coordinates and cell-based coordinates.
 * Moved from kernel — this is spreadsheet-specific layout math.
 */

import type { ViewportPositionIndexLike } from '@mog-sdk/contracts/rendering';

/**
 * Convert pixel-based position to cell-based position.
 *
 * @param x - X position in pixels
 * @param y - Y position in pixels
 * @param width - Width in pixels
 * @param height - Height in pixels
 * @param positionIndex - Position index for column widths and row heights
 */
export function pixelsToCells(
  x: number,
  y: number,
  width: number,
  height: number,
  positionIndex: ViewportPositionIndexLike,
): {
  anchorRow: number;
  anchorCol: number;
  anchorColOffset: number;
  anchorRowOffset: number;
  widthCells: number;
  heightCells: number;
} {
  const pi = positionIndex;

  let anchorCol = 0;
  let accumulatedX = 0;
  while (accumulatedX + pi.getColWidth(anchorCol) <= x) {
    accumulatedX += pi.getColWidth(anchorCol);
    anchorCol++;
    if (anchorCol > 16384) break;
  }

  let anchorRow = 0;
  let accumulatedY = 0;
  while (accumulatedY + pi.getRowHeight(anchorRow) <= y) {
    accumulatedY += pi.getRowHeight(anchorRow);
    anchorRow++;
    if (anchorRow > 1048576) break;
  }

  let widthCells = 0;
  let widthAccum = 0;
  let col = anchorCol;
  while (widthAccum < width && col < 16384) {
    widthAccum += pi.getColWidth(col);
    widthCells++;
    col++;
  }
  widthCells = Math.max(1, widthCells);

  let heightCells = 0;
  let heightAccum = 0;
  let row = anchorRow;
  while (heightAccum < height && row < 1048576) {
    heightAccum += pi.getRowHeight(row);
    heightCells++;
    row++;
  }
  heightCells = Math.max(1, heightCells);

  return {
    anchorRow,
    anchorCol,
    anchorColOffset: x - accumulatedX,
    anchorRowOffset: y - accumulatedY,
    widthCells,
    heightCells,
  };
}
