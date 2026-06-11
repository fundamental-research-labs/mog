import type { CellRange } from '@mog-sdk/contracts/core';
import type { ParsedCellRange } from '@mog-sdk/contracts/utils';
import { parseCellAddress, parseCellRange } from '@mog-sdk/kernel';

export type NameBoxReferenceTarget = {
  range: CellRange;
  activeCell: { row: number; col: number };
  sheetName?: string;
};

export function rangeFromParsedCellRange(parsedRange: ParsedCellRange): CellRange {
  return {
    startRow: parsedRange.startRow,
    startCol: parsedRange.startCol,
    endRow: parsedRange.endRow,
    endCol: parsedRange.endCol,
    ...(parsedRange.isFullColumn ? { isFullColumn: true } : {}),
    ...(parsedRange.isFullRow ? { isFullRow: true } : {}),
  };
}

export function parseNameBoxReference(address: string): NameBoxReferenceTarget | null {
  const parsedRange = parseCellRange(address);
  if (parsedRange) {
    return {
      range: rangeFromParsedCellRange(parsedRange),
      activeCell: { row: parsedRange.startRow, col: parsedRange.startCol },
      sheetName: parsedRange.sheetName,
    };
  }

  const parsed = parseCellAddress(address);
  if (!parsed) return null;
  return {
    range: {
      startRow: parsed.row,
      startCol: parsed.col,
      endRow: parsed.row,
      endCol: parsed.col,
    },
    activeCell: { row: parsed.row, col: parsed.col },
    sheetName: parsed.sheetName,
  };
}
