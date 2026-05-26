/**
 * Range Utility Functions
 *
 * Pure utility functions for CellRange manipulation: normalization, predicates, size, iteration.
 *
 * For navigation/arithmetic operations (offset, resize, intersection, sub-range extraction),
 * see the range-navigation functions also exported from this module.
 */

import type { CellRange } from '@mog-sdk/contracts/core';
import { MAX_COLS, MAX_ROWS } from '@mog-sdk/contracts/core';

// =============================================================================
// Range utilities (from contracts/utils/range.ts)
// =============================================================================

/**
 * Normalize a range so startRow/startCol are always <= endRow/endCol.
 *
 * Useful when selection direction doesn't matter (e.g., for rendering,
 * data operations). Preserves isFullColumn/isFullRow/sheetId flags.
 */
export function normalizeRange(range: CellRange): CellRange {
  return {
    startRow: Math.min(range.startRow, range.endRow),
    startCol: Math.min(range.startCol, range.endCol),
    endRow: Math.max(range.startRow, range.endRow),
    endCol: Math.max(range.startCol, range.endCol),
    isFullColumn: range.isFullColumn,
    isFullRow: range.isFullRow,
    sheetId: range.sheetId,
  };
}

/**
 * Check if a cell (row, col) is within a range.
 * Automatically normalizes the range before checking.
 */
export function isCellInRange(row: number, col: number, range: CellRange): boolean {
  const normalized = normalizeRange(range);
  return (
    row >= normalized.startRow &&
    row <= normalized.endRow &&
    col >= normalized.startCol &&
    col <= normalized.endCol
  );
}

/**
 * Check if two CellRanges are equal (same bounds and flags).
 */
export function rangesEqual(a: CellRange, b: CellRange): boolean {
  return (
    a.startRow === b.startRow &&
    a.startCol === b.startCol &&
    a.endRow === b.endRow &&
    a.endCol === b.endCol &&
    a.isFullColumn === b.isFullColumn &&
    a.isFullRow === b.isFullRow
  );
}

/**
 * Iterate over all cells in a range (generator).
 * Yields { row, col } for each cell in row-major order.
 */
export function* iterateRange(range: CellRange): Generator<{ row: number; col: number }> {
  const normalized = normalizeRange(range);
  for (let row = normalized.startRow; row <= normalized.endRow; row++) {
    for (let col = normalized.startCol; col <= normalized.endCol; col++) {
      yield { row, col };
    }
  }
}

/**
 * Get the number of cells in a range.
 */
export function getRangeSize(range: CellRange): number {
  const normalized = normalizeRange(range);
  return (
    (normalized.endRow - normalized.startRow + 1) * (normalized.endCol - normalized.startCol + 1)
  );
}

/**
 * Create a single-cell range from row/col.
 */
export function singleCellRange(row: number, col: number): CellRange {
  return { startRow: row, startCol: col, endRow: row, endCol: col };
}

/**
 * Type guard for CellRange.
 * Useful for runtime validation at system boundaries.
 */
export function isCellRange(range: unknown): range is CellRange {
  return (
    typeof range === 'object' &&
    range !== null &&
    'startRow' in range &&
    'startCol' in range &&
    'endRow' in range &&
    'endCol' in range &&
    typeof (range as CellRange).startRow === 'number' &&
    typeof (range as CellRange).startCol === 'number' &&
    typeof (range as CellRange).endRow === 'number' &&
    typeof (range as CellRange).endCol === 'number'
  );
}

// =============================================================================
// Range navigation utilities (from contracts/utils/range-navigation.ts)
// =============================================================================

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Clamp a row index to [0, MAX_ROWS). */
function clampRow(row: number): number {
  return Math.max(0, Math.min(row, MAX_ROWS - 1));
}

/** Clamp a col index to [0, MAX_COLS). */
function clampCol(col: number): number {
  return Math.max(0, Math.min(col, MAX_COLS - 1));
}

/** Resolve sheetId from two ranges. Throws if both have sheetId and they differ. */
function resolveSheetId(a: CellRange, b: CellRange): string | undefined {
  if (a.sheetId && b.sheetId && a.sheetId !== b.sheetId) {
    throw new RangeError(`Sheet ID mismatch: "${a.sheetId}" vs "${b.sheetId}"`);
  }
  return a.sheetId ?? b.sheetId;
}

// ---------------------------------------------------------------------------
// Offset and Resize
// ---------------------------------------------------------------------------

