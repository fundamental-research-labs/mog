import type { CellRange } from '@mog-sdk/contracts/core';
import { cellRangeToA1, toA1 } from '@mog/spreadsheet-utils/a1';

/**
 * Count total cells in a set of ranges.
 */
export function countCellsInRanges(ranges: readonly CellRange[]): number {
  let total = 0;
  for (const range of ranges) {
    total += (range.endRow - range.startRow + 1) * (range.endCol - range.startCol + 1);
  }
  return total;
}

/**
 * Check if a selection is a single cell (one range with startRow/Col === endRow/Col).
 */
export function isSingleCellSelection(ranges: readonly CellRange[]): boolean {
  if (ranges.length !== 1) return false;
  const range = ranges[0];
  return range.startRow === range.endRow && range.startCol === range.endCol;
}

export function buildBaseSelectionAnnouncement(
  ranges: readonly CellRange[],
  activeCell: { row: number; col: number },
  cellContentAnnouncement: string,
): string {
  if (ranges.length === 0) {
    return '';
  }

  if (isSingleCellSelection(ranges)) {
    const cellAddress = toA1(activeCell.row, activeCell.col);
    return `Cell ${cellAddress} selected, ${cellContentAnnouncement}`;
  }

  if (ranges.length === 1) {
    const cellCount = countCellsInRanges(ranges);
    return `Selected ${cellRangeToA1(ranges[0])}, ${cellCount} cells`;
  }

  const cellCount = countCellsInRanges(ranges);
  return `${ranges.length} ranges selected, ${cellCount} cells total`;
}
