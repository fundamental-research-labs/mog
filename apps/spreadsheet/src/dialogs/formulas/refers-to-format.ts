import { quoteSheetName, toA1 } from '@mog/spreadsheet-utils/a1';

export interface SelectionRangeLike {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
}

export function toAbsoluteA1(row: number, col: number): string {
  return toA1(row, col).replace(/^([A-Z]+)(\d+)$/, '$$$1$$$2');
}

export function formatSelectionRefersTo(sheetName: string, range: SelectionRangeLike): string {
  const startRow = Math.min(range.startRow, range.endRow);
  const endRow = Math.max(range.startRow, range.endRow);
  const startCol = Math.min(range.startCol, range.endCol);
  const endCol = Math.max(range.startCol, range.endCol);
  const startA1 = toAbsoluteA1(startRow, startCol);
  const endA1 = toAbsoluteA1(endRow, endCol);
  const rangeRef = startA1 === endA1 ? startA1 : `${startA1}:${endA1}`;
  return `=${quoteSheetName(sheetName)}!${rangeRef}`;
}
