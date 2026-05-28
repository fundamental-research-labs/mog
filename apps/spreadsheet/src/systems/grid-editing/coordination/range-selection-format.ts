import { MAX_COLS, MAX_ROWS, type CellRange } from '@mog-sdk/contracts/core';
import { toA1 } from '@mog/spreadsheet-utils/a1';

function toColumnName(col: number): string {
  return toA1(0, col).replace(/\d+$/, '');
}

export function formatRangeSelectionRange(range: CellRange): string {
  const startRow = Math.min(range.startRow, range.endRow);
  const endRow = Math.max(range.startRow, range.endRow);
  const startCol = Math.min(range.startCol, range.endCol);
  const endCol = Math.max(range.startCol, range.endCol);

  if (startCol === 0 && endCol === MAX_COLS - 1) {
    return `$${startRow + 1}:$${endRow + 1}`;
  }

  if (startRow === 0 && endRow === MAX_ROWS - 1) {
    return `$${toColumnName(startCol)}:$${toColumnName(endCol)}`;
  }

  const startCell = toA1(startRow, startCol);
  const endCell = toA1(endRow, endCol);
  return startCell === endCell ? startCell : `${startCell}:${endCell}`;
}