/**
 * Shift a range by (rowOffset, colOffset). Clamps to [0, MAX).
 *
 * Throws RangeError if input has isFullRow and rowOffset !== 0,
 * or isFullColumn and colOffset !== 0.
 */
export function getOffsetRange(range: CellRange, rowOffset: number, colOffset: number): CellRange {
  const r = normalizeRange(range);

  if (r.isFullRow && rowOffset !== 0) {
    throw new RangeError('Cannot offset a full-row range along the row axis');
  }
  if (r.isFullColumn && colOffset !== 0) {
    throw new RangeError('Cannot offset a full-column range along the column axis');
  }

  return {
    startRow: clampRow(r.startRow + rowOffset),
    startCol: clampCol(r.startCol + colOffset),
    endRow: clampRow(r.endRow + rowOffset),
    endCol: clampCol(r.endCol + colOffset),
    isFullColumn: r.isFullColumn,
    isFullRow: r.isFullRow,
    sheetId: r.sheetId,
  };
}

/**
 * Grow/shrink a range from its bottom-right by delta rows/cols.
 * Result will have at least 1 row and 1 col (clamped).
 *
 * Throws RangeError if resizing along a full-row or full-column axis.
 */
export function getResizedRange(range: CellRange, deltaRows: number, deltaCols: number): CellRange {
  const r = normalizeRange(range);

  if (r.isFullRow && deltaRows !== 0) {
    throw new RangeError('Cannot resize a full-row range along the row axis');
  }
  if (r.isFullColumn && deltaCols !== 0) {
    throw new RangeError('Cannot resize a full-column range along the column axis');
  }

  // Ensure at least 1 row and 1 col
  const newEndRow = clampRow(Math.max(r.startRow, r.endRow + deltaRows));
  const newEndCol = clampCol(Math.max(r.startCol, r.endCol + deltaCols));

  return {
    startRow: r.startRow,
    startCol: r.startCol,
    endRow: newEndRow,
    endCol: newEndCol,
    isFullColumn: r.isFullColumn,
    isFullRow: r.isFullRow,
    sheetId: r.sheetId,
  };
}

/**
 * Resize a range to exactly numRows x numCols from the top-left.
 *
 * Throws RangeError if numRows <= 0 or numCols <= 0,
 * or if resizing along a full-row or full-column axis.
 */
export function getAbsoluteResizedRange(
  range: CellRange,
  numRows: number,
  numCols: number,
): CellRange {
  if (numRows <= 0) {
    throw new RangeError(`numRows must be positive, got ${numRows}`);
  }
  if (numCols <= 0) {
    throw new RangeError(`numCols must be positive, got ${numCols}`);
  }

  const r = normalizeRange(range);

  if (r.isFullRow && numRows !== r.endRow - r.startRow + 1) {
    throw new RangeError('Cannot resize a full-row range along the row axis');
  }
  if (r.isFullColumn && numCols !== r.endCol - r.startCol + 1) {
    throw new RangeError('Cannot resize a full-column range along the column axis');
  }

  return {
    startRow: r.startRow,
    startCol: r.startCol,
    endRow: clampRow(r.startRow + numRows - 1),
    endCol: clampCol(r.startCol + numCols - 1),
    isFullColumn: r.isFullColumn,
    isFullRow: r.isFullRow,
    sheetId: r.sheetId,
  };
}

// ---------------------------------------------------------------------------
// Intersection and Bounding Rect
// ---------------------------------------------------------------------------

/**
 * Return the intersection of two ranges, or null if disjoint.
 */
export function getIntersection(a: CellRange, b: CellRange): CellRange | null {
  const na = normalizeRange(a);
  const nb = normalizeRange(b);
  const sheetId = resolveSheetId(na, nb);

  const startRow = Math.max(na.startRow, nb.startRow);
  const startCol = Math.max(na.startCol, nb.startCol);
  const endRow = Math.min(na.endRow, nb.endRow);
  const endCol = Math.min(na.endCol, nb.endCol);

  if (startRow > endRow || startCol > endCol) {
    return null;
  }

  return {
    startRow,
    startCol,
    endRow,
    endCol,
    sheetId,
  };
}

/**
 * Return the smallest range enclosing both ranges.
 */
export function getBoundingRect(a: CellRange, b: CellRange): CellRange {
  const na = normalizeRange(a);
  const nb = normalizeRange(b);
  const sheetId = resolveSheetId(na, nb);

  return {
    startRow: Math.min(na.startRow, nb.startRow),
    startCol: Math.min(na.startCol, nb.startCol),
    endRow: Math.max(na.endRow, nb.endRow),
    endCol: Math.max(na.endCol, nb.endCol),
    isFullRow: na.isFullRow || nb.isFullRow || undefined,
    isFullColumn: na.isFullColumn || nb.isFullColumn || undefined,
    sheetId,
  };
}

