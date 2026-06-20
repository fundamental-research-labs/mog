/**
 * Cell/pixel conversion helpers for chart floating-object positioning.
 */

import type { SheetId } from '@mog-sdk/contracts/core';

import type { ComputeBridge } from '../../bridges/compute/compute-bridge';

/**
 * Convert cell-based dimensions to pixel-based dimensions.
 *
 * Async - uses ComputeBridge for dimension queries.
 */
export async function cellsToPixels(
  anchorRow: number,
  anchorCol: number,
  widthCells: number,
  heightCells: number,
  containerId: SheetId,
  computeBridge: ComputeBridge,
): Promise<{ x: number; y: number; width: number; height: number }> {
  const x = await computeBridge.getColPosition(containerId, anchorCol);
  const y = await computeBridge.getRowPosition(containerId, anchorRow);

  // Calculate width by summing column widths
  let width = 0;
  for (let col = anchorCol; col < anchorCol + widthCells; col++) {
    width += await computeBridge.getColWidthFromIndex(containerId, col);
  }

  // Calculate height by summing row heights
  let height = 0;
  for (let row = anchorRow; row < anchorRow + heightCells; row++) {
    height += await computeBridge.getRowHeightFromIndex(containerId, row);
  }

  return { x, y, width, height };
}

/**
 * Resolve a chart anchor to pixel coordinates without deriving chart size from
 * live column or row dimensions.
 */
export async function chartAnchorToPixels(
  anchorRow: number,
  anchorCol: number,
  containerId: SheetId,
  computeBridge: ComputeBridge,
): Promise<{ x: number; y: number }> {
  const [x, y] = await Promise.all([
    computeBridge.getColPosition(containerId, anchorCol),
    computeBridge.getRowPosition(containerId, anchorRow),
  ]);

  return { x, y };
}

/**
 * Convert pixel-based position to cell-based position.
 *
 * Async - uses ComputeBridge for dimension queries.
 */
export async function pixelsToCells(
  x: number,
  y: number,
  width: number,
  height: number,
  containerId: SheetId,
  computeBridge: ComputeBridge,
): Promise<{ anchorRow: number; anchorCol: number; widthCells: number; heightCells: number }> {
  // Find anchor column and row using binary search via bridge
  const anchorCol = await computeBridge.getColAtPixel(containerId, x);
  const anchorRow = await computeBridge.getRowAtPixel(containerId, y);

  // Calculate widthCells by iterating from anchor
  let widthCells = 0;
  let widthAccum = 0;
  let col = anchorCol;
  while (widthAccum < width && col < 16384) {
    widthAccum += await computeBridge.getColWidthFromIndex(containerId, col);
    widthCells++;
    col++;
  }
  widthCells = Math.max(1, widthCells);

  // Calculate heightCells by iterating from anchor
  let heightCells = 0;
  let heightAccum = 0;
  let row = anchorRow;
  while (heightAccum < height && row < 1048576) {
    heightAccum += await computeBridge.getRowHeightFromIndex(containerId, row);
    heightCells++;
    row++;
  }
  heightCells = Math.max(1, heightCells);

  return { anchorRow, anchorCol, widthCells, heightCells };
}
