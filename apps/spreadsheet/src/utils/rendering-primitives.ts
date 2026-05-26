/**
 * Rendering Primitive Runtime Functions
 *
 * Extracted from @mog-sdk/contracts/rendering/primitives.
 * Moved from @mog/spreadsheet-utils/rendering/primitives (single consumer).
 */

import type { CellRange } from '@mog-sdk/contracts/core';
import { MAX_COLS, MAX_ROWS } from '@mog-sdk/contracts/core';
import type { Direction } from '@mog-sdk/contracts/machines';
import type { CellCoord } from '@mog-sdk/contracts/rendering';

/**
 * Check if two CellCoords are equal.
 */
export function cellsEqual(a: CellCoord, b: CellCoord): boolean {
  return a.row === b.row && a.col === b.col;
}

/**
 * Check if a cell coordinate is within a range.
 */
function isCellCoordInRange(cell: CellCoord, range: CellRange): boolean {
  const minRow = Math.min(range.startRow, range.endRow);
  const maxRow = Math.max(range.startRow, range.endRow);
  const minCol = Math.min(range.startCol, range.endCol);
  const maxCol = Math.max(range.startCol, range.endCol);
  return cell.row >= minRow && cell.row <= maxRow && cell.col >= minCol && cell.col <= maxCol;
}

/**
 * Check if a cell is in any of the given ranges.
 */
export function isCellInRanges(cell: CellCoord, ranges: CellRange[]): boolean {
  return ranges.some((range) => isCellCoordInRange(cell, range));
}

/**
 * Move a cell reference in a direction.
 */
export function moveCell(cell: CellCoord, direction: Direction, amount: number = 1): CellCoord {
  switch (direction) {
    case 'up':
      return { row: Math.max(0, cell.row - amount), col: cell.col };
    case 'down':
      return { row: Math.min(MAX_ROWS - 1, cell.row + amount), col: cell.col };
    case 'left':
      return { row: cell.row, col: Math.max(0, cell.col - amount) };
    case 'right':
      return { row: cell.row, col: Math.min(MAX_COLS - 1, cell.col + amount) };
  }
}