// ---------------------------------------------------------------------------
// Entire Row/Column
// ---------------------------------------------------------------------------

/**
 * Expand range to full row(s) (col 0 to MAX_COLS-1, isFullRow=true).
 */
export function getEntireRow(range: CellRange): CellRange {
  const r = normalizeRange(range);
  return {
    startRow: r.startRow,
    startCol: 0,
    endRow: r.endRow,
    endCol: MAX_COLS - 1,
    isFullRow: true,
    sheetId: r.sheetId,
  };
}

/**
 * Expand range to full column(s) (row 0 to MAX_ROWS-1, isFullColumn=true).
 */
export function getEntireColumn(range: CellRange): CellRange {
  const r = normalizeRange(range);
  return {
    startRow: 0,
    startCol: r.startCol,
    endRow: MAX_ROWS - 1,
    endCol: r.endCol,
    isFullColumn: true,
    sheetId: r.sheetId,
  };
}

// ---------------------------------------------------------------------------
// Sub-range Extractors
// ---------------------------------------------------------------------------

/**
 * Get the nth row within a range (0-based relative index).
 * Throws RangeError if index is out of bounds.
 */
export function getRow(range: CellRange, index: number): CellRange {
  const r = normalizeRange(range);
  const rowCount = r.isFullRow ? MAX_ROWS : r.endRow - r.startRow + 1;

  if (index < 0 || index >= rowCount) {
    throw new RangeError(`Row index ${index} out of bounds for range with ${rowCount} rows`);
  }

  const row = r.isFullRow ? index : r.startRow + index;
  return {
    startRow: row,
    startCol: r.startCol,
    endRow: row,
    endCol: r.endCol,
    sheetId: r.sheetId,
  };
}

/**
 * Get the nth column within a range (0-based relative index).
 * Throws RangeError if index is out of bounds.
 */
export function getColumn(range: CellRange, index: number): CellRange {
  const r = normalizeRange(range);
  const colCount = r.isFullColumn ? MAX_COLS : r.endCol - r.startCol + 1;

  if (index < 0 || index >= colCount) {
    throw new RangeError(`Column index ${index} out of bounds for range with ${colCount} columns`);
  }

  const col = r.isFullColumn ? index : r.startCol + index;
  return {
    startRow: r.startRow,
    startCol: col,
    endRow: r.endRow,
    endCol: col,
    sheetId: r.sheetId,
  };
}

/**
 * Get the last row of a range as a single-row range.
 */
export function getLastRow(range: CellRange): CellRange {
  const r = normalizeRange(range);
  const lastRow = r.isFullRow ? MAX_ROWS - 1 : r.endRow;

  return {
    startRow: lastRow,
    startCol: r.startCol,
    endRow: lastRow,
    endCol: r.endCol,
    sheetId: r.sheetId,
  };
}

/**
 * Get the last column of a range as a single-column range.
 */
export function getLastColumn(range: CellRange): CellRange {
  const r = normalizeRange(range);
  const lastCol = r.isFullColumn ? MAX_COLS - 1 : r.endCol;

  return {
    startRow: r.startRow,
    startCol: lastCol,
    endRow: r.endRow,
    endCol: lastCol,
    sheetId: r.sheetId,
  };
}

/**
 * Get the bottom-right cell of a range as a 1x1 range.
 */
export function getLastCell(range: CellRange): CellRange {
  const r = normalizeRange(range);
  const lastRow = r.isFullRow ? MAX_ROWS - 1 : r.endRow;
  const lastCol = r.isFullColumn ? MAX_COLS - 1 : r.endCol;

  return {
    startRow: lastRow,
    startCol: lastCol,
    endRow: lastRow,
    endCol: lastCol,
    sheetId: r.sheetId,
  };
}

/**
 * Get a single cell within a range by relative (row, col) offset.
 * Throws RangeError if out of bounds. Returns a 1x1 CellRange.
 */
