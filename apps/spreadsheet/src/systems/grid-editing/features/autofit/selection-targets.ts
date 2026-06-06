import { MAX_COLS, MAX_ROWS, type CellRange } from '@mog-sdk/contracts/core';

export interface AutofitUsedRange {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
}

export type AutofitColumnSelectionRange = Pick<CellRange, 'startCol' | 'endCol'> &
  Partial<Pick<CellRange, 'isFullRow'>>;

export type AutofitRowSelectionRange = Pick<CellRange, 'startRow' | 'endRow'> &
  Partial<Pick<CellRange, 'isFullColumn'>>;

export function getAutofitColumnsForSelection(
  ranges: readonly AutofitColumnSelectionRange[],
  activeCell: { col: number },
  usedRange: AutofitUsedRange | null | undefined,
): number[] {
  if (ranges.length === 0) return [activeCell.col];

  const columns = new Set<number>();
  for (const range of ranges) {
    for (const col of columnsForRange(range, activeCell.col, usedRange)) {
      columns.add(col);
    }
  }
  return [...columns].sort((a, b) => a - b);
}

export function getAutofitRowsForSelection(
  ranges: readonly AutofitRowSelectionRange[],
  activeCell: { row: number },
  usedRange: AutofitUsedRange | null | undefined,
): number[] {
  if (ranges.length === 0) return [activeCell.row];

  const rows = new Set<number>();
  for (const range of ranges) {
    for (const row of rowsForRange(range, activeCell.row, usedRange)) {
      rows.add(row);
    }
  }
  return [...rows].sort((a, b) => a - b);
}

export function getAutofitColumnsForResize(
  clickedCol: number,
  ranges: readonly AutofitColumnSelectionRange[],
  usedRange: AutofitUsedRange | null | undefined,
): number[] {
  for (const range of ranges) {
    if (contains(clickedCol, range.startCol, range.endCol)) {
      return columnsForRange(range, clickedCol, usedRange);
    }
  }
  return [clickedCol];
}

export function getAutofitRowsForResize(
  clickedRow: number,
  ranges: readonly AutofitRowSelectionRange[],
  usedRange: AutofitUsedRange | null | undefined,
): number[] {
  for (const range of ranges) {
    if (contains(clickedRow, range.startRow, range.endRow)) {
      return rowsForRange(range, clickedRow, usedRange);
    }
  }
  return [clickedRow];
}

function columnsForRange(
  range: AutofitColumnSelectionRange,
  fallbackCol: number,
  usedRange: AutofitUsedRange | null | undefined,
): number[] {
  if (isTheoreticalColumnSpan(range)) {
    return usedRange ? enumerate(usedRange.startCol, usedRange.endCol) : [fallbackCol];
  }
  return enumerate(range.startCol, range.endCol);
}

function rowsForRange(
  range: AutofitRowSelectionRange,
  fallbackRow: number,
  usedRange: AutofitUsedRange | null | undefined,
): number[] {
  if (isTheoreticalRowSpan(range)) {
    return usedRange ? enumerate(usedRange.startRow, usedRange.endRow) : [fallbackRow];
  }
  return enumerate(range.startRow, range.endRow);
}

function isTheoreticalColumnSpan(range: AutofitColumnSelectionRange): boolean {
  const start = Math.min(range.startCol, range.endCol);
  const end = Math.max(range.startCol, range.endCol);
  return range.isFullRow === true || (start === 0 && end >= MAX_COLS - 1);
}

function isTheoreticalRowSpan(range: AutofitRowSelectionRange): boolean {
  const start = Math.min(range.startRow, range.endRow);
  const end = Math.max(range.startRow, range.endRow);
  return range.isFullColumn === true || (start === 0 && end >= MAX_ROWS - 1);
}

function contains(value: number, a: number, b: number): boolean {
  const start = Math.min(a, b);
  const end = Math.max(a, b);
  return value >= start && value <= end;
}

function enumerate(a: number, b: number): number[] {
  const start = Math.min(a, b);
  const end = Math.max(a, b);
  const values: number[] = [];
  for (let value = start; value <= end; value++) values.push(value);
  return values;
}
