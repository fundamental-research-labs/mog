import { MAX_COLS, MAX_ROWS, type CellRange } from '@mog-sdk/contracts/core';
import type { CellCoord } from '@mog-sdk/contracts/rendering';
import { colToLetter, toA1 } from '@mog/spreadsheet-utils/a1';

function isWholeSheetRange(range: CellRange): boolean {
  return (
    range.startRow === 0 &&
    range.startCol === 0 &&
    range.endRow === MAX_ROWS - 1 &&
    range.endCol === MAX_COLS - 1
  );
}

function formatFullColumnRange(range: CellRange): string {
  const start = colToLetter(range.startCol);
  const end = colToLetter(range.endCol);
  return start === end ? `${start}:${start}` : `${start}:${end}`;
}

function formatFullRowRange(range: CellRange): string {
  const start = String(range.startRow + 1);
  const end = String(range.endRow + 1);
  return start === end ? `${start}:${start}` : `${start}:${end}`;
}

export function formatNameBoxRange(range: CellRange, activeCell: CellCoord): string {
  if (isWholeSheetRange(range)) {
    return toA1(activeCell.row, activeCell.col);
  }

  if (range.isFullColumn || (range.startRow === 0 && range.endRow === MAX_ROWS - 1)) {
    return formatFullColumnRange(range);
  }

  if (range.isFullRow || (range.startCol === 0 && range.endCol === MAX_COLS - 1)) {
    return formatFullRowRange(range);
  }

  if (range.startRow === range.endRow && range.startCol === range.endCol) {
    return toA1(range.startRow, range.startCol);
  }

  return `${toA1(range.startRow, range.startCol)}:${toA1(range.endRow, range.endCol)}`;
}

export function formatNameBoxSelection(ranges: CellRange[], activeCell: CellCoord): string {
  if (ranges.length === 0) {
    return toA1(activeCell.row, activeCell.col);
  }

  return ranges.map((range) => formatNameBoxRange(range, activeCell)).join(',');
}