export function getCellRange(range: CellRange, rowIndex: number, colIndex: number): CellRange {
  const r = normalizeRange(range);
  const rowCount = r.isFullRow ? MAX_ROWS : r.endRow - r.startRow + 1;
  const colCount = r.isFullColumn ? MAX_COLS : r.endCol - r.startCol + 1;

  if (rowIndex < 0 || rowIndex >= rowCount) {
    throw new RangeError(`Row index ${rowIndex} out of bounds for range with ${rowCount} rows`);
  }
  if (colIndex < 0 || colIndex >= colCount) {
    throw new RangeError(
      `Column index ${colIndex} out of bounds for range with ${colCount} columns`,
    );
  }

  const row = r.isFullRow ? rowIndex : r.startRow + rowIndex;
  const col = r.isFullColumn ? colIndex : r.startCol + colIndex;

  return {
    startRow: row,
    startCol: col,
    endRow: row,
    endCol: col,
    sheetId: r.sheetId,
  };
}

// ---------------------------------------------------------------------------
// Adjacent Ranges
// ---------------------------------------------------------------------------

/**
 * Get `count` rows immediately above the range. Default count=1.
 * Returns null if no rows above (range starts at row 0).
 * Throws RangeError if input has isFullRow.
 */
export function getRowsAbove(range: CellRange, count: number = 1): CellRange | null {
  const r = normalizeRange(range);

  if (r.isFullRow) {
    throw new RangeError('Cannot get rows above a full-row range');
  }

  if (r.startRow === 0) {
    return null;
  }

  const availableRows = r.startRow;
  const actualCount = Math.min(count, availableRows);
  const startRow = r.startRow - actualCount;

  return {
    startRow,
    startCol: r.startCol,
    endRow: r.startRow - 1,
    endCol: r.endCol,
    sheetId: r.sheetId,
  };
}

/**
 * Get `count` rows immediately below the range. Default count=1.
 * Returns null if no rows below (range ends at MAX_ROWS-1).
 * Throws RangeError if input has isFullRow.
 */
export function getRowsBelow(range: CellRange, count: number = 1): CellRange | null {
  const r = normalizeRange(range);

  if (r.isFullRow) {
    throw new RangeError('Cannot get rows below a full-row range');
  }

  if (r.endRow >= MAX_ROWS - 1) {
    return null;
  }

  const availableRows = MAX_ROWS - 1 - r.endRow;
  const actualCount = Math.min(count, availableRows);

  return {
    startRow: r.endRow + 1,
    startCol: r.startCol,
    endRow: r.endRow + actualCount,
    endCol: r.endCol,
    sheetId: r.sheetId,
  };
}

/**
 * Get `count` columns immediately to the left. Default count=1.
 * Returns null if no cols to the left (range starts at col 0).
 * Throws RangeError if input has isFullColumn.
 */
export function getColumnsBefore(range: CellRange, count: number = 1): CellRange | null {
  const r = normalizeRange(range);

  if (r.isFullColumn) {
    throw new RangeError('Cannot get columns before a full-column range');
  }

  if (r.startCol === 0) {
    return null;
  }

  const availableCols = r.startCol;
  const actualCount = Math.min(count, availableCols);

  return {
    startRow: r.startRow,
    startCol: r.startCol - actualCount,
    endRow: r.endRow,
    endCol: r.startCol - 1,
    sheetId: r.sheetId,
  };
}

/**
 * Get `count` columns immediately to the right. Default count=1.
 * Returns null if no cols to the right (range ends at MAX_COLS-1).
 * Throws RangeError if input has isFullColumn.
 */
export function getColumnsAfter(range: CellRange, count: number = 1): CellRange | null {
  const r = normalizeRange(range);

  if (r.isFullColumn) {
    throw new RangeError('Cannot get columns after a full-column range');
  }

  if (r.endCol >= MAX_COLS - 1) {
    return null;
  }

  const availableCols = MAX_COLS - 1 - r.endCol;
  const actualCount = Math.min(count, availableCols);

  return {
    startRow: r.startRow,
    startCol: r.endCol + 1,
    endRow: r.endRow,
    endCol: r.endCol + actualCount,
    sheetId: r.sheetId,
  };
}

// ---------------------------------------------------------------------------
// Predicates
// ---------------------------------------------------------------------------

/**
 * True if range `outer` fully contains range `inner`.
 */
export function containsRange(outer: CellRange, inner: CellRange): boolean {
  const no = normalizeRange(outer);
  const ni = normalizeRange(inner);
  resolveSheetId(no, ni); // validate sheetId compatibility

  return (
    ni.startRow >= no.startRow &&
    ni.endRow <= no.endRow &&
    ni.startCol >= no.startCol &&
    ni.endCol <= no.endCol
  );
}

/**
 * True if two ranges overlap at all.
 * Equivalent to getIntersection(a, b) !== null.
 */
export function rangesOverlap(a: CellRange, b: CellRange): boolean {
  return getIntersection(a, b) !== null;
}
